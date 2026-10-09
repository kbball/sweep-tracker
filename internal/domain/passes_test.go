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

func TestSetPassUse(t *testing.T) {
	c := outAndBack()
	if err := c.SetPassUse([][]bool{{true, false}, {true}, {true}}); err != nil {
		t.Fatal(err)
	}
	if c.Waypoints[0].Passes[1].Use {
		t.Fatal("second pass should be switched off")
	}
	for _, bad := range [][][]bool{{{true}}, {{true, false}, {true, true}, {true}}, nil} {
		if err := c.SetPassUse(bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%v should be invalid", bad)
		}
	}
	if err := (*Course)(nil).SetPassUse(nil); !errors.Is(err, ErrInvalid) {
		t.Fatal("nil course")
	}
}
