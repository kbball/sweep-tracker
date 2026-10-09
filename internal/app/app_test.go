package app_test

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kbball/sweep-tracker/internal/adapters/gpx"
	"github.com/kbball/sweep-tracker/internal/adapters/memory"
	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func clock() time.Time { return t0 }

const sampleGPX = `<gpx><trk><name>T</name><trkseg>
<trkpt lat="40" lon="-105"><ele>1000</ele></trkpt><trkpt lat="40.01" lon="-105"/></trkseg></trk>
<wpt lat="40.005" lon="-105"><name>Aid 1</name></wpt></gpx>`

func TestParseMessage(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
		fix     bool
		moving  bool
		alt     bool
		tm      time.Time
	}{
		{"full", `{"name":"sweep1","lat":40.1,"lon":-105.2,"ts":1790000000,"alt":1500.5,"moving":true}`, false, true, true, true, time.Unix(1790000000, 0).UTC()},
		{"alt keys, string numbers", `{"tracker":"s","latitude":"40.1","lng":"-105.2","timestamp":"2026-10-08T10:00:00Z","altitude":"12","mv":1}`, false, true, true, true, time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC)},
		{"millis", `{"name":"s","lat":1,"lon":1,"time":1790000000000,"battery":3.9}`, false, true, false, false, time.UnixMilli(1790000000000).UTC()},
		{"numeric string ts", `{"name":"s","lat":1,"lon":1,"ts":"1790000000"}`, false, true, false, false, time.Unix(1790000000, 0).UTC()},
		{"bad ts falls back", `{"name":"s","lat":1,"lon":1,"ts":"nope"}`, false, true, false, false, t0},
		{"no coords", `{"name":"s","ts":1790000000}`, false, false, false, false, time.Unix(1790000000, 0).UTC()},
		{"zero coords", `{"name":"s","lat":0,"lon":0}`, false, false, false, false, t0},
		{"fix false", `{"name":"s","lat":1,"lon":1,"fix":false,"moving":"false"}`, false, false, false, false, t0},
		{"fix true string", `{"name":"s","lat":1,"lon":1,"fix":"true"}`, false, true, false, false, t0},
		{"fix garbage ignored", `{"name":"s","lat":1,"lon":1,"fix":[]}`, false, true, false, false, t0},
		{"not json", `hello`, true, false, false, false, t0},
		{"no name", `{"lat":1,"lon":1}`, true, false, false, false, t0},
		{"out of range", `{"name":"s","lat":100,"lon":1}`, true, false, false, false, t0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := app.ParseMessage([]byte(c.in), t0)
			if (err != nil) != c.wantErr {
				t.Fatalf("err=%v", err)
			}
			if c.wantErr {
				if !errors.Is(err, domain.ErrInvalid) {
					t.Fatal("want ErrInvalid")
				}
				return
			}
			if p.HasFix != c.fix || p.Moving != c.moving || (p.Alt != nil) != c.alt || !p.Time.Equal(c.tm) {
				t.Fatalf("%+v", p)
			}
			if !c.fix && (p.Lat != 0 || p.Lon != 0) {
				t.Fatal("coords should be cleared")
			}
		})
	}
}

