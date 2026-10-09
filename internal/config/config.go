// Package config loads runtime configuration from the environment.
package config

import (
	"fmt"
	"strconv"
	"time"
)

type Config struct {
	Addr         string
	DatabaseURL  string
	TileDir      string
	MQTTBroker   string // empty disables ingestion
	MQTTTopic    string
	MQTTClientID string
	MQTTUser     string
	MQTTPassword string
	TileRPS      int // upstream requests per second when refreshing maps
}

// Load reads configuration; get is usually os.Getenv.
func Load(get func(string) string) (Config, error) {
	str := func(k, def string) string {
		if v := get(k); v != "" {
			return v
		}
		return def
	}
	c := Config{
		Addr:         str("SWEEP_ADDR", ":8080"),
		DatabaseURL:  get("SWEEP_DATABASE_URL"),
		TileDir:      str("SWEEP_TILE_DIR", "./data/tiles"),
		MQTTBroker:   get("SWEEP_MQTT_BROKER"),
		MQTTTopic:    str("SWEEP_MQTT_TOPIC", "meshcore/sweep/#"),
		MQTTClientID: str("SWEEP_MQTT_CLIENT_ID", "sweep-tracker"),
		MQTTUser:     get("SWEEP_MQTT_USER"),
		MQTTPassword: get("SWEEP_MQTT_PASSWORD"),
		TileRPS:      8,
	}
	if v := get("SWEEP_TILE_RPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return c, fmt.Errorf("SWEEP_TILE_RPS must be a positive integer")
		}
		c.TileRPS = n
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("SWEEP_DATABASE_URL is required")
	}
	return c, nil
}

// TileInterval is the spacing between upstream tile requests.
func (c Config) TileInterval() time.Duration { return time.Second / time.Duration(c.TileRPS) }
