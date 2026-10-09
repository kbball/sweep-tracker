package app

import (
	"errors"
	"fmt"
	"time"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// SimTracker simulates one sweep team walking a course, producing messages in
// the tracker's plain-text format. It is used for demos and QA/UAT.
type SimTracker struct {
	Name    string
	track   []domain.Point
	speedMS float64
	total   float64
	dist    float64
}

// NewSimTracker walks track at speedMS (metres per second), starting startM
// metres along it.
func NewSimTracker(name string, track []domain.Point, speedMS, startM float64) (*SimTracker, error) {
	if len(track) < 2 {
		return nil, errors.Join(domain.ErrInvalid, errors.New("course has no track to simulate"))
	}
	if speedMS <= 0 {
		return nil, errors.Join(domain.ErrInvalid, errors.New("speed must be positive"))
	}
	total := domain.TrackDistance(track)
	return &SimTracker{Name: name, track: track, speedMS: speedMS, total: total, dist: min(max(startM, 0), total)}, nil
}

// Step advances dt of simulated time and returns the tracker message for the
// new position. done is true once the end of the track is reached (the final
// message reports the tracker as idle).
func (s *SimTracker) Step(dt time.Duration) (msg string, done bool) {
	s.dist = min(s.dist+s.speedMS*dt.Seconds(), s.total)
	done = s.dist >= s.total
	p := domain.PointAt(s.track, s.dist)
	state := "mv"
	if done {
		state = "idle"
	}
	alt := ""
	if p.Ele != nil {
		alt = fmt.Sprintf(" alt=%.0fft", *p.Ele*metersToFeet)
	}
	bat := 4.15 - 0.45*(s.dist/s.total) // drains over the run
	sats := 7 + int(s.dist/400)%6       // 7..12, wandering as the team moves
	return fmt.Sprintf("%s: %.5f,%.5f%s sats=%d bat=%.2fV %s", s.Name, p.Lat, p.Lon, alt, sats, bat, state), done
}
