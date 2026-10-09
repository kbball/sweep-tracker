package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kbball/sweep-tracker/internal/adapters/gpx"
	"github.com/kbball/sweep-tracker/internal/adapters/postgres"
	"github.com/kbball/sweep-tracker/internal/adapters/tiles"
	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

func envMap(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestRunSimpleCommands(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"version"}, envMap(nil), &out); err != nil || strings.TrimSpace(out.String()) != "dev" {
		t.Fatalf("%v %q", err, out.String())
	}
	if err := run(context.Background(), []string{"bogus"}, envMap(nil), &out); err == nil {
		t.Fatal("unknown command")
	}
	if err := run(context.Background(), nil, envMap(nil), &out); err == nil {
		t.Fatal("serve without config must fail")
	}
	for _, args := range [][]string{{"maps"}, {"maps", "nope"}, {"maps", "download"}, {"maps", "download", "--bogus"}} {
		if err := run(context.Background(), args, envMap(nil), &out); err == nil {
			t.Fatalf("%v should fail", args)
		}
	}
	if err := run(context.Background(), []string{"maps", "download", "--event", "x"}, envMap(nil), &out); err == nil {
		t.Fatal("maps without config must fail")
	}
}

func testDB(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(context.Background(), `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	return url
}

func TestServeStartsAndStops(t *testing.T) {
	url := testDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, []string{"serve"}, envMap(map[string]string{
			"SWEEP_DATABASE_URL": url, "SWEEP_ADDR": "127.0.0.1:0", "SWEEP_TILE_DIR": t.TempDir(),
			"SWEEP_MQTT_BROKER": "tcp://127.0.0.1:1", // unreachable: must not block startup
		}), nil)
	}()
	time.Sleep(500 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not stop")
	}
}

func TestServeErrors(t *testing.T) {
	testDB(t)
	if err := serve(context.Background(), envMap(map[string]string{"SWEEP_DATABASE_URL": "postgres://x:y@127.0.0.1:1/db?connect_timeout=1"})); err == nil {
		t.Fatal("db down")
	}
	url := os.Getenv("TEST_DATABASE_URL")
	err := serve(context.Background(), envMap(map[string]string{"SWEEP_DATABASE_URL": url, "SWEEP_ADDR": "256.0.0.1:99999"}))
	if err == nil {
		t.Fatal("bad listen address")
	}
}

func TestMapsDownload(t *testing.T) {
	url := testDB(t)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("tile")) }))
	defer ts.Close()
	old := tileSources
	tileSources = []tiles.Source{{ID: "topo", Name: "T", URL: ts.URL + "/{z}/{y}/{x}", MaxZoom: 10}}
	defer func() { tileSources = old }()

	ctx := context.Background()
	db, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	evs := app.NewEvents(db.Events(), gpx.Parser{}, func() time.Time { return time.Now() })
	e, _ := evs.Create(ctx, &domain.Event{Name: "Race"})
	_, err = evs.SetCourse(ctx, e.ID, strings.NewReader(`<gpx><trk><trkseg><trkpt lat="39.7" lon="-105"/><trkpt lat="39.71" lon="-105"/></trkseg></trk></gpx>`))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	env := envMap(map[string]string{"SWEEP_DATABASE_URL": url, "SWEEP_TILE_DIR": t.TempDir(), "SWEEP_TILE_RPS": "1000"})
	var out bytes.Buffer
	if err := run(ctx, []string{"maps", "download", "--event", e.ID, "--min", "9", "--max", "9"}, env, &out); err != nil || !strings.Contains(out.String(), "done") {
		t.Fatalf("%v %q", err, out.String())
	}
	if err := run(ctx, []string{"maps", "download", "--event", "missing"}, env, &out); err == nil {
		t.Fatal("missing event")
	}

	// A failing upstream surfaces as an error.
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 500) }))
	defer bad.Close()
	tileSources = []tiles.Source{{ID: "topo", URL: bad.URL + "/{z}/{y}/{x}", MaxZoom: 10}}
	env = envMap(map[string]string{"SWEEP_DATABASE_URL": url, "SWEEP_TILE_DIR": t.TempDir(), "SWEEP_TILE_RPS": "1000"})
	if err := run(ctx, []string{"maps", "download", "--event", e.ID, "--min", "9", "--max", "9"}, env, &out); err == nil {
		t.Fatal("upstream failure should error")
	}
}
