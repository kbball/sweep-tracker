package postgres_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kbball/sweep-tracker/internal/adapters/postgres"
	"github.com/kbball/sweep-tracker/internal/domain"
)

// Requires TEST_DATABASE_URL (see `make db`); skipped otherwise.
func open(t *testing.T) *postgres.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`)
	pool.Close()
	if err != nil {
		t.Fatal(err)
	}
	s, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func TestEvents(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	repo := s.Events()
	now := time.Now().UTC().Truncate(time.Microsecond)
	alt := 1200.0
	e := &domain.Event{ID: "e1", Name: "Race", Date: now, Notes: "n", CreatedAt: now, UpdatedAt: now,
		Trackers: []domain.EventTracker{{TrackerName: "b", Label: "B", Color: "#111"}, {TrackerName: "a", Label: "A", Color: "#222"}},
		Course: &domain.Course{Name: "C", DistanceM: 5, Track: []domain.Point{{Lat: 1, Lon: 2, Ele: &alt}},
			Waypoints: []domain.Waypoint{{Name: "Aid", Point: domain.Point{Lat: 1, Lon: 2}}}}}
	if err := repo.Save(ctx, e); err != nil {
		t.Fatal(err)
	}
	got, err := repo.Get(ctx, "e1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Race" || len(got.Trackers) != 2 || got.Trackers[0].TrackerName != "b" || got.Course == nil || *got.Course.Track[0].Ele != 1200 || got.Course.Waypoints[0].Name != "Aid" {
		t.Fatalf("%+v", got)
	}

	// update: drop course and a tracker
	e.Course, e.Trackers, e.Name = nil, e.Trackers[:1], "Renamed"
	if err := repo.Save(ctx, e); err != nil {
		t.Fatal(err)
	}
	got, _ = repo.Get(ctx, "e1")
	if got.Course != nil || len(got.Trackers) != 1 || got.Name != "Renamed" {
		t.Fatalf("%+v", got)
	}
	l, err := repo.List(ctx)
	if err != nil || len(l) != 1 || len(l[0].Trackers) != 1 {
		t.Fatalf("%v %+v", err, l)
	}
	if _, err = repo.Get(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("get missing")
	}
	if err = repo.Delete(ctx, "e1"); err != nil {
		t.Fatal(err)
	}
	if err = repo.Delete(ctx, "e1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("delete missing")
	}
	if l, _ = repo.List(ctx); len(l) != 0 {
		t.Fatal("list after delete")
	}
}

func TestPositionsAndTrackers(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	pr, tr := s.Positions(), s.Trackers()
	base := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	alt := 10.0
	sats := 9
	add := func(name string, min int, fix bool) {
		p := &domain.Position{TrackerName: name, HasFix: fix, Time: base.Add(time.Duration(min) * time.Minute), ReceivedAt: base}
		if fix {
			p.Lat, p.Lon, p.Alt, p.Moving, p.BatteryV, p.Sats = 40, -105, &alt, true, &alt, &sats
		}
		if err := pr.Add(ctx, p); err != nil || p.ID == 0 {
			t.Fatalf("%v %d", err, p.ID)
		}
	}
	add("a", 1, true)
	add("a", 3, false)
	add("a", 2, true)
	add("b", 1, true)
	add("c", 1, true)

	h, err := pr.History(ctx, []string{"a", "b"}, 2)
	if err != nil || len(h) != 3 {
		t.Fatalf("%v %+v", err, h)
	}
	if h[0].TrackerName != "a" || h[0].HasFix || !h[1].HasFix || !h[1].Time.Equal(base.Add(2*time.Minute)) || *h[1].Alt != 10 || h[1].BatteryV == nil || *h[1].BatteryV != 10 || h[0].BatteryV != nil || !h[1].Moving || h[1].Sats == nil || *h[1].Sats != 9 || h[0].Sats != nil {
		t.Fatalf("%+v", h)
	}
	if h, err = pr.History(ctx, nil, 2); err != nil || h != nil {
		t.Fatal("empty names")
	}

	if err = tr.Touch(ctx, "a", base); err != nil {
		t.Fatal(err)
	}
	_ = tr.Touch(ctx, "a", base.Add(-time.Hour)) // older must not rewind
	_ = tr.Touch(ctx, "b", base)
	l, err := tr.List(ctx)
	if err != nil || len(l) != 2 || l[0].Name != "a" || !l[0].LastSeen.Equal(base) {
		t.Fatalf("%v %+v", err, l)
	}
}

func TestOpenErrors(t *testing.T) {
	ctx := context.Background()
	if _, err := postgres.Open(ctx, "postgres://x:y@127.0.0.1:1/db?connect_timeout=1"); err == nil {
		t.Fatal("expected ping error")
	}
	if _, err := postgres.Open(ctx, "::bad"); err == nil {
		t.Fatal("expected parse error")
	}
}
