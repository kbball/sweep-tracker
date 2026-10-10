// Package httpapi exposes the application over HTTP: JSON API, live SSE
// stream, offline tiles and the embedded frontend.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

const (
	maxJSONBody   = 1 << 20
	maxUploadBody = 32 << 20
	heartbeat     = 25 * time.Second
)

type Server struct {
	Events    *app.Events
	Positions *app.Positions
	Maps      *app.Maps
	Version   string
	Static    fs.FS  // built frontend; may be nil
	BasePath  string // URL prefix the app is mounted under behind a reverse proxy, e.g. "/sweep"; "" for the root
	Heartbeat time.Duration
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/config", s.config)

	mux.HandleFunc("GET /api/events", s.listEvents)
	mux.HandleFunc("POST /api/events", s.createEvent)
	mux.HandleFunc("POST /api/events/import", s.importEvent)
	mux.HandleFunc("GET /api/events/{id}", s.getEvent)
	mux.HandleFunc("PUT /api/events/{id}", s.updateEvent)
	mux.HandleFunc("DELETE /api/events/{id}", s.deleteEvent)
	mux.HandleFunc("PUT /api/events/{id}/course", s.uploadCourse)
	mux.HandleFunc("PUT /api/events/{id}/stops", s.setStops)
	mux.HandleFunc("GET /api/events/{id}/export", s.exportEvent)
	mux.HandleFunc("GET /api/events/{id}/positions", s.positions)
	mux.HandleFunc("GET /api/trackers", s.trackers)
	mux.HandleFunc("GET /api/stream", s.stream)

	mux.HandleFunc("GET /api/maps", s.maps)
	mux.HandleFunc("POST /api/maps/refresh", s.refreshMaps)
	mux.HandleFunc("DELETE /api/maps", s.clearMaps)
	mux.HandleFunc("GET /api/tiles/{layer}/{z}/{x}/{y}", s.tile)

	if s.Static != nil {
		mux.Handle("/", spa(s.Static, s.BasePath))
	}
	return mux
}

func (s *Server) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"version": s.Version})
}

// ---- events ----

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	evs, err := s.Events.List(r.Context())
	respond(w, evs, err)
}

func (s *Server) getEvent(w http.ResponseWriter, r *http.Request) {
	e, err := s.Events.Get(r.Context(), r.PathValue("id"))
	respond(w, e, err)
}

func (s *Server) createEvent(w http.ResponseWriter, r *http.Request) {
	var in domain.Event
	if !decode(w, r, &in) {
		return
	}
	in.Course = nil
	e, err := s.Events.Create(r.Context(), &in)
	respondStatus(w, http.StatusCreated, e, err)
}

func (s *Server) updateEvent(w http.ResponseWriter, r *http.Request) {
	var in domain.Event
	if !decode(w, r, &in) {
		return
	}
	e, err := s.Events.Update(r.Context(), r.PathValue("id"), &in)
	respond(w, e, err)
}

func (s *Server) deleteEvent(w http.ResponseWriter, r *http.Request) {
	if err := s.Events.Delete(r.Context(), r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) uploadCourse(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBody)
	var body io.Reader = r.Body
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		f, _, err := r.FormFile("file")
		if err != nil {
			fail(w, errors.Join(domain.ErrInvalid, errors.New("multipart field 'file' is required")))
			return
		}
		defer f.Close()
		body = f
	}
	e, err := s.Events.SetCourse(r.Context(), r.PathValue("id"), body)
	respond(w, e, err)
}

// setStops stores the organiser's details for each pass of the course, in course order.
func (s *Server) setStops(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Stops []domain.StopInput `json:"stops"`
	}
	if !decode(w, r, &in) {
		return
	}
	e, err := s.Events.SetStops(r.Context(), r.PathValue("id"), in.Stops)
	respond(w, e, err)
}

