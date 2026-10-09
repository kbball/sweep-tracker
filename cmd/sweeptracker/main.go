// Command sweeptracker serves the sweep tracker app and manages offline maps.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/kbball/sweep-tracker/internal/adapters/gpx"
	"github.com/kbball/sweep-tracker/internal/adapters/httpapi"
	"github.com/kbball/sweep-tracker/internal/adapters/memory"
	mqttadapter "github.com/kbball/sweep-tracker/internal/adapters/mqtt"
	"github.com/kbball/sweep-tracker/internal/adapters/postgres"
	"github.com/kbball/sweep-tracker/internal/adapters/tiles"
	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/config"
	"github.com/kbball/sweep-tracker/internal/domain"
	"github.com/kbball/sweep-tracker/web"
)

// version is set at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

// tileSources is a variable so tests can point it at a local server.
var tileSources = tiles.DefaultSources

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, env func(string) string, out io.Writer) error {
	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "serve":
		return serve(ctx, env)
	case "maps":
		return mapsCmd(ctx, args, env, out)
	case "simulate":
		return simulateCmd(ctx, args, env, out)
	case "version":
		fmt.Fprintln(out, version)
		return nil
	}
	return fmt.Errorf("unknown command %q (serve | maps download | simulate | version)", cmd)
}

func newTiles(cfg config.Config) (*tiles.Store, *tiles.Downloader) {
	store := tiles.NewStore(cfg.TileDir, tileSources)
	dl := tiles.NewDownloader(store, &http.Client{Timeout: 30 * time.Second},
		"sweep-tracker/"+version, 4, cfg.TileInterval())
	return store, dl
}

