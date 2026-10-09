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

func (s *Events) List(ctx context.Context) ([]domain.Event, error) { return s.repo.List(ctx) }

func (s *Events) Get(ctx context.Context, id string) (*domain.Event, error) {
	return s.repo.Get(ctx, id)
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

// Update replaces the editable fields (name, date, notes, trackers); the
// course is kept.
func (s *Events) Update(ctx context.Context, id string, in *domain.Event) (*domain.Event, error) {
	cur, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(); err != nil {
		return nil, err
	}
	cur.Name, cur.Date, cur.Notes, cur.Trackers = in.Name, in.Date, in.Notes, in.Trackers
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
	e.Course = c
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
	}
	return s.Create(ctx, e)
}
