package domain

import (
	"errors"
	"math"
	"testing"
)

// An out-and-back course along a meridian: 0 → 0.05° north and back (about 5.5 km each way).
func outAndBack() *Course {
	var track []Point
	for i := 0; i <= 50; i++ {
		track = append(track, Point{Lat: float64(i) / 1000, Lon: 0})
	}
	for i := 49; i >= 0; i-- {
		track = append(track, Point{Lat: float64(i) / 1000, Lon: 0})
	}
	return &Course{Track: track, Waypoints: []Waypoint{
		{Name: "Aid 1", Point: Point{Lat: 0.020, Lon: 0.0002}},  // passed going out and coming back
		{Name: "Turnaround", Point: Point{Lat: 0.050, Lon: 0}},  // one pass
		{Name: "Far away", Point: Point{Lat: 0.020, Lon: 0.01}}, // ~1.1 km from the course
	}}
}

func TestDetectPassesOutAndBack(t *testing.T) {
	c := outAndBack()
	c.EnsurePasses()
	aid := c.Waypoints[0].Passes
	if len(aid) != 2 {
		t.Fatalf("aid 1 passes: %+v", aid)
	}
	total := TrackDistance(c.Track)
	if math.Abs(aid[0].DistM-2226) > 30 || math.Abs(aid[1].DistM-(total-2226)) > 30 || !aid[0].Use || !aid[1].Use {
		t.Fatalf("aid 1 passes: %+v (total %.0f)", aid, total)
	}
	if turn := c.Waypoints[1].Passes; len(turn) != 1 || math.Abs(turn[0].DistM-total/2) > 30 {
		t.Fatalf("turnaround: %+v", turn)
	}
	// A waypoint the course never comes close to is still placed, at its nearest point
	// (here equally near the way out and the way back).
	far := c.Waypoints[2].Passes
	if len(far) != 1 || (math.Abs(far[0].DistM-2226) > 30 && math.Abs(far[0].DistM-(total-2226)) > 30) {
		t.Fatalf("far away: %+v", far)
	}
}

func TestEnsurePassesKeepsExistingAndIgnoresShortTracks(t *testing.T) {
	c := outAndBack()
	c.Waypoints[1].Passes = []Pass{{DistM: 5, Use: false}} // already confirmed by the organiser
	c.EnsurePasses()
	if kept := c.Waypoints[1].Passes; len(kept) != 1 || kept[0].DistM != 5 || kept[0].Use {
		t.Fatalf("existing passes must not be replaced: %+v", kept)
	}
	if len(c.Waypoints[0].Passes) == 0 {
		t.Fatal("expected detected passes")
	}
	(&Course{Track: c.Track[:1], Waypoints: []Waypoint{{Name: "x"}}}).EnsurePasses()
	(*Course)(nil).EnsurePasses()
	if got := DetectPasses(c.Track[:1], []float64{0}, Point{}, 75, 500); got != nil {
		t.Fatal("no passes on a one-point track")
	}
}

func TestManyPassesDefaultToFirstAndLast(t *testing.T) {
	// Five laps that each go through the waypoint, then loop away from it.
	var track []Point
	for rep := 0; rep < 5; rep++ {
		track = append(track, Point{Lat: 0, Lon: -0.001}, Point{Lat: 0, Lon: 0.001}, Point{Lat: 0.02, Lon: 0.001}, Point{Lat: 0.02, Lon: -0.001})
	}
	c := &Course{Track: track, Waypoints: []Waypoint{{Name: "Dry Creek", Point: Point{Lat: 0, Lon: 0}}}}
	c.EnsurePasses()
	ps := c.Waypoints[0].Passes
	if len(ps) != 5 {
		t.Fatalf("passes: %+v", ps)
	}
	for i, p := range ps {
		if want := i == 0 || i == 4; p.Use != want {
			t.Fatalf("pass %d use=%v, want %v", i, p.Use, want)
		}
	}
}

