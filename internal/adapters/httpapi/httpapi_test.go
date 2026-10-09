package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/kbball/sweep-tracker/internal/adapters/gpx"
	"github.com/kbball/sweep-tracker/internal/adapters/httpapi"
	"github.com/kbball/sweep-tracker/internal/adapters/memory"
	"github.com/kbball/sweep-tracker/internal/adapters/tiles"
	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

const gpxDoc = `<gpx><trk><trkseg><trkpt lat="39.7" lon="-105.0"/><trkpt lat="39.71" lon="-105.0"/></trkseg></trk><wpt lat="39.705" lon="-105.0"><name>Aid</name></wpt></gpx>`

type env struct {
	srv   *httptest.Server
	pos   *app.Positions
	tiles *tiles.Store
}

func setup(t *testing.T) *env {
	t.Helper()
	now := func() time.Time { return time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC) }
	repo := memory.NewEvents()
	hub := memory.NewHub()
	pos := app.NewPositions(memory.NewPositions(), memory.NewTrackers(), repo, hub, now)
	store := tiles.NewStore(t.TempDir(), tiles.DefaultSources)
	dl := tiles.NewDownloader(store, http.DefaultClient, "t", 1, 0)
	s := &httpapi.Server{
		Events: app.NewEvents(repo, gpx.Parser{}, now), Positions: pos, Maps: app.NewMaps(store, dl, repo),
		Version: "9.9.9", Heartbeat: 10 * time.Millisecond,
		Static: fstest.MapFS{"index.html": {Data: []byte("<html>app</html>")}, "assets/a.js": {Data: []byte("js")}},
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &env{srv, pos, store}
}

func (e *env) do(t *testing.T, method, path, body string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func expect(t *testing.T, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("status %d, want %d: %s", got, want, body)
	}
}

func TestEventFlow(t *testing.T) {
	e := setup(t)
	c, b := e.do(t, "GET", "/api/healthz", "")
	expect(t, c, 200, b)
	c, b = e.do(t, "GET", "/api/config", "")
	if !strings.Contains(string(b), `"9.9.9"`) {
		t.Fatal(string(b))
	}

	c, b = e.do(t, "POST", "/api/events", `{"name":"Race","date":"2026-10-10T00:00:00Z","trackers":[{"trackerName":"s1"}]}`)
	expect(t, c, 201, b)
	var ev struct{ ID string }
	_ = json.Unmarshal(b, &ev)

	c, b = e.do(t, "POST", "/api/events", `{"name":""}`)
	expect(t, c, 400, b)
	if strings.Contains(string(b), "invalid\\n") {
		t.Fatal("error message not cleaned: " + string(b))
	}
	c, b = e.do(t, "POST", "/api/events", `{bad`)
	expect(t, c, 400, b)
	c, b = e.do(t, "POST", "/api/events", `{"name":"`+strings.Repeat("x", 2<<20)+`"}`)
	expect(t, c, 400, b)

	c, b = e.do(t, "GET", "/api/events", "")
	expect(t, c, 200, b)
	c, b = e.do(t, "GET", "/api/events/"+ev.ID, "")
	expect(t, c, 200, b)
	c, b = e.do(t, "GET", "/api/events/nope", "")
	expect(t, c, 404, b)
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID, `{"name":"R2","trackers":[{"trackerName":"s1"}]}`)
	expect(t, c, 200, b)
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID, `x`)
	expect(t, c, 400, b)

	// raw GPX body
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID+"/course", gpxDoc)
	expect(t, c, 200, b)
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID+"/course", "junk")
	expect(t, c, 400, b)

	// aid station stops
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID+"/stops", `{"stops":[{"use":false,"label":"Aid","mile":3.2,"cutoffHours":1,"pacer":true,"crew":"Yes/Yes"}]}`)
	expect(t, c, 200, b)
	if !strings.Contains(string(b), `"label":"Aid"`) || !strings.Contains(string(b), `"cutoffHours":1`) || !strings.Contains(string(b), `"use":false`) {
		t.Fatal(string(b))
	}
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID+"/stops", `{"stops":[{},{}]}`)
	expect(t, c, 400, b)
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID+"/stops", `x`)
	expect(t, c, 400, b)
	c, b = e.do(t, "PUT", "/api/events/nope/stops", `{"stops":[]}`)
	expect(t, c, 404, b)
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID, `{"name":"R2","startTime":"12:00","trackers":[{"trackerName":"s1","startM":500}]}`)
	expect(t, c, 200, b)
	if !strings.Contains(string(b), `"startTime":"12:00"`) || !strings.Contains(string(b), `"startM":500`) {
		t.Fatal(string(b))
	}
	c, b = e.do(t, "PUT", "/api/events/"+ev.ID, `{"name":"R2","startTime":"noon"}`)
	expect(t, c, 400, b)

	// multipart
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "c.gpx")
	fw.Write([]byte(gpxDoc))
	mw.Close()
	req, _ := http.NewRequest("PUT", e.srv.URL+"/api/events/"+ev.ID+"/course", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	expect(t, resp.StatusCode, 200, nil)
	var buf2 bytes.Buffer
	mw = multipart.NewWriter(&buf2)
	mw.WriteField("other", "x")
	mw.Close()
	req, _ = http.NewRequest("PUT", e.srv.URL+"/api/events/"+ev.ID+"/course", &buf2)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	expect(t, resp.StatusCode, 400, nil)

	// export / import
	c, exported := e.do(t, "GET", "/api/events/"+ev.ID+"/export", "")
	expect(t, c, 200, exported)
	c, b = e.do(t, "GET", "/api/events/nope/export", "")
	expect(t, c, 404, b)
	c, b = e.do(t, "POST", "/api/events/import", string(exported))
	expect(t, c, 201, b)
	c, b = e.do(t, "POST", "/api/events/import", "nope")
	expect(t, c, 400, b)
	c, b = e.do(t, "POST", "/api/events/import", strings.Repeat("x", 33<<20))
	expect(t, c, 400, b)

	// positions
	_ = e.pos.Ingest(context.Background(), []byte(`{"name":"s1","lat":39.7,"lon":-105,"ts":100}`))
	c, b = e.do(t, "GET", "/api/events/"+ev.ID+"/positions?history=5", "")
	expect(t, c, 200, b)
	if !strings.Contains(string(b), `"lat":39.7`) {
		t.Fatal(string(b))
	}
	c, b = e.do(t, "GET", "/api/events/nope/positions", "")
	expect(t, c, 404, b)
	c, b = e.do(t, "GET", "/api/trackers", "")
	expect(t, c, 200, b)

	c, b = e.do(t, "DELETE", "/api/events/"+ev.ID, "")
	expect(t, c, 204, b)
	c, b = e.do(t, "DELETE", "/api/events/"+ev.ID, "")
	expect(t, c, 404, b)
}

