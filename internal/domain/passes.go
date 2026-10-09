package domain

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Pass is one place where the course goes by a waypoint. Use marks the passes
// that are real visits (an out-and-back course passes an aid station on the
// way out and on the way back; a trail can also just run close to it).
//
// The details are the organiser's, usually from the runner handbook's aid
// station table; the app can't work them out from the course.
type Pass struct {
	DistM float64 `json:"distM"` // metres along the course
	Use   bool    `json:"use"`

	Label       string   `json:"label,omitempty"`       // handbook name, e.g. "Finish Loop #4 & Leave DC"
	Mile        *float64 `json:"mile,omitempty"`        // official mile (can differ from the GPX distance)
	CutoffHours *float64 `json:"cutoffHours,omitempty"` // cutoff, in hours after the race start
	Pacer       bool     `json:"pacer,omitempty"`       // pacers allowed from here
	Crew        string   `json:"crew,omitempty"`        // crew access / drop bag, as printed ("Yes/Yes", "NO DROPS")
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

// StopInput is what the organiser says about one pass of the course.
type StopInput struct {
	Use         bool     `json:"use"`
	Label       string   `json:"label"`
	Mile        *float64 `json:"mile"`
	CutoffHours *float64 `json:"cutoffHours"`
	Pacer       bool     `json:"pacer"`
	Crew        string   `json:"crew"`
}

// OrderedPasses lists every pass of every waypoint in course order.
func (c *Course) OrderedPasses() []*Pass {
	if c == nil {
		return nil
	}
	var out []*Pass
	for i := range c.Waypoints {
		for j := range c.Waypoints[i].Passes {
			out = append(out, &c.Waypoints[i].Passes[j])
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].DistM < out[b].DistM })
	return out
}

// SetStops records the organiser's details for each pass, in course order
// (one entry per pass, see OrderedPasses).
func (c *Course) SetStops(in []StopInput) error {
	if c == nil {
		return errors.Join(ErrInvalid, errors.New("event has no course"))
	}
	c.EnsurePasses()
	passes := c.OrderedPasses()
	if len(in) != len(passes) {
		return errors.Join(ErrInvalid, fmt.Errorf("expected %d stops (one per pass of the course), got %d", len(passes), len(in)))
	}
	for i, s := range in {
		if s.Mile != nil && (*s.Mile < 0 || *s.Mile > 1000) {
			return errors.Join(ErrInvalid, fmt.Errorf("stop %d: mile out of range", i+1))
		}
		if s.CutoffHours != nil && (*s.CutoffHours < 0 || *s.CutoffHours > 24*14) {
			return errors.Join(ErrInvalid, fmt.Errorf("stop %d: cutoff out of range", i+1))
		}
		if len(s.Label) > 120 || len(s.Crew) > 120 {
			return errors.Join(ErrInvalid, fmt.Errorf("stop %d: text too long", i+1))
		}
	}
	for i, s := range in {
		p := passes[i]
		p.Use, p.Label, p.Mile, p.CutoffHours, p.Pacer, p.Crew = s.Use, strings.TrimSpace(s.Label), s.Mile, s.CutoffHours, s.Pacer, strings.TrimSpace(s.Crew)
	}
	return nil
}

// CarryOver copies the organiser's details from a previous version of the
// course (a re-uploaded GPX) onto waypoints with the same name and the same
// number of passes, so correcting the track doesn't lose them.
func (c *Course) CarryOver(old *Course) {
	if c == nil || old == nil {
		return
	}
	c.EnsurePasses()
	taken := make([]bool, len(old.Waypoints))
	for i := range c.Waypoints {
		w := &c.Waypoints[i]
		for j := range old.Waypoints {
			o := &old.Waypoints[j]
			if taken[j] || o.Name != w.Name || len(o.Passes) != len(w.Passes) {
				continue
			}
			taken[j] = true
			for k := range w.Passes {
				d := w.Passes[k].DistM
				w.Passes[k] = o.Passes[k]
				w.Passes[k].DistM = d
			}
			break
		}
	}
}
