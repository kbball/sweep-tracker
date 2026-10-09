// Package gpx parses GPX files into domain courses.
package gpx

import (
	"encoding/xml"
	"errors"
	"io"
	"strings"

	"github.com/kbball/sweep-tracker/internal/domain"
)

type Parser struct{}

type file struct {
	Metadata struct {
		Name string `xml:"name"`
	} `xml:"metadata"`
	Waypoints []pt `xml:"wpt"`
	Routes    []struct {
		Name string `xml:"name"`
		Pts  []pt   `xml:"rtept"`
	} `xml:"rte"`
	Tracks []struct {
		Name string `xml:"name"`
		Segs []struct {
			Pts []pt `xml:"trkpt"`
		} `xml:"trkseg"`
	} `xml:"trk"`
}

type pt struct {
	Lat  float64  `xml:"lat,attr"`
	Lon  float64  `xml:"lon,attr"`
	Ele  *float64 `xml:"ele"`
	Name string   `xml:"name"`
	Desc string   `xml:"desc"`
	Type string   `xml:"type"`
	Sym  string   `xml:"sym"`
}

func (p pt) point() domain.Point { return domain.Point{Lat: p.Lat, Lon: p.Lon, Ele: p.Ele} }

// Parse reads a GPX document. Track segments are concatenated; if there is
// no track, the first route is used.
func (Parser) Parse(r io.Reader) (*domain.Course, error) {
	var f file
	if err := xml.NewDecoder(r).Decode(&f); err != nil {
		return nil, errors.Join(domain.ErrInvalid, errors.New("not a valid GPX file: "+err.Error()))
	}
	c := &domain.Course{Name: strings.TrimSpace(f.Metadata.Name), Track: []domain.Point{}, Waypoints: []domain.Waypoint{}}
	for _, t := range f.Tracks {
		if c.Name == "" {
			c.Name = strings.TrimSpace(t.Name)
		}
		for _, s := range t.Segs {
			for _, p := range s.Pts {
				c.Track = append(c.Track, p.point())
			}
		}
	}
	if len(c.Track) == 0 && len(f.Routes) > 0 {
		if c.Name == "" {
			c.Name = strings.TrimSpace(f.Routes[0].Name)
		}
		for _, p := range f.Routes[0].Pts {
			c.Track = append(c.Track, p.point())
		}
	}
	for _, w := range f.Waypoints {
		typ := w.Type
		if typ == "" {
			typ = w.Sym
		}
		c.Waypoints = append(c.Waypoints, domain.Waypoint{Name: strings.TrimSpace(w.Name), Desc: strings.TrimSpace(w.Desc), Type: typ, Point: w.point()})
	}
	if len(c.Track) == 0 && len(c.Waypoints) == 0 {
		return nil, errors.Join(domain.ErrInvalid, errors.New("GPX contains no track, route or waypoints"))
	}
	c.DistanceM = domain.TrackDistance(c.Track)
	return c, nil
}
