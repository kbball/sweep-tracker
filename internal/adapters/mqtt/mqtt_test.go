package mqtt

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	mochi "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/hooks/auth"
	"github.com/mochi-mqtt/server/v2/listeners"
)

type recorder struct {
	mu   sync.Mutex
	got  [][]byte
	fail bool
}

func (r *recorder) Ingest(_ context.Context, p []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, p)
	if r.fail {
		return errors.New("rejected")
	}
	return nil
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.got)
}

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

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("condition not met")
}

func TestSubscriberReceivesMessages(t *testing.T) {
	url := startBroker(t)
	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	s := NewSubscriber(Config{BrokerURL: url, Topic: "mesh/sweep/#", ClientID: "sub", Username: "u", Password: "p"}, rec)
	go func() { done <- s.Run(ctx) }()

	pub := paho.NewClient(paho.NewClientOptions().AddBroker(url).SetClientID("pub"))
	if tok := pub.Connect(); tok.Wait() && tok.Error() != nil {
		t.Fatal(tok.Error())
	}
	defer pub.Disconnect(100)
	// Publish repeatedly until the subscriber is up.
	eventually(t, func() bool {
		pub.Publish("mesh/sweep/s1", 1, false, `{"name":"s1"}`).Wait()
		return rec.count() > 0
	})
	rec.mu.Lock()
	rec.fail = true // rejected messages are logged, not fatal
	rec.mu.Unlock()
	n := rec.count()
	pub.Publish("mesh/sweep/s1", 1, false, `{"name":"s1"}`).Wait()
	eventually(t, func() bool { return rec.count() > n })

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not return")
	}
}

func TestRunRequiresConfig(t *testing.T) {
	if err := NewSubscriber(Config{}, &recorder{}).Run(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}

func TestSubscribeFailureAndConnectionLoss(t *testing.T) {
	url := startBroker(t)
	s := NewSubscriber(Config{BrokerURL: url, Topic: "", ClientID: "bad"}, &recorder{})
	o := s.options(context.Background()) // empty topic -> subscribe error path
	c := paho.NewClient(o)
	if tok := c.Connect(); tok.Wait() && tok.Error() != nil {
		t.Fatal(tok.Error())
	}
	time.Sleep(200 * time.Millisecond)
	o.OnConnectionLost(c, errors.New("lost"))
	c.Disconnect(100)
}
