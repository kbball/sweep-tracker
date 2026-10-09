// Package postgres implements the repository ports on PostgreSQL.
package postgres

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/kbball/sweep-tracker/internal/domain"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store owns the connection pool and hands out the repositories.
type Store struct{ pool *pgxpool.Pool }

// Open connects and applies pending goose migrations.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	s := &Store{pool: pool}
	if err := s.Migrate(); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() { s.pool.Close() }

// EventRepo, PositionRepo and TrackerRepo implement the repository ports.
type (
	EventRepo    struct{ pool *pgxpool.Pool }
	PositionRepo struct{ pool *pgxpool.Pool }
	TrackerRepo  struct{ pool *pgxpool.Pool }
)

func (s *Store) Events() EventRepo       { return EventRepo{s.pool} }
func (s *Store) Positions() PositionRepo { return PositionRepo{s.pool} }
func (s *Store) Trackers() TrackerRepo   { return TrackerRepo{s.pool} }

// Migrate runs goose migrations to the latest version.
func (s *Store) Migrate() error {
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(s.pool)
	defer db.Close()
	return goose.Up(db, "migrations")
}

// ---- events ----

const eventCols = `id, name, date, notes, course, created_at, updated_at`

func scanEvent(row pgx.Row) (*domain.Event, error) {
	var e domain.Event
	var course []byte
	if err := row.Scan(&e.ID, &e.Name, &e.Date, &e.Notes, &course, &e.CreatedAt, &e.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	if course != nil {
		e.Course = &domain.Course{}
		if err := json.Unmarshal(course, e.Course); err != nil {
			return nil, err
		}
	}
	e.Trackers = []domain.EventTracker{}
	return &e, nil
}

func (s EventRepo) loadTrackers(ctx context.Context, events []*domain.Event) error {
	for _, e := range events {
		rows, err := s.pool.Query(ctx, `SELECT tracker_name, label, color FROM event_trackers WHERE event_id=$1 ORDER BY sort_order`, e.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var t domain.EventTracker
			if err := rows.Scan(&t.TrackerName, &t.Label, &t.Color); err != nil {
				rows.Close()
				return err
			}
			e.Trackers = append(e.Trackers, t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}

func (s EventRepo) List(ctx context.Context) ([]domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventCols+` FROM events ORDER BY date DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ptrs []*domain.Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		ptrs = append(ptrs, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err := s.loadTrackers(ctx, ptrs); err != nil {
		return nil, err
	}
	out := make([]domain.Event, len(ptrs))
	for i, e := range ptrs {
		out[i] = *e
	}
	return out, nil
}

func (s EventRepo) Get(ctx context.Context, id string) (*domain.Event, error) {
	e, err := scanEvent(s.pool.QueryRow(ctx, `SELECT `+eventCols+` FROM events WHERE id=$1`, id))
	if err != nil {
		return nil, err
	}
	return e, s.loadTrackers(ctx, []*domain.Event{e})
}

func (s EventRepo) Save(ctx context.Context, e *domain.Event) error {
	var course []byte
	if e.Course != nil {
		var err error
		if course, err = json.Marshal(e.Course); err != nil {
			return err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	_, err = tx.Exec(ctx, `
		INSERT INTO events (id, name, date, notes, course, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO UPDATE SET name=$2, date=$3, notes=$4, course=$5, updated_at=$7`,
		e.ID, e.Name, e.Date, e.Notes, course, e.CreatedAt, e.UpdatedAt)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM event_trackers WHERE event_id=$1`, e.ID); err != nil {
		return err
	}
	for i, t := range e.Trackers {
		if _, err = tx.Exec(ctx, `INSERT INTO event_trackers (event_id, tracker_name, label, color, sort_order) VALUES ($1,$2,$3,$4,$5)`,
			e.ID, t.TrackerName, t.Label, t.Color, i); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s EventRepo) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM events WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ---- positions ----

func (s PositionRepo) Add(ctx context.Context, p *domain.Position) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO positions (tracker_name, has_fix, lat, lon, alt, battery_v, moving, ts, received_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		p.TrackerName, p.HasFix, p.Lat, p.Lon, p.Alt, p.BatteryV, p.Moving, p.Time, p.ReceivedAt).Scan(&p.ID)
}

func (s PositionRepo) History(ctx context.Context, names []string, per int) ([]domain.Position, error) {
	if len(names) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, tracker_name, has_fix, lat, lon, alt, battery_v, moving, ts, received_at FROM (
			SELECT *, row_number() OVER (PARTITION BY tracker_name ORDER BY ts DESC, id DESC) AS rn
			FROM positions WHERE tracker_name = ANY($1)
		) q WHERE rn <= $2 ORDER BY tracker_name, ts DESC, id DESC`, names, per)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Position
	for rows.Next() {
		var p domain.Position
		if err := rows.Scan(&p.ID, &p.TrackerName, &p.HasFix, &p.Lat, &p.Lon, &p.Alt, &p.BatteryV, &p.Moving, &p.Time, &p.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---- trackers ----

func (s TrackerRepo) Touch(ctx context.Context, name string, seen time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO trackers (name, last_seen) VALUES ($1,$2)
		ON CONFLICT (name) DO UPDATE SET last_seen = GREATEST(trackers.last_seen, $2)`, name, seen)
	return err
}

func (s TrackerRepo) List(ctx context.Context) ([]domain.Tracker, error) {
	rows, err := s.pool.Query(ctx, `SELECT name, last_seen FROM trackers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Tracker{}
	for rows.Next() {
		var t domain.Tracker
		if err := rows.Scan(&t.Name, &t.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
