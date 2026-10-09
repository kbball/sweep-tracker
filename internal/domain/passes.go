package domain

import (
	"errors"
	"math"
)

// Pass is one place where the course goes by a waypoint. Use marks the passes
// that are real visits (an out-and-back course passes an aid station on the
// way out and on the way back; a trail can also just run close to it).
type Pass struct {
	DistM float64 `json:"distM"` // metres along the course
	Use   bool    `json:"use"`
}

const (
	// PassRadiusM is how close the course must come to a waypoint to count as passing it.
	PassRadiusM = 75.0
	// PassGapM merges hits closer together than this along the course into one pass.
	PassGapM = 500.0
)

const metresPerDegree = 111_320.0

// distToSegment returns the distance in metres from p to the segment a-b and
// the fraction (0..1) along the segment of the closest point. A flat-earth
// approximation is accurate enough over a single trail segment.
func distToSegment(p, a, b Point) (d, t float64) {
	k := math.Cos(a.Lat * math.Pi / 180)
	bx, by := (b.Lon-a.Lon)*k*metresPerDegree, (b.Lat-a.Lat)*metresPerDegree
	px, py := (p.Lon-a.Lon)*k*metresPerDegree, (p.Lat-a.Lat)*metresPerDegree
	if l2 := bx*bx + by*by; l2 > 0 {
		t = math.Min(1, math.Max(0, (px*bx+py*by)/l2))
	}
	return math.Hypot(px-t*bx, py-t*by), t
}

// DetectPasses returns the distances along the track (ascending) at which it
// comes within radiusM of p, merging hits closer than gapM together. If the
// track never comes that close it returns the single nearest point, so a
// waypoint slightly off the course is still placed.
func DetectPasses(track []Point, cum []float64, p Point, radiusM, gapM float64) []float64 {
	if len(track) < 2 {
		return nil
	}
	var out []float64
	var bestD, bestAlong, lastAlong float64
	open := false
	nearD, nearAlong := math.Inf(1), 0.0
	for i := 1; i < len(track); i++ {
		d, t := distToSegment(p, track[i-1], track[i])
		along := cum[i-1] + t*(cum[i]-cum[i-1])
		if d < nearD {
			nearD, nearAlong = d, along
		}
		if d > radiusM {
			continue
		}
		if open && along-lastAlong <= gapM {
			if d < bestD {
				bestD, bestAlong = d, along
			}
		} else {
			if open {
				out = append(out, bestAlong)
			}
			bestD, bestAlong, open = d, along, true
		}
		lastAlong = along
	}
	if open {
		out = append(out, bestAlong)
	}
	if len(out) == 0 {
		return []float64{nearAlong}
	}
	return out
}

// EnsurePasses fills in the passes of every waypoint that has none. A waypoint
// with one or two passes uses all of them; with more it starts with the first
// and last, and the organiser confirms the rest (Admin flags these for review).
func (c *Course) EnsurePasses() {
	if c == nil || len(c.Track) < 2 {
		return
	}
	var cum []float64
	for i := range c.Waypoints {
		w := &c.Waypoints[i]
		if len(w.Passes) > 0 {
			continue
		}
		if cum == nil {
			cum = make([]float64, len(c.Track))
			for j := 1; j < len(c.Track); j++ {
				cum[j] = cum[j-1] + Haversine(c.Track[j-1], c.Track[j])
			}
		}
		ds := DetectPasses(c.Track, cum, w.Point, PassRadiusM, PassGapM)
		w.Passes = make([]Pass, len(ds))
		for j, d := range ds {
			w.Passes[j] = Pass{DistM: d, Use: len(ds) <= 2 || j == 0 || j == len(ds)-1}
		}
	}
}

// SetPassUse records which passes are real visits: use has one row per
// waypoint, with one flag per pass.
func (c *Course) SetPassUse(use [][]bool) error {
	if c == nil {
		return errors.Join(ErrInvalid, errors.New("event has no course"))
	}
	c.EnsurePasses()
	if len(use) != len(c.Waypoints) {
		return errors.Join(ErrInvalid, errors.New("expected one row of flags per waypoint"))
	}
	for i, row := range use {
		if len(row) != len(c.Waypoints[i].Passes) {
			return errors.Join(ErrInvalid, errors.New("expected one flag per pass of "+c.Waypoints[i].Name))
		}
	}
	for i, row := range use {
		for j, u := range row {
			c.Waypoints[i].Passes[j].Use = u
		}
	}
	return nil
}