func TestParseTextMessage(t *testing.T) {
	ok := []struct {
		in     string
		fix    bool
		moving bool
		lat    float64
		lon    float64
		altM   float64
		bat    bool
	}{
		{"Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv", true, true, 33.89057, -84.16948, 955, true},
		{"Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V idle", true, false, 33.89057, -84.16948, 955, true},
		{" Sweep1 : 33.89057, -84.16948 alt=100m idle\n", true, false, 33.89057, -84.16948, 328.084, false},
		{"Sweep1: 1.5,2.5 mv", true, true, 1.5, 2.5, -1, false},
		{"Sweep1: no fix (no position yet) mv", false, true, 0, 0, -1, false},
		{"Sweep1: no fix (no position yet) idle", false, false, 0, 0, -1, false},
		{"Sweep1: hello", false, false, 0, 0, -1, false},
		{"Sweep1: no fix (x) bat=3.77V idle", false, false, 0, 0, -1, true},
	}
	for _, c := range ok {
		p, err := app.ParseMessage([]byte(c.in), t0)
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if p.TrackerName != "Sweep1" || p.HasFix != c.fix || p.Moving != c.moving || p.Lat != c.lat || p.Lon != c.lon || !p.Time.Equal(t0) {
			t.Fatalf("%q: %+v", c.in, p)
		}
		if c.altM >= 0 && (p.Alt == nil || *p.Alt < c.altM-0.01 || *p.Alt > c.altM+0.01) {
			t.Fatalf("%q: alt %v", c.in, p.Alt)
		}
		if (p.BatteryV != nil) != c.bat || (c.bat && *p.BatteryV != 3.77) {
			t.Fatalf("%q: battery %v", c.in, p.BatteryV)
		}
		if c.altM < 0 && p.Alt != nil {
			t.Fatalf("%q: unexpected alt", c.in)
		}
	}
	for _, bad := range []string{"", "no colon here", ": 1,2 mv", "Sweep1: 95.0,10.0 mv"} {
		if _, err := app.ParseMessage([]byte(bad), t0); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("%q: %v", bad, err)
		}
	}
}

func newEvents() (*app.Events, *memory.Events) {
	r := memory.NewEvents()
	return app.NewEvents(r, gpx.Parser{}, clock), r
}