func TestStaticSPA(t *testing.T) {
	e := setup(t)
	for path, want := range map[string]string{"/": "app", "/admin": "app", "/assets/a.js": "js", "/assets": "app"} {
		c, b := e.do(t, "GET", path, "")
		if c != 200 || !strings.Contains(string(b), want) {
			t.Fatalf("%s: %d %s", path, c, b)
		}
	}
	// No static FS configured: unknown paths 404.
	s := &httpapi.Server{}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 404 {
		t.Fatal(rec.Code)
	}
}

func TestTilesAndMaps(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("\x89PNG\r\n\x1a\n....")) }))
	defer ts.Close()
	now := func() time.Time { return time.Now() }
	repo := memory.NewEvents()
	store := tiles.NewStore(t.TempDir(), []tiles.Source{{ID: "topo", Name: "T", URL: ts.URL + "/{z}/{y}/{x}", MaxZoom: 10}})
	maps := app.NewMaps(store, tiles.NewDownloader(store, http.DefaultClient, "t", 2, 0), repo)
	evs := app.NewEvents(repo, gpx.Parser{}, now)
	s := httptest.NewServer((&httpapi.Server{Events: evs, Maps: maps}).Handler())
	defer s.Close()
	e := &env{srv: s}

	c, b := e.do(t, "GET", "/api/maps", "")
	expect(t, c, 200, b)
	c, b = e.do(t, "POST", "/api/maps/refresh", `{bad`)
	expect(t, c, 400, b)
	c, b = e.do(t, "POST", "/api/maps/refresh", `{"eventId":"nope"}`)
	expect(t, c, 404, b)

	created, _ := evs.Create(context.Background(), &domain_Event)
	_, _ = evs.SetCourse(context.Background(), created.ID, strings.NewReader(gpxDoc))
	c, b = e.do(t, "POST", "/api/maps/refresh", `{"eventId":"`+created.ID+`","maxZoom":9,"minZoom":9}`)
	expect(t, c, 202, b)
	maps.Wait()
	c, b = e.do(t, "GET", "/api/maps", "")
	if !strings.Contains(string(b), `"tileCount":`) || strings.Contains(string(b), `"tileCount":0`) {
		t.Fatal(string(b))
	}

	x, y := tiles.TileXY(39.705, -105, 9)
	for _, p := range []string{"/api/tiles/topo/9/%d/%d.png", "/api/tiles/topo/9/%d/%d"} {
		c, b = e.do(t, "GET", sprintf(p, x, y), "")
		if c != 200 || !strings.HasPrefix(string(b), "\x89PNG") {
			t.Fatalf("%d %q", c, b)
		}
	}
	c, b = e.do(t, "GET", "/api/tiles/topo/9/1/1", "")
	expect(t, c, 404, b)
	c, b = e.do(t, "DELETE", "/api/maps", "")
	expect(t, c, 204, b)
	c, b = e.do(t, "GET", sprintf("/api/tiles/topo/9/%d/%d", x, y), "")
	expect(t, c, 404, b)
	if maps.Layers()[0].TileCount != 0 {
		t.Fatal("tiles not cleared")
	}
	c, b = e.do(t, "GET", "/api/tiles/topo/a/1/1", "")
	expect(t, c, 404, b)
}

func TestStream(t *testing.T) {
	e := setup(t)
	resp, err := http.Get(e.srv.URL + "/api/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal(resp.Header)
	}
	r := bufio.NewReader(resp.Body)
	line, _ := r.ReadString('\n') // ": connected"
	if !strings.HasPrefix(line, ":") {
		t.Fatal(line)
	}
	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = e.pos.Ingest(context.Background(), []byte(`{"name":"s1","lat":1,"lon":2}`))
	}()
	deadline := time.After(3 * time.Second)
	found := make(chan bool, 1)
	go func() {
		for {
			l, err := r.ReadString('\n')
			if err != nil {
				found <- false
				return
			}
			if strings.HasPrefix(l, "data: ") && strings.Contains(l, `"trackerName":"s1"`) {
				found <- true
				return
			}
		}
	}()
	select {
	case ok := <-found:
		if !ok {
			t.Fatal("stream ended")
		}
	case <-deadline:
		t.Fatal("no position event")
	}
}

var domain_Event = domain.Event{Name: "Race"}

func sprintf(f string, a ...any) string { return fmt.Sprintf(f, a...) }