func TestSetStopsAndOrder(t *testing.T) {
	c := outAndBack() // Aid 1 twice, Turnaround once, Far away once (4 passes)
	order := c.OrderedPasses()
	if len(order) != 0 {
		t.Fatal("no passes until they are detected")
	}
	c.EnsurePasses()
	order = c.OrderedPasses()
	if len(order) != 4 {
		t.Fatalf("passes: %d", len(order))
	}
	for i := 1; i < len(order); i++ {
		if order[i].DistM < order[i-1].DistM {
			t.Fatal("passes must be in course order")
		}
	}
	mile, cut := 3.2, 1.0
	in := []StopInput{
		{Use: true, Label: " Powerlines ", Mile: &mile, CutoffHours: &cut, Pacer: true, Crew: " Yes/Yes "},
		{Use: true}, {Use: false, Label: "x"}, {Use: true},
	}
	if err := c.SetStops(in); err != nil {
		t.Fatal(err)
	}
	first := order[0]
	if first.Label != "Powerlines" || first.Mile == nil || *first.Mile != 3.2 || *first.CutoffHours != 1 || !first.Pacer || first.Crew != "Yes/Yes" {
		t.Fatalf("details not stored (and trimmed): %+v", first)
	}
	if order[2].Use || order[2].Label != "x" {
		t.Fatalf("use flag / label: %+v", order[2])
	}
	// Wrong number of stops, out-of-range values and over-long text are rejected without changing anything.
	neg, huge := -1.0, 5000.0
	for name, bad := range map[string][]StopInput{
		"count":  in[:2],
		"mile":   {{Mile: &neg}, {}, {}, {}},
		"mile2":  {{Mile: &huge}, {}, {}, {}},
		"cutoff": {{CutoffHours: &neg}, {}, {}, {}},
		"label":  {{Label: string(make([]byte, 200))}, {}, {}, {}},
	} {
		if err := c.SetStops(bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%s should be invalid: %v", name, err)
		}
	}
	if order[0].Label != "Powerlines" {
		t.Fatal("a rejected update must not change anything")
	}
	if err := (*Course)(nil).SetStops(nil); !errors.Is(err, ErrInvalid) {
		t.Fatal("nil course")
	}
	if (*Course)(nil).OrderedPasses() != nil {
		t.Fatal("nil course has no passes")
	}
}

func TestCarryOverKeepsDetailsOfMatchingWaypoints(t *testing.T) {
	old := outAndBack()
	old.EnsurePasses()
	mile := 3.2
	old.Waypoints[0].Passes[0].Mile = &mile
	old.Waypoints[0].Passes[0].Label = "Powerlines out"
	old.Waypoints[0].Passes[1].Use = false
	old.Waypoints[1].Passes[0].Crew = "Yes/Yes"

	fresh := outAndBack()
	fresh.Waypoints[2].Name = "Renamed" // no match: starts from the detected defaults
	fresh.CarryOver(old)
	a := fresh.Waypoints[0].Passes
	if a[0].Label != "Powerlines out" || a[0].Mile == nil || *a[0].Mile != 3.2 || a[1].Use {
		t.Fatalf("details should carry over: %+v", a)
	}
	if fresh.Waypoints[1].Passes[0].Crew != "Yes/Yes" {
		t.Fatal("single-pass waypoint should carry over too")
	}
	if fresh.Waypoints[2].Passes[0].Label != "" || !fresh.Waypoints[2].Passes[0].Use {
		t.Fatalf("renamed waypoint must start fresh: %+v", fresh.Waypoints[2].Passes)
	}
	// Positions come from the new track, not the old one.
	moved := outAndBack()
	for i := range moved.Track {
		moved.Track[i].Lat += 0.0001
	}
	moved.CarryOver(old)
	if moved.Waypoints[0].Passes[0].Label != "Powerlines out" {
		t.Fatal("still carried over")
	}
	// A different number of passes is a different waypoint: nothing is carried over.
	few := outAndBack()
	few.Track = few.Track[:51] // only the way out
	few.CarryOver(old)
	if few.Waypoints[0].Passes[0].Label != "" {
		t.Fatalf("pass counts differ, so nothing should carry over: %+v", few.Waypoints[0].Passes)
	}
	(*Course)(nil).CarryOver(old)
	fresh.CarryOver(nil)
}