func TestEventsLifecycle(t *testing.T) {
	ctx := context.Background()
	s, _ := newEvents()
	if _, err := s.Create(ctx, &domain.Event{}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("create invalid")
	}
	e, err := s.Create(ctx, &domain.Event{Name: "Race", Date: t0})
	if err != nil || e.ID == "" || e.Trackers == nil {
		t.Fatalf("%v %+v", err, e)
	}
	if _, err = s.SetCourse(ctx, e.ID, strings.NewReader(sampleGPX)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SetCourse(ctx, e.ID, strings.NewReader("junk")); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("bad gpx")
	}
	if _, err = s.SetCourse(ctx, "nope", strings.NewReader(sampleGPX)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing event")
	}
	u, err := s.Update(ctx, e.ID, &domain.Event{Name: "Renamed", Trackers: []domain.EventTracker{{TrackerName: "a"}}})
	if err != nil || u.Name != "Renamed" || u.Course == nil || len(u.Trackers) != 1 {
		t.Fatalf("%v %+v", err, u)
	}
	u, _ = s.Update(ctx, e.ID, &domain.Event{Name: "R"})
	if u.Trackers == nil {
		t.Fatal("trackers should be non-nil")
	}
	if _, err = s.Update(ctx, e.ID, &domain.Event{}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("update invalid")
	}
	if _, err = s.Update(ctx, "nope", &domain.Event{Name: "x"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("update missing")
	}
	if l, _ := s.List(ctx); len(l) != 1 {
		t.Fatal("list")
	}
	if g, err := s.Get(ctx, e.ID); err != nil || g.Name != "R" {
		t.Fatal("get")
	}
	if err = s.Delete(ctx, e.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, e.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("delete twice")
	}
}

func TestAidStationPasses(t *testing.T) {
	ctx := context.Background()
	s, repo := newEvents()
	e, _ := s.Create(ctx, &domain.Event{Name: "Race"})
	if _, err := s.SetPasses(ctx, e.ID, [][]bool{{true}}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("no course yet")
	}
	if _, err := s.SetPasses(ctx, "nope", nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing event")
	}
	got, err := s.SetCourse(ctx, e.ID, strings.NewReader(sampleGPX))
	if err != nil || len(got.Course.Waypoints[0].Passes) != 1 || !got.Course.Waypoints[0].Passes[0].Use {
		t.Fatalf("passes are detected on upload: %v %+v", err, got.Course)
	}
	if _, err = s.SetPasses(ctx, e.ID, [][]bool{{true, true}}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("wrong number of flags")
	}
	upd, err := s.SetPasses(ctx, e.ID, [][]bool{{false}})
	if err != nil || upd.Course.Waypoints[0].Passes[0].Use {
		t.Fatalf("%v %+v", err, upd)
	}
	if g, _ := s.Get(ctx, e.ID); g.Course.Waypoints[0].Passes[0].Use {
		t.Fatal("the choice must be stored")
	}

	// A course stored before passes existed gets them when read, and keeps them when edited.
	legacy := &domain.Event{ID: "old", Name: "Old", Course: &domain.Course{
		Track:     []domain.Point{{Lat: 40, Lon: -105}, {Lat: 40.01, Lon: -105}},
		Waypoints: []domain.Waypoint{{Name: "Aid", Point: domain.Point{Lat: 40.005, Lon: -105}}},
	}}
	_ = repo.Save(ctx, legacy)
	if g, _ := s.Get(ctx, "old"); len(g.Course.Waypoints[0].Passes) != 1 {
		t.Fatal("legacy course should get passes on read")
	}
	found := false
	l, _ := s.List(ctx)
	for _, ev := range l {
		if ev.ID == "old" {
			found = len(ev.Course.Waypoints[0].Passes) == 1
		}
	}
	if !found {
		t.Fatal("legacy course should get passes in lists")
	}
}

func TestExportImport(t *testing.T) {
	ctx := context.Background()
	s, _ := newEvents()
	e, _ := s.Create(ctx, &domain.Event{Name: "Race", Trackers: []domain.EventTracker{{TrackerName: "a"}}})
	if _, err := s.SetCourse(ctx, e.ID, strings.NewReader(sampleGPX)); err != nil {
		t.Fatal(err)
	}
	data, err := s.Export(ctx, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Export(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("export missing")
	}
	imp, err := s.Import(ctx, data)
	if err != nil || imp.ID == e.ID || imp.Course == nil || imp.Course.DistanceM == 0 || len(imp.Trackers) != 1 {
		t.Fatalf("%v %+v", err, imp)
	}
	for _, bad := range []string{`nope`, `{"schema":99,"event":{"name":"x"}}`, `{"schema":1}`, `{"schema":1,"event":{"name":""}}`} {
		if _, err := s.Import(ctx, []byte(bad)); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("%s: %v", bad, err)
		}
	}
	noCourse, _ := s.Import(ctx, []byte(`{"schema":1,"event":{"name":"x"}}`))
	if noCourse.Course != nil {
		t.Fatal("no course expected")
	}
}

type failPositions struct{ memory.Positions }

func (*failPositions) Add(context.Context, *domain.Position) error { return errors.New("boom") }

type failTrackers struct{ memory.Trackers }

func (*failTrackers) Touch(context.Context, string, time.Time) error { return errors.New("boom") }

func TestPositions(t *testing.T) {
	ctx := context.Background()
	ev := memory.NewEvents()
	hub := memory.NewHub()
	tr := memory.NewTrackers()
	pos := app.NewPositions(memory.NewPositions(), tr, ev, hub, clock)
	e := &domain.Event{ID: "e1", Name: "R", Trackers: []domain.EventTracker{{TrackerName: "a", Label: "A"}, {TrackerName: "b", Label: "B"}}}
	_ = ev.Save(ctx, e)

	ch, cancel := pos.Subscribe()
	defer cancel()
	for _, m := range []string{
		`{"name":"a","lat":1,"lon":1,"ts":100}`,
		`{"name":"a","lat":2,"lon":2,"ts":200}`,
		`{"name":"a","ts":300}`,
		`{"name":"zzz","lat":1,"lon":1,"ts":50}`,
	} {
		if err := pos.Ingest(ctx, []byte(m)); err != nil {
			t.Fatal(err)
		}
	}
	if u := <-ch; u.Position.TrackerName != "a" {
		t.Fatal("update")
	}
	if err := pos.Ingest(ctx, []byte("bad")); err == nil {
		t.Fatal("expected error")
	}
	h, err := pos.ForEvent(ctx, "e1", 2)
	if err != nil || len(h) != 2 {
		t.Fatalf("%v %+v", err, h)
	}
	if len(h[0].Positions) != 2 || h[0].Positions[0].HasFix || h[0].Positions[1].Lat != 2 || len(h[1].Positions) != 0 || h[1].Positions == nil {
		t.Fatalf("%+v", h)
	}
	if h, _ = pos.ForEvent(ctx, "e1", 0); len(h[0].Positions) != 3 {
		t.Fatal("default history")
	}
	if _, err = pos.ForEvent(ctx, "nope", 1); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing event")
	}
	if k, _ := pos.Known(ctx); len(k) != 2 {
		t.Fatalf("known %v", k)
	}

	bad := app.NewPositions(&failPositions{}, tr, ev, hub, clock)
	if err := bad.Ingest(ctx, []byte(`{"name":"a"}`)); err == nil {
		t.Fatal("repo error should propagate")
	}
	// A tracker-touch failure must not drop the position.
	warn := app.NewPositions(memory.NewPositions(), &failTrackers{}, ev, hub, clock)
	if err := warn.Ingest(ctx, []byte(`{"name":"a"}`)); err != nil {
		t.Fatal(err)
	}
}

