package gpx

import (
	"errors"
	"strings"
	"testing"

	"github.com/kbball/sweep-tracker/internal/domain"
)

func TestParseTrackAndWaypoints(t *testing.T) {
	c, err := Parser{}.Parse(strings.NewReader(`<?xml version="1.0"?>
<gpx><metadata><name> My Race </name></metadata>
<wpt lat="1" lon="2"><ele>10</ele><name>Aid</name><desc>d</desc><sym>Aid Station</sym></wpt>
<wpt lat="3" lon="4"><name>X</name><type>water</type></wpt>
<trk><name>ignored</name><trkseg><trkpt lat="0" lon="0"><ele>5</ele></trkpt><trkpt lat="0" lon="1"/></trkseg>
<trkseg><trkpt lat="0" lon="2"/></trkseg></trk></gpx>`))
	if err != nil {
		t.Fatal(err)
	}
	if c.Name != "My Race" || len(c.Track) != 3 || len(c.Waypoints) != 2 || c.DistanceM < 200000 {
		t.Fatalf("%+v", c)
	}
	if c.Track[0].Ele == nil || *c.Track[0].Ele != 5 || c.Track[1].Ele != nil {
		t.Fatal("elevation")
	}
	if c.Waypoints[0].Type != "Aid Station" || c.Waypoints[1].Type != "water" || c.Waypoints[0].Desc != "d" {
		t.Fatalf("%+v", c.Waypoints)
	}
}

func TestParseTrackNameFallback(t *testing.T) {
	c, err := Parser{}.Parse(strings.NewReader(`<gpx><trk><name>Trk</name><trkseg><trkpt lat="0" lon="0"/></trkseg></trk></gpx>`))
	if err != nil || c.Name != "Trk" {
		t.Fatalf("%v %+v", err, c)
	}
}

func TestParseRouteFallback(t *testing.T) {
	c, err := Parser{}.Parse(strings.NewReader(`<gpx><rte><name>R</name><rtept lat="0" lon="0"/><rtept lat="0" lon="1"/></rte></gpx>`))
	if err != nil || c.Name != "R" || len(c.Track) != 2 {
		t.Fatalf("%v %+v", err, c)
	}
}

func TestParseErrors(t *testing.T) {
	for _, in := range []string{"not xml", `<gpx></gpx>`, ""} {
		if _, err := (Parser{}).Parse(strings.NewReader(in)); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("%q: %v", in, err)
		}
	}
}
