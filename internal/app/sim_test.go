package app_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

func TestSimTrackerWalksCourseAndParses(t *testing.T) {
	ele := 1000.0
	track := []domain.Point{{Lat: 40, Lon: -105, Ele: &ele}, {Lat: 40.01, Lon: -105, Ele: &ele}} // ~1.1 km
	if _, err := app.NewSimTracker("S", track[:1], 1, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("short track")
	}
	if _, err := app.NewSimTracker("S", track, 0, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatal("zero speed")
	}
	s, err := app.NewSimTracker("Sweep1", track, 5.0/3.6, 0)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	lastLat, steps := 40.0, 0
	for {
		msg, done := s.Step(time.Minute)
		steps++
		p, err := app.ParseMessage([]byte(msg), now)
		if err != nil || !p.HasFix || p.TrackerName != "Sweep1" || p.BatteryV == nil || p.Alt == nil {
			t.Fatalf("%q: %v %+v", msg, err, p)
		}
		if p.Lat < lastLat {
			t.Fatalf("went backwards: %q", msg)
		}
		lastLat = p.Lat
		if done {
			if p.Moving || p.Lat != 40.01 {
				t.Fatalf("should end idle at the finish: %q", msg)
			}
			break
		}
		if !p.Moving {
			t.Fatalf("should be moving: %q", msg)
		}
		if steps > 100 {
			t.Fatal("never finished")
		}
	}
	if steps < 10 || steps > 15 { // 1.1 km at 5 km/h, one report per minute
		t.Fatalf("steps = %d", steps)
	}

	// No elevation: the altitude is omitted. A start offset begins part-way along.
	flat := []domain.Point{{Lat: 40, Lon: -105}, {Lat: 40.01, Lon: -105}}
	s, _ = app.NewSimTracker("S2", flat, 1, 500)
	msg, _ := s.Step(0)
	if strings.Contains(msg, "alt=") || !strings.Contains(msg, "40.004") {
		t.Fatalf("%q", msg)
	}
}
