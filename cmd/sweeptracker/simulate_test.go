package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	mochi "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"

	"github.com/kbball/sweep-tracker/internal/adapters/memory"
	mqttadapter "github.com/kbball/sweep-tracker/internal/adapters/mqtt"
	"github.com/kbball/sweep-tracker/internal/app"
	"github.com/kbball/sweep-tracker/internal/domain"
)

func startBroker(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	b := mochi.New(nil)
	_ = b.AddHook(new(auth.AllowHook), nil)
	if err := b.AddListener(listeners.NewTCP(listeners.Config{ID: "t", Address: addr})); err != nil {
		t.Fatal(err)
	}
	go b.Serve()
	t.Cleanup(func() { b.Close() })
	time.Sleep(100 * time.Millisecond)
	return "tcp://" + addr
}

// eventServer stands in for the running app's GET /api/events/{id}.
func eventServer(t *testing.T, e *domain.Event) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/events/e1" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(e)
	}))
	t.Cleanup(s.Close)
	return s
}

func simEvent() *domain.Event {
	return &domain.Event{
		ID: "e1", Name: "Demo 50K",
		Course:   &domain.Course{Track: []domain.Point{{Lat: 40, Lon: -105}, {Lat: 40.005, Lon: -105}, {Lat: 40.01, Lon: -105.005}}},
		Trackers: []domain.EventTracker{{TrackerName: "Sweep1"}, {TrackerName: "Sweep2"}},
	}
}