func (s *Server) exportEvent(w http.ResponseWriter, r *http.Request) {
	data, err := s.Events.Export(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="event-%s.sweep.json"`, r.PathValue("id")))
	_, _ = w.Write(data)
}

func (s *Server) importEvent(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUploadBody))
	if err != nil {
		fail(w, errors.Join(domain.ErrInvalid, err))
		return
	}
	e, err := s.Events.Import(r.Context(), data)
	respondStatus(w, http.StatusCreated, e, err)
}

// ---- positions ----

func (s *Server) positions(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("history"))
	h, err := s.Positions.ForEvent(r.Context(), r.PathValue("id"), n)
	respond(w, h, err)
}

func (s *Server) trackers(w http.ResponseWriter, r *http.Request) {
	t, err := s.Positions.Known(r.Context())
	respond(w, t, err)
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	updates, cancel := s.Positions.Subscribe()
	defer cancel()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	fmt.Fprint(w, ": connected\n\n")
	fl.Flush()
	hb := s.Heartbeat
	if hb == 0 {
		hb = heartbeat
	}
	tick := time.NewTicker(hb)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			fmt.Fprint(w, ": ping\n\n")
		case u, ok := <-updates:
			if !ok {
				return
			}
			b, _ := json.Marshal(u.Position)
			fmt.Fprintf(w, "event: position\ndata: %s\n\n", b)
		}
		fl.Flush()
	}
}

// ---- maps ----

func (s *Server) maps(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"layers": s.Maps.Layers(), "status": s.Maps.Status()})
}

func (s *Server) refreshMaps(w http.ResponseWriter, r *http.Request) {
	var in struct {
		EventID string  `json:"eventId"`
		BufferM float64 `json:"bufferM"`
		MinZoom int     `json:"minZoom"`
		MaxZoom int     `json:"maxZoom"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.BufferM == 0 {
		in.BufferM = 2500
	}
	if in.MaxZoom == 0 {
		in.MaxZoom = 15
	}
	if in.MinZoom == 0 {
		in.MinZoom = 6
	}
	if err := s.Maps.Refresh(r.Context(), in.EventID, in.BufferM, in.MinZoom, in.MaxZoom); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, s.Maps.Status())
}

func (s *Server) clearMaps(w http.ResponseWriter, _ *http.Request) {
	if err := s.Maps.Clear(); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) tile(w http.ResponseWriter, r *http.Request) {
	z, e1 := strconv.Atoi(r.PathValue("z"))
	x, e2 := strconv.Atoi(r.PathValue("x"))
	y, e3 := strconv.Atoi(strings.TrimSuffix(r.PathValue("y"), ".png"))
	if e1 != nil || e2 != nil || e3 != nil {
		http.NotFound(w, r)
		return
	}
	f, err := s.Maps.Tile(r.PathValue("layer"), z, x, y)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	w.Header().Set("Content-Type", http.DetectContentType(head[:n]))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(head[:n])
	_, _ = io.Copy(w, f)
}

// ---- helpers ----

var baseTag = regexp.MustCompile(`<base\s+href="[^"]*"\s*/?>`)

// normalizeBasePath returns "" for the root, otherwise a path with a leading
// slash and no trailing slash ("sweep/" -> "/sweep").
func normalizeBasePath(p string) string {
	p = strings.Trim(strings.TrimSpace(p), "/")
	if p == "" {
		return ""
	}
	return "/" + p
}

// spa serves the built frontend and falls back to index.html for client-side
// routes. The reverse proxy strips basePath from request URLs; it is only used
// to rewrite index.html's <base href>, so the browser builds asset, API and
// router URLs under the prefix.
func spa(static fs.FS, basePath string) http.Handler {
	basePath = normalizeBasePath(basePath)
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if p != "" {
			if st, err := fs.Stat(static, p); err == nil && !st.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
		}
		b, err := fs.ReadFile(static, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if basePath != "" {
			b = baseTag.ReplaceAll(b, []byte(`<base href="`+basePath+`/" />`))
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(b)
	})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	if err := dec.Decode(v); err != nil {
		fail(w, errors.Join(domain.ErrInvalid, fmt.Errorf("bad JSON: %w", err)))
		return false
	}
	return true
}

func respond(w http.ResponseWriter, v any, err error) { respondStatus(w, http.StatusOK, v, err) }

func respondStatus(w http.ResponseWriter, code int, v any, err error) {
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, code, v)
}

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.Is(err, domain.ErrInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": strings.TrimPrefix(err.Error(), "invalid\n")})
	default:
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request too large"})
			return
		}
		slog.Error("request failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
