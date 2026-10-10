package config

import (
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env(map[string]string{"SWEEP_DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" || c.TileRPS != 8 || c.MQTTTopic == "" || c.MQTTBroker != "" {
		t.Fatalf("%+v", c)
	}
	if c.TileInterval() != time.Second/8 {
		t.Fatal(c.TileInterval())
	}
}

func TestLoadOverrides(t *testing.T) {
	c, err := Load(env(map[string]string{"SWEEP_DATABASE_URL": "x", "SWEEP_ADDR": ":9", "SWEEP_BASE_PATH": "/sweep", "SWEEP_TILE_RPS": "2"}))
	if err != nil || c.Addr != ":9" || c.BasePath != "/sweep" || c.TileRPS != 2 {
		t.Fatalf("%v %+v", err, c)
	}
}

func TestLoadMeshcoreChannel(t *testing.T) {
	base := map[string]string{"SWEEP_DATABASE_URL": "x", "SWEEP_MESHCORE_CHANNEL": "2"}
	c, err := Load(env(base))
	if err != nil || c.MQTTTopic != "meshcore/message/channel/2" {
		t.Fatalf("%v %+v", err, c)
	}
	// An explicit topic wins over the channel shortcut.
	base["SWEEP_MQTT_TOPIC"] = "custom/#"
	if c, err = Load(env(base)); err != nil || c.MQTTTopic != "custom/#" {
		t.Fatalf("%v %+v", err, c)
	}
	for _, bad := range []string{"x", "-1"} {
		if _, err := Load(env(map[string]string{"SWEEP_DATABASE_URL": "x", "SWEEP_MESHCORE_CHANNEL": bad})); err == nil {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}

func TestLoadErrors(t *testing.T) {
	if _, err := Load(env(nil)); err == nil {
		t.Fatal("db url required")
	}
	for _, v := range []string{"abc", "0", "-1"} {
		if _, err := Load(env(map[string]string{"SWEEP_DATABASE_URL": "x", "SWEEP_TILE_RPS": v})); err == nil {
			t.Fatalf("rps %q", v)
		}
	}
}
