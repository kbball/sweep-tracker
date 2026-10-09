package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// RefreshStatus reports the state of the background tile refresh.
type RefreshStatus struct {
	Running bool   `json:"running"`
	Layer   string `json:"layer,omitempty"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Error   string `json:"error,omitempty"`
}

// Maps manages the offline tile cache.
type Maps struct {
	store  TileStore
	dl     TileDownloader
	events EventRepository

	mu     sync.Mutex
	status RefreshStatus
	wg     sync.WaitGroup
}

func NewMaps(store TileStore, dl TileDownloader, events EventRepository) *Maps {
	return &Maps{store: store, dl: dl, events: events}
}

func (m *Maps) Layers() []domain.MapLayer { return m.store.Layers() }

func (m *Maps) Tile(layer string, z, x, y int) (io.ReadCloser, error) {
	return m.store.Tile(layer, z, x, y)
}

func (m *Maps) Status() RefreshStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

// Wait blocks until a running refresh finishes (used by the CLI and tests).
func (m *Maps) Wait() { m.wg.Wait() }

// Clear deletes every stored tile. It is refused while a refresh is running.
func (m *Maps) Clear() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status.Running {
		return errors.Join(domain.ErrInvalid, errors.New("refresh in progress"))
	}
	return m.store.Clear()
}

// Plan computes the bounding box that a refresh for the event would cover.
func (m *Maps) Plan(ctx context.Context, eventID string, bufferM float64) (domain.BBox, error) {
	e, err := m.events.Get(ctx, eventID)
	if err != nil {
		return domain.BBox{}, err
	}
	b, ok := e.Course.Bounds()
	if !ok {
		return domain.BBox{}, errors.Join(domain.ErrInvalid, errors.New("event has no course"))
	}
	return b.Expand(bufferM), nil
}

// Refresh starts a background download of every layer for the event's area.
func (m *Maps) Refresh(ctx context.Context, eventID string, bufferM float64, minZ, maxZ int) error {
	if minZ < 0 || maxZ > 18 || minZ > maxZ {
		return errors.Join(domain.ErrInvalid, errors.New("invalid zoom range"))
	}
	box, err := m.Plan(ctx, eventID, bufferM)
	if err != nil {
		return err
	}
	m.mu.Lock()
	if m.status.Running {
		m.mu.Unlock()
		return errors.Join(domain.ErrInvalid, errors.New("refresh already running"))
	}
	m.status = RefreshStatus{Running: true}
	m.wg.Add(1)
	m.mu.Unlock()

	go func() {
		defer m.wg.Done()
		var firstErr error
		for _, id := range m.dl.LayerIDs() {
			err := m.dl.Download(context.WithoutCancel(ctx), id, box, minZ, maxZ, func(done, total int) {
				m.mu.Lock()
				m.status.Layer, m.status.Done, m.status.Total = id, done, total
				m.mu.Unlock()
			})
			if err != nil && firstErr == nil {
				firstErr = fmt.Errorf("%s: %w", id, err)
			}
		}
		m.mu.Lock()
		m.status.Running = false
		if firstErr != nil {
			m.status.Error = firstErr.Error()
		}
		m.mu.Unlock()
	}()
	return nil
}
