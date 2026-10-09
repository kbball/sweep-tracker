// Package domain holds the core entities of the sweep tracker. It has no
// dependencies on infrastructure.
package domain

import (
	"errors"
	"math"
	"strings"
	"time"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid")
)

// Point is a geographic location with optional elevation in metres.
type Point struct {
	Lat float64  `json:"lat"`
	Lon float64  `json:"lon"`
	Ele *float64 `json:"ele,omitempty"`
}

// Waypoint is a named point of interest on a course (aid station, junction...).
type Waypoint struct {
	Name string `json:"name"`
	Desc string `json:"desc,omitempty"`
	Type string `json:"type,omitempty"`
	// Passes are the places the course goes by this waypoint (an out-and-back
	// course passes each aid station twice). See Course.EnsurePasses.
	Passes []Pass `json:"passes,omitempty"`
	Point
}

// BBox is a lat/lon bounding box.
type BBox struct {
	MinLat float64 `json:"minLat"`
	MinLon float64 `json:"minLon"`
	MaxLat float64 `json:"maxLat"`
	MaxLon float64 `json:"maxLon"`
}

// Course is the parsed content of a GPX file.
type Course struct {
	Name      string     `json:"name"`
	Track     []Point    `json:"track"`
	Waypoints []Waypoint `json:"waypoints"`
	DistanceM float64    `json:"distanceM"`
}

// Bounds returns the bounding box of the track and waypoints.
func (c *Course) Bounds() (BBox, bool) {
	if c == nil {
		return BBox{}, false
	}
	b := BBox{MinLat: 90, MinLon: 180, MaxLat: -90, MaxLon: -180}
	n := 0
	add := func(p Point) {
		b.MinLat, b.MaxLat = math.Min(b.MinLat, p.Lat), math.Max(b.MaxLat, p.Lat)
		b.MinLon, b.MaxLon = math.Min(b.MinLon, p.Lon), math.Max(b.MaxLon, p.Lon)
		n++
	}
	for _, p := range c.Track {
		add(p)
	}
	for _, w := range c.Waypoints {
		add(w.Point)
	}
	return b, n > 0
}

// Expand grows the box by the given number of metres on every side.
func (b BBox) Expand(metres float64) BBox {
	dLat := metres / 111_320.0
	cos := math.Cos((b.MinLat + b.MaxLat) / 2 * math.Pi / 180)
	if cos < 0.01 {
		cos = 0.01
	}
	dLon := metres / (111_320.0 * cos)
	return BBox{
		MinLat: math.Max(-90, b.MinLat-dLat), MaxLat: math.Min(90, b.MaxLat+dLat),
		MinLon: math.Max(-180, b.MinLon-dLon), MaxLon: math.Min(180, b.MaxLon+dLon),
	}
}

// Haversine returns the great-circle distance between two points in metres.
func Haversine(a, b Point) float64 {
	const r = 6_371_000.0
	rad := math.Pi / 180
	dLat, dLon := (b.Lat-a.Lat)*rad, (b.Lon-a.Lon)*rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(h))
}

// TrackDistance sums the length of a track in metres.
func TrackDistance(pts []Point) float64 {
	var d float64
	for i := 1; i < len(pts); i++ {
		d += Haversine(pts[i-1], pts[i])
	}
	return d
}

// Event is a race/event configuration that can be shared between aid stations.
type Event struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Date      time.Time      `json:"date"`
	Notes     string         `json:"notes"`
	Course    *Course        `json:"course,omitempty"`
	Trackers  []EventTracker `json:"trackers"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

// EventTracker assigns a physical tracker (by its mesh name) to an event
// with a display label and colour.
type EventTracker struct {
	TrackerName string `json:"trackerName"`
	Label       string `json:"label"`
	Color       string `json:"color"`
}

// Validate checks the event fields.
func (e *Event) Validate() error {
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		return errors.Join(ErrInvalid, errors.New("event name is required"))
	}
	seen := map[string]bool{}
	for i := range e.Trackers {
		t := &e.Trackers[i]
		t.TrackerName = strings.TrimSpace(t.TrackerName)
		if t.TrackerName == "" {
			return errors.Join(ErrInvalid, errors.New("tracker name is required"))
		}
		if seen[t.TrackerName] {
			return errors.Join(ErrInvalid, errors.New("duplicate tracker "+t.TrackerName))
		}
		seen[t.TrackerName] = true
		if t.Label == "" {
			t.Label = t.TrackerName
		}
		if t.Color == "" {
			t.Color = DefaultColors[i%len(DefaultColors)]
		}
	}
	return nil
}

// DefaultColors is the palette used for sweep teams without an explicit colour.
var DefaultColors = []string{"#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080"}

// Position is one report received from a tracker.
type Position struct {
	ID          int64     `json:"id"`
	TrackerName string    `json:"trackerName"`
	HasFix      bool      `json:"hasFix"`
	Lat         float64   `json:"lat"`
	Lon         float64   `json:"lon"`
	Alt         *float64  `json:"alt,omitempty"` // feet, as reported by the tracker
	BatteryV    *float64  `json:"batteryV,omitempty"`
	Sats        *int      `json:"sats,omitempty"` // satellites in view, as reported by the tracker
	Moving      bool      `json:"moving"`
	Time        time.Time `json:"time"`
	ReceivedAt  time.Time `json:"receivedAt"`
}

// Validate checks a position report.
func (p *Position) Validate() error {
	p.TrackerName = strings.TrimSpace(p.TrackerName)
	if p.TrackerName == "" {
		return errors.Join(ErrInvalid, errors.New("tracker name is required"))
	}
	if p.HasFix && (p.Lat < -90 || p.Lat > 90 || p.Lon < -180 || p.Lon > 180) {
		return errors.Join(ErrInvalid, errors.New("coordinates out of range"))
	}
	return nil
}

// Tracker is a device seen on the mesh.
type Tracker struct {
	Name     string    `json:"name"`
	LastSeen time.Time `json:"lastSeen"`
}

// EventBundle is the portable share format for an event.
type EventBundle struct {
	Schema int    `json:"schema"`
	Event  *Event `json:"event"`
}

const BundleSchema = 1

// MapLayer describes an offline tile layer.
type MapLayer struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Attribution string `json:"attribution"`
	MinZoom     int    `json:"minZoom"`
	MaxZoom     int    `json:"maxZoom"`
	TileCount   int    `json:"tileCount"`
	SizeBytes   int64  `json:"sizeBytes"` // disk space used by the stored tiles
	// MinTileZoom and MaxTileZoom are the shallowest and deepest zoom levels with downloaded tiles (0 if none).
	MinTileZoom int `json:"minTileZoom"`
	MaxTileZoom int `json:"maxTileZoom"`
}

// PointAt returns the location distM metres along the track, clamped to its
// ends, with elevation interpolated when both neighbours have it.
func PointAt(track []Point, distM float64) Point {
	if len(track) == 0 {
		return Point{}
	}
	if distM <= 0 {
		return track[0]
	}
	for i := 1; i < len(track); i++ {
		seg := Haversine(track[i-1], track[i])
		if distM > seg {
			distM -= seg
			continue
		}
		f := 0.0
		if seg > 0 {
			f = distM / seg
		}
		a, b := track[i-1], track[i]
		p := Point{Lat: a.Lat + (b.Lat-a.Lat)*f, Lon: a.Lon + (b.Lon-a.Lon)*f}
		if a.Ele != nil && b.Ele != nil {
			e := *a.Ele + (*b.Ele-*a.Ele)*f
			p.Ele = &e
		}
		return p
	}
	return track[len(track)-1]
}
