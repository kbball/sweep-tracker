package domain

import (
	"errors"
	"math"
	"testing"
)

func TestHaversineAndDistance(t *testing.T) {
	a, b := Point{Lat: 0, Lon: 0}, Point{Lat: 0, Lon: 1}
	if d := Haversine(a, b); math.Abs(d-111195) > 100 {
		t.Fatalf("got %v", d)
	}
	if d := TrackDistance([]Point{a, b, {Lat: 0, Lon: 2}}); math.Abs(d-222390) > 200 {
		t.Fatalf("got %v", d)
	}
	if TrackDistance(nil) != 0 {
		t.Fatal("empty track")
	}
}

func TestBounds(t *testing.T) {
	var nilCourse *Course
	if _, ok := nilCourse.Bounds(); ok {
		t.Fatal("nil course")
	}
	if _, ok := (&Course{}).Bounds(); ok {
		t.Fatal("empty course")
	}
	c := &Course{Track: []Point{{Lat: 1, Lon: 2}, {Lat: 3, Lon: -4}}, Waypoints: []Waypoint{{Point: Point{Lat: 5, Lon: 0}}}}
	b, ok := c.Bounds()
	if !ok || b.MinLat != 1 || b.MaxLat != 5 || b.MinLon != -4 || b.MaxLon != 2 {
		t.Fatalf("%+v", b)
	}
}

func TestExpand(t *testing.T) {
	b := BBox{MinLat: 40, MaxLat: 41, MinLon: -105, MaxLon: -104}.Expand(1000)
	if b.MinLat >= 40 || b.MaxLat <= 41 || b.MinLon >= -105 || b.MaxLon <= -104 {
		t.Fatalf("%+v", b)
	}
	c := BBox{MinLat: -90, MaxLat: 90, MinLon: -180, MaxLon: 180}.Expand(1e6)
	if c.MinLat != -90 || c.MaxLon != 180 {
		t.Fatalf("clamp %+v", c)
	}
	p := BBox{MinLat: 89.9999, MaxLat: 90}.Expand(10) // near pole: cos clamp
	if math.IsInf(p.MaxLon, 0) {
		t.Fatal("inf")
	}
}

func TestEventValidate(t *testing.T) {
	if err := (&Event{}).Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatal("name required")
	}
	e := &Event{Name: " Race ", Trackers: []EventTracker{{TrackerName: "a"}, {TrackerName: "b", Label: "B", Color: "#fff"}}}
	if err := e.Validate(); err != nil {
		t.Fatal(err)
	}
	if e.Name != "Race" || e.Trackers[0].Label != "a" || e.Trackers[0].Color == "" || e.Trackers[1].Color != "#fff" {
		t.Fatalf("%+v", e)
	}
	if err := (&Event{Name: "x", Trackers: []EventTracker{{TrackerName: " "}}}).Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatal("blank tracker")
	}
	dup := &Event{Name: "x", Trackers: []EventTracker{{TrackerName: "a"}, {TrackerName: "a"}}}
	if err := dup.Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatal("dup tracker")
	}
}

func TestPositionValidate(t *testing.T) {
	if err := (&Position{}).Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatal("name")
	}
	if err := (&Position{TrackerName: "a", HasFix: true, Lat: 91}).Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatal("range")
	}
	if err := (&Position{TrackerName: "a", HasFix: false, Lat: 999}).Validate(); err != nil {
		t.Fatal("no fix ignores coords")
	}
	if err := (&Position{TrackerName: " a ", HasFix: true, Lat: 1, Lon: 1}).Validate(); err != nil {
		t.Fatal(err)
	}
}
