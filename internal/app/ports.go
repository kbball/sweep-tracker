// Package app contains the use cases and the ports (interfaces) that
// adapters implement.
package app

import (
	"context"
	"io"
	"time"

	"github.com/kbball/sweep-tracker/internal/domain"
)

type EventRepository interface {
	List(ctx context.Context) ([]domain.Event, error)
	Get(ctx context.Context, id string) (*domain.Event, error)
	Save(ctx context.Context, e *domain.Event) error
	Delete(ctx context.Context, id string) error
}

type PositionRepository interface {
	Add(ctx context.Context, p *domain.Position) error
	// History returns up to perTracker most recent positions for each named
	// tracker, ordered newest first within each tracker.
	History(ctx context.Context, trackerNames []string, perTracker int) ([]domain.Position, error)
}

type TrackerRepository interface {
	Touch(ctx context.Context, name string, seen time.Time) error
	List(ctx context.Context) ([]domain.Tracker, error)
}

type CourseParser interface {
	Parse(r io.Reader) (*domain.Course, error)
}

// Update is pushed to live viewers when a new position arrives.
type Update struct {
	Position domain.Position `json:"position"`
}

type Broadcaster interface {
	Publish(u Update)
	Subscribe() (updates <-chan Update, cancel func())
}

// TileStore reads offline map tiles.
type TileStore interface {
	Layers() []domain.MapLayer
	Tile(layer string, z, x, y int) (io.ReadCloser, error)
	Count(layer string) int
}

// TileDownloader fetches tiles for a layer into the store.
type TileDownloader interface {
	LayerIDs() []string
	Download(ctx context.Context, layer string, box domain.BBox, minZ, maxZ int, progress func(done, total int)) error
}

type Clock func() time.Time
