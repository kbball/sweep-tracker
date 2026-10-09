package app

import (
	"context"
	"log/slog"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// Positions ingests tracker messages and serves the position history.
type Positions struct {
	positions PositionRepository
	trackers  TrackerRepository
	events    EventRepository
	hub       Broadcaster
	now       Clock
}

func NewPositions(p PositionRepository, t TrackerRepository, e EventRepository, hub Broadcaster, now Clock) *Positions {
	return &Positions{positions: p, trackers: t, events: e, hub: hub, now: now}
}

// Ingest handles a raw MQTT payload.
func (s *Positions) Ingest(ctx context.Context, payload []byte) error {
	p, err := ParseMessage(payload, s.now())
	if err != nil {
		return err
	}
	if err := s.positions.Add(ctx, p); err != nil {
		return err
	}
	if err := s.trackers.Touch(ctx, p.TrackerName, p.ReceivedAt); err != nil {
		slog.Warn("touch tracker", "err", err)
	}
	s.hub.Publish(Update{Position: *p})
	return nil
}

// TrackerHistory is the recent track of one sweep team, newest first.
type TrackerHistory struct {
	domain.EventTracker
	Positions []domain.Position `json:"positions"`
}

// ForEvent returns the history of every tracker assigned to the event.
func (s *Positions) ForEvent(ctx context.Context, eventID string, perTracker int) ([]TrackerHistory, error) {
	e, err := s.events.Get(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if perTracker <= 0 || perTracker > 500 {
		perTracker = 10
	}
	names := make([]string, len(e.Trackers))
	for i, t := range e.Trackers {
		names[i] = t.TrackerName
	}
	all, err := s.positions.History(ctx, names, perTracker)
	if err != nil {
		return nil, err
	}
	out := make([]TrackerHistory, len(e.Trackers))
	idx := map[string]int{}
	for i, t := range e.Trackers {
		out[i] = TrackerHistory{EventTracker: t, Positions: []domain.Position{}}
		idx[t.TrackerName] = i
	}
	for _, p := range all {
		if i, ok := idx[p.TrackerName]; ok {
			out[i].Positions = append(out[i].Positions, p)
		}
	}
	return out, nil
}

// Known lists every tracker ever heard on the mesh.
func (s *Positions) Known(ctx context.Context) ([]domain.Tracker, error) {
	return s.trackers.List(ctx)
}

// Subscribe returns live updates.
func (s *Positions) Subscribe() (<-chan Update, func()) { return s.hub.Subscribe() }
