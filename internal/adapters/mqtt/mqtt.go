// Package mqtt subscribes to the Meshcore→MQTT bridge topic and feeds
// payloads to the application.
package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

// Ingester consumes one raw payload.
type Ingester interface {
	Ingest(ctx context.Context, payload []byte) error
}

type Config struct {
	BrokerURL string
	Topic     string
	ClientID  string
	Username  string
	Password  string
}

type Subscriber struct {
	cfg Config
	in  Ingester
}

func NewSubscriber(cfg Config, in Ingester) *Subscriber { return &Subscriber{cfg: cfg, in: in} }

func (s *Subscriber) options(ctx context.Context) *paho.ClientOptions {
	o := paho.NewClientOptions().
		AddBroker(s.cfg.BrokerURL).
		SetClientID(s.cfg.ClientID).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetOrderMatters(false)
	if s.cfg.Username != "" {
		o.SetUsername(s.cfg.Username).SetPassword(s.cfg.Password)
	}
	// Subscribing in OnConnect re-subscribes after every reconnect.
	o.SetOnConnectHandler(func(c paho.Client) {
		tok := c.Subscribe(s.cfg.Topic, 1, func(_ paho.Client, m paho.Message) { s.handle(ctx, m) })
		if tok.Wait() && tok.Error() != nil {
			slog.Error("mqtt subscribe", "topic", s.cfg.Topic, "err", tok.Error())
			return
		}
		slog.Info("mqtt subscribed", "topic", s.cfg.Topic)
	})
	o.SetConnectionLostHandler(func(_ paho.Client, err error) { slog.Warn("mqtt connection lost", "err", err) })
	return o
}

func (s *Subscriber) handle(ctx context.Context, m paho.Message) {
	if err := s.in.Ingest(ctx, m.Payload()); err != nil {
		slog.Warn("mqtt message rejected", "topic", m.Topic(), "err", err)
	}
}

// Run connects (retrying in the background) and blocks until ctx is done.
func (s *Subscriber) Run(ctx context.Context) error {
	if s.cfg.BrokerURL == "" || s.cfg.Topic == "" {
		return fmt.Errorf("mqtt broker URL and topic are required")
	}
	c := paho.NewClient(s.options(ctx))
	c.Connect() // with ConnectRetry the token completes only on success; don't block on it
	<-ctx.Done()
	c.Disconnect(250)
	return nil
}
