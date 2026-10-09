// Package tiles stores offline map tiles on disk and downloads them from
// upstream tile servers.
package tiles

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// Source describes an upstream raster tile server. URL uses {z}, {x}, {y}.
type Source struct {
	ID          string
	Name        string
	URL         string
	Attribution string
	MinZoom     int
	MaxZoom     int
}

// DefaultSources are USGS National Map layers: public domain and fine for
// bulk caching of a course area.
var DefaultSources = []Source{
	{
		ID: "topo", Name: "Topo",
		URL:         "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
		Attribution: "USGS The National Map", MinZoom: 0, MaxZoom: 16,
	},
	{
		ID: "terrain", Name: "Terrain",
		URL:         "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
		Attribution: "USGS The National Map", MinZoom: 0, MaxZoom: 15,
	},
}

// MaxTilesPerLayer guards against accidentally requesting a continent.
const MaxTilesPerLayer = 250_000

// Store is a directory of tiles laid out as <root>/<layer>/<z>/<x>/<y>.tile.
type Store struct {
	root    string
	sources []Source
}

func NewStore(root string, sources []Source) *Store { return &Store{root: root, sources: sources} }

func (s *Store) path(layer string, z, x, y int) string {
	return filepath.Join(s.root, layer, strconv.Itoa(z), strconv.Itoa(x), strconv.Itoa(y)+".tile")
}

func (s *Store) Layers() []domain.MapLayer {
	out := make([]domain.MapLayer, len(s.sources))
	for i, src := range s.sources {
		out[i] = domain.MapLayer{ID: src.ID, Name: src.Name, Attribution: src.Attribution,
			MinZoom: src.MinZoom, MaxZoom: src.MaxZoom, TileCount: s.Count(src.ID)}
	}
	return out
}

func (s *Store) known(layer string) bool {
	for _, src := range s.sources {
		if src.ID == layer {
			return true
		}
	}
	return false
}

func (s *Store) Tile(layer string, z, x, y int) (io.ReadCloser, error) {
	if !s.known(layer) || z < 0 || x < 0 || y < 0 {
		return nil, domain.ErrNotFound
	}
	f, err := os.Open(s.path(layer, z, x, y))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, domain.ErrNotFound
	}
	return f, err
}

func (s *Store) Count(layer string) int {
	if !s.known(layer) {
		return 0
	}
	n := 0
	_ = filepath.WalkDir(filepath.Join(s.root, layer), func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(d.Name(), ".tile") {
			n++
		}
		return nil
	})
	return n
}

func (s *Store) put(layer string, z, x, y int, r io.Reader) error {
	p := s.path(layer, z, x, y)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), p)
}

// Downloader fills a Store from the upstream sources.
type Downloader struct {
	store       *Store
	client      *http.Client
	userAgent   string
	concurrency int
	interval    time.Duration // minimum spacing between requests
}

func NewDownloader(store *Store, client *http.Client, userAgent string, concurrency int, interval time.Duration) *Downloader {
	if concurrency < 1 {
		concurrency = 1
	}
	return &Downloader{store: store, client: client, userAgent: userAgent, concurrency: concurrency, interval: interval}
}

func (d *Downloader) LayerIDs() []string {
	ids := make([]string, len(d.store.sources))
	for i, s := range d.store.sources {
		ids[i] = s.ID
	}
	return ids
}

type tile struct{ z, x, y int }

// TileXY converts a coordinate to tile indices at zoom z.
func TileXY(lat, lon float64, z int) (x, y int) {
	n := math.Pow(2, float64(z))
	lat = math.Max(-85.0511, math.Min(85.0511, lat))
	x = int(math.Floor((lon + 180) / 360 * n))
	latR := lat * math.Pi / 180
	y = int(math.Floor((1 - math.Log(math.Tan(latR)+1/math.Cos(latR))/math.Pi) / 2 * n))
	max := int(n) - 1
	return clamp(x, 0, max), clamp(y, 0, max)
}

func clamp(v, lo, hi int) int { return int(math.Max(float64(lo), math.Min(float64(hi), float64(v)))) }

// Enumerate lists the tiles covering box for zooms minZ..maxZ.
func Enumerate(box domain.BBox, minZ, maxZ int) []tile {
	var out []tile
	for z := minZ; z <= maxZ; z++ {
		x0, y1 := TileXY(box.MinLat, box.MinLon, z)
		x1, y0 := TileXY(box.MaxLat, box.MaxLon, z)
		for x := x0; x <= x1; x++ {
			for y := y0; y <= y1; y++ {
				out = append(out, tile{z, x, y})
			}
		}
	}
	return out
}

func (d *Downloader) source(id string) (Source, bool) {
	for _, s := range d.store.sources {
		if s.ID == id {
			return s, true
		}
	}
	return Source{}, false
}

// Download fetches every missing tile of the layer inside box.
func (d *Downloader) Download(ctx context.Context, layer string, box domain.BBox, minZ, maxZ int, progress func(done, total int)) error {
	src, ok := d.source(layer)
	if !ok {
		return errors.Join(domain.ErrInvalid, fmt.Errorf("unknown layer %q", layer))
	}
	minZ, maxZ = max(minZ, src.MinZoom), min(maxZ, src.MaxZoom)
	list := Enumerate(box, minZ, maxZ)
	if len(list) > MaxTilesPerLayer {
		return errors.Join(domain.ErrInvalid, fmt.Errorf("%d tiles requested, limit is %d; reduce zoom or area", len(list), MaxTilesPerLayer))
	}
	total := len(list)
	// advance bumps the counter and reports under one lock, so progress
	// callbacks are serialised and never go backwards.
	var (
		pmu  sync.Mutex
		done int
	)
	advance := func(n int) {
		pmu.Lock()
		defer pmu.Unlock()
		done += n
		if progress != nil {
			progress(done, total)
		}
	}
	advance(0)

	work := make(chan tile)
	var tick <-chan time.Time
	if d.interval > 0 {
		t := time.NewTicker(d.interval)
		defer t.Stop()
		tick = t.C
	}
	var (
		wg       sync.WaitGroup
		errOnce  sync.Once
		firstErr error
	)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	for i := 0; i < d.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range work {
				if err := d.fetch(ctx, src, t); err != nil {
					errOnce.Do(func() { firstErr = err; cancel() })
					return
				}
				advance(1)
			}
		}()
	}
feed:
	for _, t := range list {
		if _, err := os.Stat(d.store.path(layer, t.z, t.x, t.y)); err == nil {
			advance(1)
			continue
		}
		if tick != nil {
			select {
			case <-tick:
			case <-ctx.Done():
				break feed
			}
		}
		select {
		case work <- t:
		case <-ctx.Done():
			break feed
		}
	}
	close(work)
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	return ctx.Err()
}

func (d *Downloader) fetch(ctx context.Context, src Source, t tile) error {
	url := strings.NewReplacer("{z}", strconv.Itoa(t.z), "{x}", strconv.Itoa(t.x), "{y}", strconv.Itoa(t.y)).Replace(src.URL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", d.userAgent)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil // no coverage at this tile
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return d.store.put(src.ID, t.z, t.x, t.y, resp.Body)
}