// TestSimulateEndToEnd runs a full simulated sweep through a real MQTT broker
// into the application and checks the teams reach the finish.
func TestSimulateEndToEnd(t *testing.T) {
	broker := startBroker(t)
	ev := simEvent()
	srv := eventServer(t, ev)

	repo := memory.NewEvents()
	pos := memory.NewPositions()
	_ = repo.Save(context.Background(), ev)
	positions := app.NewPositions(pos, memory.NewTrackers(), repo, memory.NewHub(), func() time.Time { return time.Now().UTC() })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go mqttadapter.NewSubscriber(mqttadapter.Config{BrokerURL: broker, Topic: "meshcore/sweep/#", ClientID: "app"}, positions).Run(ctx)
	time.Sleep(300 * time.Millisecond) // let the subscription settle

	env := envMap(map[string]string{"SWEEP_MQTT_BROKER": broker})
	var out bytes.Buffer
	err := run(ctx, []string{"simulate", "--event", "e1", "--server", srv.URL,
		"--interval", "5ms", "--speedup", "1000", "--stagger-m", "100"}, env, &out)
	if err != nil || !strings.HasSuffix(strings.TrimSpace(out.String()), "done") {
		t.Fatalf("%v\n%s", err, out.String())
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		hist, err := positions.ForEvent(context.Background(), ev.ID, 500)
		if err != nil {
			t.Fatal(err)
		}
		finished := 0
		for _, h := range hist {
			if len(h.Positions) > 1 && h.Positions[0].Lat == 40.01 && !h.Positions[0].Moving {
				finished++
			}
		}
		if finished == len(ev.Trackers) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("teams did not reach the finish: %+v", hist)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestSimulateStartMile(t *testing.T) {
	broker := startBroker(t)
	srv := eventServer(t, simEvent())
	env := envMap(map[string]string{"SWEEP_MQTT_BROKER": broker})
	first := func(args ...string) string {
		var out bytes.Buffer
		if err := run(context.Background(), append([]string{"simulate", "--event", "e1", "--server", srv.URL, "--trackers", "One", "--interval", "1ms", "--speedup", "36000"}, args...), env, &out); err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(out.String(), "\n")
		return lines[1] // line 0 is the banner
	}
	lat := func(msg string) float64 {
		var f float64
		if _, err := fmt.Sscanf(strings.SplitN(msg, ": ", 2)[1], "%f,", &f); err != nil {
			t.Fatal(msg, err)
		}
		return f
	}
	atStart, midway := lat(first()), lat(first("--start-mile", "0.5"))
	if midway <= atStart+0.002 { // half a mile is ~800 m, ~0.007° of latitude
		t.Fatalf("start-mile had no effect: %v vs %v", midway, atStart)
	}
}

func TestSimulateStartsEachTeamWhereTheEventSays(t *testing.T) {
	broker := startBroker(t)
	ev := simEvent()
	far := 900.0 // metres along the ~1.1 km course
	ev.Trackers = []domain.EventTracker{{TrackerName: "Early"}, {TrackerName: "Late", StartM: &far}}
	srv := eventServer(t, ev)
	var out bytes.Buffer
	err := run(context.Background(), []string{"simulate", "--event", "e1", "--server", srv.URL, "--interval", "1ms", "--speedup", "36000"},
		envMap(map[string]string{"SWEEP_MQTT_BROKER": broker}), &out)
	if err != nil {
		t.Fatal(err)
	}
	lat := map[string]float64{}
	for _, l := range strings.Split(out.String(), "\n") {
		if name, rest, ok := strings.Cut(l, ": "); ok && lat[name] == 0 {
			var f float64
			if _, err := fmt.Sscanf(rest, "%f,", &f); err == nil {
				lat[name] = f
			}
		}
	}
	// "Late" starts most of the way along; "Early" starts at the beginning (latitude 40).
	if !(lat["Early"] > 0 && lat["Early"] < 40.003 && lat["Late"] > 40.006) {
		t.Fatalf("first reports: %+v\n%s", lat, out.String())
	}
}

func TestSimulateErrors(t *testing.T) {
	broker := startBroker(t)
	srv := eventServer(t, simEvent())
	noCourse := eventServer(t, &domain.Event{ID: "e1", Trackers: []domain.EventTracker{{TrackerName: "S"}}})
	noTrackers := eventServer(t, &domain.Event{ID: "e1", Course: simEvent().Course})
	withBroker := envMap(map[string]string{"SWEEP_MQTT_BROKER": broker})
	badBroker := envMap(map[string]string{"SWEEP_MQTT_BROKER": "tcp://127.0.0.1:1"})

	cases := []struct {
		name string
		args []string
		env  func(string) string
	}{
		{"no event flag", []string{}, withBroker},
		{"bad flag", []string{"--bogus"}, withBroker},
		{"bad interval", []string{"--event", "e1", "--interval", "0s"}, withBroker},
		{"no broker", []string{"--event", "e1", "--server", srv.URL}, envMap(nil)},
		{"unknown event", []string{"--event", "nope", "--server", srv.URL}, withBroker},
		{"server down", []string{"--event", "e1", "--server", "http://127.0.0.1:1"}, withBroker},
		{"no course", []string{"--event", "e1", "--server", noCourse.URL}, withBroker},
		{"no trackers", []string{"--event", "e1", "--server", noTrackers.URL}, withBroker},
		{"bad speed", []string{"--event", "e1", "--server", srv.URL, "--speed-kmh", "0"}, withBroker},
		{"broker down", []string{"--event", "e1", "--server", srv.URL}, badBroker},
	}
	for _, c := range cases {
		var out bytes.Buffer
		if err := run(context.Background(), append([]string{"simulate"}, c.args...), c.env, &out); err == nil {
			t.Errorf("%s: expected an error", c.name)
		}
	}

	// A cancelled context stops a run early without error; --trackers overrides the event's.
	ctx, cancel := context.WithCancel(context.Background())
	var out bytes.Buffer
	go func() { time.Sleep(200 * time.Millisecond); cancel() }()
	err := run(ctx, []string{"simulate", "--event", "e1", "--server", srv.URL, "--trackers", "Only", "--interval", "50ms", "--speed-kmh", "1"}, withBroker, &out)
	if err != nil || !strings.Contains(out.String(), "Only:") || strings.Contains(out.String(), "Sweep1") {
		t.Fatalf("%v\n%s", err, out.String())
	}
}
