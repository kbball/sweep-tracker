package memory

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

func TestEventsRepo(t *testing.T) {
	ctx := context.Background()
	r := NewEvents()
	_ = r.Save(ctx, &domain.Event{ID: "a", Date: time.Unix(1, 0)})
	_ = r.Save(ctx, &domain.Event{ID: "b", Date: time.Unix(2, 0)})
	l, _ := r.List(ctx)
	if len(l) != 2 || l[0].ID != "b" {
		t.Fatalf("%+v", l)
	}
	if _, err := r.Get(ctx, "x"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal()
	}
	if err := r.Delete(ctx, "x"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal()
	}
	if err := r.Delete(ctx, "a"); err != nil {
		t.Fatal(err)
	}
}

func TestHub(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe()
	h.Publish(app.Update{})
	if _, ok := <-ch; !ok {
		t.Fatal("closed")
	}
	for i := 0; i < 100; i++ { // overflow must not block
		h.Publish(app.Update{})
	}
	cancel()
	cancel() // idempotent
	h.Publish(app.Update{})
}

func TestPositionsAndTrackers(t *testing.T) {
	ctx := context.Background()
	p := NewPositions()
	for i, n := range []string{"a", "a", "b"} {
		_ = p.Add(ctx, &domain.Position{TrackerName: n, Time: time.Unix(int64(i), 0)})
	}
	h, _ := p.History(ctx, []string{"a", "b"}, 1)
	if len(h) != 2 || h[0].Time.Unix() != 1 || h[1].TrackerName != "b" {
		t.Fatalf("%+v", h)
	}
	tr := NewTrackers()
	_ = tr.Touch(ctx, "b", time.Now())
	_ = tr.Touch(ctx, "a", time.Now())
	l, _ := tr.List(ctx)
	if len(l) != 2 || l[0].Name != "a" {
		t.Fatalf("%+v", l)
	}
}