func serve(ctx context.Context, env func(string) string) error {
	cfg, err := config.Load(env)
	if err != nil {
		return err
	}
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer db.Close()

	store, dl := newTiles(cfg)
	events := db.Events()
	hub := memory.NewHub()
	now := func() time.Time { return time.Now().UTC() }
	positions := app.NewPositions(db.Positions(), db.Trackers(), events, hub, now)
	static, err := web.Dist()
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: (&httpapi.Server{
			Events:    app.NewEvents(events, gpx.Parser{}, now),
			Positions: positions,
			Maps:      app.NewMaps(store, dl, events),
			Version:   version,
			Static:    static,
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	if cfg.MQTTBroker != "" {
		sub := mqttadapter.NewSubscriber(mqttadapter.Config{
			BrokerURL: cfg.MQTTBroker, Topic: cfg.MQTTTopic, ClientID: cfg.MQTTClientID,
			Username: cfg.MQTTUser, Password: cfg.MQTTPassword,
		}, positions)
		go func() {
			if err := sub.Run(ctx); err != nil {
				slog.Error("mqtt", "err", err)
			}
		}()
	} else {
		slog.Warn("SWEEP_MQTT_BROKER not set; position ingestion disabled")
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", cfg.Addr, "version", version)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// mapsCmd: `maps download --event <id> [--buffer m] [--min z] [--max z]`
// downloads offline tiles for an event's course; re-run to refresh.
func mapsCmd(ctx context.Context, args []string, env func(string) string, out io.Writer) error {
	if len(args) == 0 || args[0] != "download" {
		return errors.New("usage: sweeptracker maps download --event <id> [--buffer 2500] [--min 6] [--max 15]")
	}
	fs := flag.NewFlagSet("maps download", flag.ContinueOnError)
	fs.SetOutput(out)
	eventID := fs.String("event", "", "event id")
	buffer := fs.Float64("buffer", 2500, "metres around the course to cover")
	minZ := fs.Int("min", 6, "min zoom")
	maxZ := fs.Int("max", 15, "max zoom")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if *eventID == "" {
		return errors.New("--event is required")
	}
	cfg, err := config.Load(env)
	if err != nil {
		return err
	}
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	store, dl := newTiles(cfg)
	m := app.NewMaps(store, dl, db.Events())
	if err := m.Refresh(ctx, *eventID, *buffer, *minZ, *maxZ); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() { m.Wait(); close(done) }()
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			st := m.Status()
			if st.Error != "" {
				return errors.New(st.Error)
			}
			fmt.Fprintln(out, "done")
			return nil
		case <-t.C:
			st := m.Status()
			fmt.Fprintf(out, "%s: %d/%d\n", st.Layer, st.Done, st.Total)
		}
	}
}

// simulateCmd: `simulate --event <id>` walks fake sweep teams along the event's
// course and publishes their positions to the MQTT broker, exactly like real
// trackers, so the whole pipeline (broker → server → map) is exercised.
func simulateCmd(ctx context.Context, args []string, env func(string) string, out io.Writer) error {
	fs := flag.NewFlagSet("simulate", flag.ContinueOnError)
	fs.SetOutput(out)
	eventID := fs.String("event", "", "event id (its course is walked)")
	server := fs.String("server", "http://localhost:8080", "running sweep tracker to read the event from")
	names := fs.String("trackers", "", "comma-separated tracker names (default: the event's trackers)")
	speed := fs.Float64("speed-kmh", 5, "walking speed")
	interval := fs.Duration("interval", 5*time.Second, "time between reports (real time)")
	speedup := fs.Float64("speedup", 1, "simulated seconds per real second (e.g. 30 to run a sweep quickly)")
	stagger := fs.Float64("stagger-m", 0, "start each additional tracker this many metres further along the course")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *eventID == "" {
		return errors.New("--event is required")
	}
	if *interval <= 0 || *speedup <= 0 {
		return errors.New("--interval and --speedup must be positive")
	}
	cfg, err := config.Load(func(k string) string {
		if k == "SWEEP_DATABASE_URL" {
			return "unused" // the simulator never touches the database
		}
		return env(k)
	})
	if err != nil {
		return err
	}
	if cfg.MQTTBroker == "" {
		return errors.New("SWEEP_MQTT_BROKER is required (the broker the server subscribes to)")
	}

	ev, err := fetchEvent(ctx, *server, *eventID)
	if err != nil {
		return err
	}
	var list []string
	if *names != "" {
		list = strings.Split(*names, ",")
	} else {
		for _, t := range ev.Trackers {
			list = append(list, t.TrackerName)
		}
	}
	if len(list) == 0 {
		return errors.New("event has no trackers; assign some in Admin or pass --trackers")
	}
	if ev.Course == nil {
		return errors.New("event has no course; upload a GPX in Admin first")
	}
	sims := make([]*app.SimTracker, len(list))
	for i, n := range list {
		sims[i], err = app.NewSimTracker(strings.TrimSpace(n), ev.Course.Track, *speed/3.6, float64(i)**stagger)
		if err != nil {
			return err
		}
	}

	pub, err := mqttadapter.NewPublisher(mqttadapter.Config{
		BrokerURL: cfg.MQTTBroker, ClientID: fmt.Sprintf("sweep-sim-%d", os.Getpid()),
		Username: cfg.MQTTUser, Password: cfg.MQTTPassword,
	})
	if err != nil {
		return err
	}
	defer pub.Close()
	base := strings.TrimSuffix(strings.TrimSuffix(cfg.MQTTTopic, "#"), "/")

	step := time.Duration(float64(*interval) * *speedup)
	fmt.Fprintf(out, "simulating %d tracker(s) on %q at %.1f km/h\n", len(sims), ev.Name, *speed)
	tick := time.NewTicker(*interval)
	defer tick.Stop()
	for len(sims) > 0 {
		active := sims[:0]
		for _, s := range sims {
			msg, done := s.Step(step)
			if err := pub.Publish(base+"/"+s.Name, []byte(msg)); err != nil {
				return err
			}
			fmt.Fprintln(out, msg)
			if !done {
				active = append(active, s)
			}
		}
		sims = active
		if len(sims) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
	fmt.Fprintln(out, "done")
	return nil
}

func fetchEvent(ctx context.Context, server, id string) (*domain.Event, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(server, "/")+"/api/events/"+id, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("read event from %s: %w", server, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("read event from %s: HTTP %d", server, resp.StatusCode)
	}
	var e domain.Event
	if err := json.NewDecoder(resp.Body).Decode(&e); err != nil {
		return nil, fmt.Errorf("decode event: %w", err)
	}
	return &e, nil
}
