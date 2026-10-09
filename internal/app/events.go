package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// Events manages event configuration and courses.
type Events struct {
	repo   EventRepository
	parser CourseParser
	now    Clock
}

func NewEvents(repo EventRepository, parser CourseParser, now Clock) *Events {
	return &Events{repo: repo, parser: parser, now: now}
}

func NewID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// withPasses fills in aid-station passes for courses stored before they existed.
func withPasses(e *domain.Event) *domain.Event {
	e.Course.EnsurePasses()
	return e
}

func (s *Events) List(ctx context.Context) ([]domain.Event, error) {
	evs, err := s.repo.List(ctx)
	for i := range evs {
		withPasses(&evs[i])
	}
	return evs, err
}

func (s *Events) Get(ctx context.Context, id string) (*domain.Event, error) {
	e, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return withPasses(e), nil
}

func (s *Events) Create(ctx context.Context, e *domain.Event) (*domain.Event, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	e.ID = NewID()
	e.CreatedAt = s.now()
	e.UpdatedAt = e.CreatedAt
	if e.Trackers == nil {
		e.Trackers = []domain.EventTracker{}
	}
	return e, s.repo.Save(ctx, e)
}

// Update replaces the editable fields (name, date, start time, notes, trackers); the
// course is kept.
func (s *Events) Update(ctx context.Context, id string, in *domain.Event) (*domain.Event, error) {
	cur, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(); err != nil {
		return nil, err
	}
	cur.Name, cur.Date, cur.StartTime, cur.Notes, cur.Trackers = in.Name, in.Date, in.StartTime, in.Notes, in.Trackers
	if cur.Trackers == nil {
		cur.Trackers = []domain.EventTracker{}
	}
	cur.UpdatedAt = s.now()
	return cur, s.repo.Save(ctx, cur)
}

func (s *Events) Delete(ctx context.Context, id string) error { return s.repo.Delete(ctx, id) }

// SetCourse parses a GPX stream and stores it as the event's course.
func (s *Events) SetCourse(ctx context.Context, id string, gpx io.Reader) (*domain.Event, error) {
	e, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	c, err := s.parser.Parse(gpx)
	if err != nil {
		return nil, err
	}
	c.EnsurePasses()
	c.CarryOver(e.Course) // keep the organiser's stop details when the GPX is corrected and re-uploaded
	e.Course = c
	e.UpdatedAt = s.now()
	return e, s.repo.Save(ctx, e)
}

// SetStops records the organiser's details for each pass of the course
// (official mile, cutoff, pacer, crew), in course order.
func (s *Events) SetStops(ctx context.Context, id string, stops []domain.StopInput) (*domain.Event, error) {
	e, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := e.Course.SetStops(stops); err != nil {
		return nil, err
	}
	e.UpdatedAt = s.now()
	return e, s.repo.Save(ctx, e)
}

// Export serialises an event into the portable share format.
func (s *Events) Export(ctx context.Context, id string) ([]byte, error) {
	e, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(domain.EventBundle{Schema: domain.BundleSchema, Event: e}, "", "  ")
}

// Import creates a new event (with a fresh ID) from a share bundle.
func (s *Events) Import(ctx context.Context, data []byte) (*domain.Event, error) {
	var b domain.EventBundle
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, errors.Join(domain.ErrInvalid, fmt.Errorf("bad bundle: %w", err))
	}
	if b.Schema != domain.BundleSchema || b.Event == nil {
		return nil, errors.Join(domain.ErrInvalid, errors.New("unsupported bundle"))
	}
	e := b.Event
	if e.Course != nil {
		e.Course.DistanceM = domain.TrackDistance(e.Course.Track)
		e.Course.EnsurePasses()
	}
	return s.Create(ctx, e)
}
