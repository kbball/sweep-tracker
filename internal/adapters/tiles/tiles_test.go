package tiles

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kbball/sweep-tracker/internal/domain"
)

func TestTileXY(t *testing.T) {
	if x, y := TileXY(0, 0, 1); x != 1 || y != 1 {
		t.Fatalf("%d,%d", x, y)
	}
	// Denver at z10 is a well-known tile.
	if x, y := TileXY(39.7392, -104.9903, 10); x != 213 || y != 388 {
		t.Fatalf("%d,%d", x, y)
	}
	if x, y := TileXY(90, 180, 3); x != 7 || y != 0 {
		t.Fatalf("clamp %d,%d", x, y)
	}
}

func TestEnumerate(t *testing.T) {
	box := domain.BBox{MinLat: 39.7, MaxLat: 39.8, MinLon: -105.1, MaxLon: -105.0}
	got := Enumerate(box, 8, 10)
	if len(got) < 3 {
		t.Fatalf("%d", len(got))
	}
	if got[0].z != 8 || got[len(got)-1].z != 10 {
		t.Fatal("zoom order")
	}
}

func testStore(t *testing.T, url string) (*Store, *Downloader) {
	t.Helper()
	srcs := []Source{{ID: "topo", Name: "Topo", URL: url + "/{z}/{y}/{x}", MinZoom: 5, MaxZoom: 12}}
	s := NewStore(t.TempDir(), srcs)
	return s, NewDownloader(s, http.DefaultClient, "test", 3, 0)
}

var denver = domain.BBox{MinLat: 39.7, MaxLat: 39.8, MinLon: -105.1, MaxLon: -105.0}

func TestDownloadAndServe(t *testing.T) {
	var hits atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Header.Get("User-Agent") != "test" {
			t.Error("user agent")
		}
		w.Write([]byte("PNGDATA" + r.URL.Path))
	}))
	defer ts.Close()
	s, d := testStore(t, ts.URL)

	var lastDone, lastTotal int
	if err := d.Download(context.Background(), "topo", denver, 0, 99, func(done, total int) { lastDone, lastTotal = done, total }); err != nil {
		t.Fatal(err)
	}
	n := int(hits.Load())
	if n == 0 || lastDone != n || lastTotal != n || s.Count("topo") != n {
		t.Fatalf("hits=%d done=%d total=%d count=%d", n, lastDone, lastTotal, s.Count("topo"))
	}
	// zoom clamped to source range 5..12
	x, y := TileXY(39.75, -105.05, 12)
	r, err := s.Tile("topo", 12, x, y)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r)
	r.Close()
	if !strings.HasPrefix(string(b), "PNGDATA/12/") {
		t.Fatal(string(b))
	}
	// Second run skips existing tiles.
	if err := d.Download(context.Background(), "topo", denver, 5, 12, nil); err != nil || int(hits.Load()) != n {
		t.Fatalf("redownload hit network: %v %d", err, hits.Load())
	}
	l := s.Layers()
	if len(l) != 1 || l[0].TileCount != n || l[0].SizeBytes < int64(n)*int64(len("PNGDATA/")) || l[0].MaxTileZoom == 0 || l[0].MaxTileZoom > 12 || l[0].MaxZoom != 12 {
		t.Fatalf("%+v", l)
	}
	ids := d.LayerIDs()
	if len(ids) != 1 || ids[0] != "topo" {
		t.Fatal(ids)
	}
}

func TestTileNotFound(t *testing.T) {
	s, _ := testStore(t, "http://unused")
	for _, c := range []struct {
		l       string
		z, x, y int
	}{{"topo", 1, 1, 1}, {"nope", 1, 1, 1}, {"topo", -1, 0, 0}, {"topo", 0, -1, 0}, {"topo", 0, 0, -1}} {
		if _, err := s.Tile(c.l, c.z, c.x, c.y); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("%+v: %v", c, err)
		}
	}
	if s.Count("nope") != 0 || s.Count("topo") != 0 {
		t.Fatal("count")
	}
}

func TestDownloadErrors(t *testing.T) {
	ctx := context.Background()
	_, d := testStore(t, "http://unused")
	if err := d.Download(ctx, "nope", denver, 5, 6, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("unknown layer")
	}
	world := domain.BBox{MinLat: -80, MaxLat: 80, MinLon: -179, MaxLon: 179}
	if err := d.Download(ctx, "topo", world, 5, 12, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("too many tiles")
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "x", 500) }))
	defer ts.Close()
	_, d = testStore(t, ts.URL)
	if err := d.Download(ctx, "topo", denver, 6, 6, nil); err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("%v", err)
	}

	ts404 := httptest.NewServer(http.NotFoundHandler())
	defer ts404.Close()
	s, d := testStore(t, ts404.URL)
	if err := d.Download(ctx, "topo", denver, 6, 6, nil); err != nil || s.Count("topo") != 0 {
		t.Fatalf("404 should be skipped: %v", err)
	}

	_, d = testStore(t, "http://127.0.0.1:1")
	if err := d.Download(ctx, "topo", denver, 6, 6, nil); err == nil {
		t.Fatal("connection refused expected")
	}
	_, d = testStore(t, "http://bad host")
	if err := d.Download(ctx, "topo", denver, 6, 6, nil); err == nil {
		t.Fatal("bad url expected")
	}
}

func TestDownloadCancelAndRateLimit(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) }))
	defer ts.Close()
	s, _ := testStore(t, ts.URL)
	d := NewDownloader(s, http.DefaultClient, "t", 0, 5*time.Millisecond) // concurrency floor of 1
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := d.Download(ctx, "topo", denver, 9, 12, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("%v", err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := d.Download(ctx, "topo", denver, 8, 12, nil); err == nil {
		t.Fatal("expected timeout during rate-limited download")
	}
	if err := d.Download(context.Background(), "topo", denver, 6, 6, nil); err != nil {
		t.Fatalf("rate limited run: %v", err)
	}
}

func TestPutErrors(t *testing.T) {
	s := NewStore("/dev/null/nope", DefaultSources)
	if err := s.put("topo", 1, 1, 1, strings.NewReader("x")); err == nil {
		t.Fatal("mkdir should fail")
	}
}

func TestDefaultSources(t *testing.T) {
	if len(DefaultSources) != 1 || DefaultSources[0].ID != "topo" {
		t.Fatal("default sources")
	}
}

func TestTileZoomRange(t *testing.T) {
	root := t.TempDir()
	s := NewStore(root, DefaultSources)
	if lo, hi := s.tileZooms("topo"); lo != 0 || hi != 0 {
		t.Fatalf("empty store: %d %d", lo, hi)
	}
	for _, z := range []int{9, 7, 11} {
		if err := s.put("topo", z, 1, 1, strings.NewReader("x")); err != nil {
			t.Fatal(err)
		}
	}
	// An empty zoom folder and a stray non-numeric entry are ignored.
	_ = os.MkdirAll(filepath.Join(root, "topo", "3", "1"), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "topo", "junk"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "topo", "99"), []byte("file, not a zoom folder"), 0o644)
	if lo, hi := s.tileZooms("topo"); lo != 7 || hi != 11 {
		t.Fatalf("got %d..%d, want 7..11", lo, hi)
	}
	if l := s.Layers()[0]; l.MinTileZoom != 7 || l.MaxTileZoom != 11 {
		t.Fatalf("%+v", l)
	}
}
