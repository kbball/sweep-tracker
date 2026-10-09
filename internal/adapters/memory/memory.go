// Package memory provides in-process implementations of the repository and
// broadcaster ports. They back the unit tests and the live-update hub.
package memory

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

type Events struct {
	mu sync.Mutex
	m  map[string]domain.Event
}

func NewEvents() *Events { return &Events{m: map[string]domain.Event{}} }

func (r *Events) List(context.Context) ([]domain.Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Event, 0, len(r.m))
	for _, e := range r.m {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date.After(out[j].Date) })
	return out, nil
}

func (r *Events) Get(_ context.Context, id string) (*domain.Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.m[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return &e, nil
}

func (r *Events) Save(_ context.Context, e *domain.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.m[e.ID] = *e
	return nil
}

func (r *Events) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.m[id]; !ok {
		return domain.ErrNotFound
	}
	delete(r.m, id)
	return nil
}

type Positions struct {
	mu   sync.Mutex
	list []domain.Position
}

func NewPositions() *Positions { return &Positions{} }

func (r *Positions) Add(_ context.Context, p *domain.Position) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	p.ID = int64(len(r.list) + 1)
	r.list = append(r.list, *p)
	return nil
}

func (r *Positions) History(_ context.Context, names []string, per int) ([]domain.Position, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.Position
	for _, n := range names {
		var mine []domain.Position
		for _, p := range r.list {
			if p.TrackerName == n {
				mine = append(mine, p)
			}
		}
		sort.Slice(mine, func(i, j int) bool { return mine[i].Time.After(mine[j].Time) })
		if len(mine) > per {
			mine = mine[:per]
		}
		out = append(out, mine...)
	}
	return out, nil
}

type Trackers struct {
	mu sync.Mutex
	m  map[string]time.Time
}

func NewTrackers() *Trackers { return &Trackers{m: map[string]time.Time{}} }

func (r *Trackers) Touch(_ context.Context, name string, seen time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.m[name] = seen
	return nil
}

func (r *Trackers) List(context.Context) ([]domain.Tracker, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Tracker, 0, len(r.m))
	for n, t := range r.m {
		out = append(out, domain.Tracker{Name: n, LastSeen: t})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Hub fans updates out to subscribers. Slow subscribers drop updates rather
// than blocking ingestion.
type Hub struct {
	mu   sync.Mutex
	subs map[chan app.Update]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[chan app.Update]struct{}{}} }

func (h *Hub) Publish(u app.Update) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- u:
		default:
		}
	}
}

func (h *Hub) Subscribe() (<-chan app.Update, func()) {
	ch := make(chan app.Update, 32)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
	}
}