type fakeTiles struct{}

func (fakeTiles) Layers() []domain.MapLayer { return []domain.MapLayer{{ID: "topo"}} }
func (fakeTiles) Tile(string, int, int, int) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("x")), nil
}
func (fakeTiles) Count(string) int { return 0 }
func (fakeTiles) Clear() error     { return nil }

type fakeDL struct {
	mu    sync.Mutex
	boxes []domain.BBox
	fail  bool
	gate  chan struct{}
}

func (f *fakeDL) LayerIDs() []string { return []string{"topo", "terrain"} }
func (f *fakeDL) Download(_ context.Context, l string, b domain.BBox, _, _ int, p func(int, int)) error {
	if f.gate != nil {
		<-f.gate
	}
	f.mu.Lock()
	f.boxes = append(f.boxes, b)
	f.mu.Unlock()
	p(1, 2)
	if f.fail && l == "topo" {
		return errors.New("net down")
	}
	return nil
}

func TestMaps(t *testing.T) {
	ctx := context.Background()
	evs, repo := newEvents()
	e, _ := evs.Create(ctx, &domain.Event{Name: "R"})
	dl := &fakeDL{gate: make(chan struct{})}
	m := app.NewMaps(fakeTiles{}, dl, repo)

	if len(m.Layers()) != 1 {
		t.Fatal("layers")
	}
	if r, err := m.Tile("topo", 1, 1, 1); err != nil {
		t.Fatal(err)
	} else {
		r.Close()
	}
	if err := m.Refresh(ctx, e.ID, 100, 5, 4); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("zoom range")
	}
	if err := m.Refresh(ctx, e.ID, 100, 5, 10); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("no course")
	}
	if err := m.Refresh(ctx, "nope", 100, 5, 10); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("no event")
	}
	if _, err := evs.SetCourse(ctx, e.ID, strings.NewReader(sampleGPX)); err != nil {
		t.Fatal(err)
	}
	if err := m.Refresh(ctx, e.ID, 100, 5, 10); err != nil {
		t.Fatal(err)
	}
	if !m.Status().Running {
		t.Fatal("should be running")
	}
	if err := m.Refresh(ctx, e.ID, 100, 5, 10); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("concurrent refresh")
	}
	if err := m.Clear(); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("clear while running")
	}
	close(dl.gate)
	m.Wait()
	if err := m.Clear(); err != nil {
		t.Fatal(err)
	}
	if st := m.Status(); st.Running || st.Error != "" || st.Done != 1 || st.Total != 2 || len(dl.boxes) != 2 {
		t.Fatalf("%+v", st)
	}

	dl2 := &fakeDL{fail: true}
	m2 := app.NewMaps(fakeTiles{}, dl2, repo)
	if err := m2.Refresh(ctx, e.ID, 100, 5, 10); err != nil {
		t.Fatal(err)
	}
	m2.Wait()
	if st := m2.Status(); !strings.Contains(st.Error, "topo") || len(dl2.boxes) != 2 {
		t.Fatalf("%+v", st)
	}
}
