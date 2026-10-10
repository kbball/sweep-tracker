package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kbball/sweep-tracker/internal/domain"
)

// ParseMessage decodes a tracker payload from the Meshcore→MQTT bridge.
//
// Text format (what the trackers send):
//
//	Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv
//	Sweep1: no fix (no position yet) idle
//
// The bridge's channel message envelope (text inside payload.text) is unwrapped
// first. A JSON object with common key spellings is also accepted. Messages carry no
// timestamp, so the receive time is used. A message without usable
// coordinates is recorded as "no fix".
func ParseMessage(payload []byte, now time.Time) (*domain.Position, error) {
	t := strings.TrimSpace(string(payload))
	if !strings.HasPrefix(t, "{") {
		return parseText(t, now)
	}
	if text, ok := bridgeText(payload); ok {
		return parseText(strings.TrimSpace(text), now)
	}
	return parseJSON(payload, now)
}

// bridgeText extracts the message text from the meshcore-mqtt bridge's channel
// message envelope, {"type":...,"payload":{"channel_idx":1,"text":"Sweep1: ..."}}.
// MeshCore puts the sender's name in front of the text, which is the tracker name.
func bridgeText(payload []byte) (string, bool) {
	var env struct {
		Payload *struct {
			Text *string `json:"text"`
		} `json:"payload"`
	}
	if json.Unmarshal(payload, &env) != nil || env.Payload == nil || env.Payload.Text == nil {
		return "", false
	}
	return *env.Payload.Text, true
}

const metersToFeet = 3.28084

var (
	coordsRe = regexp.MustCompile(`(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)`)
	altRe    = regexp.MustCompile(`\balt=(-?\d+(?:\.\d+)?)\s*(ft|m)?`)
	batRe    = regexp.MustCompile(`\bbat=(\d+(?:\.\d+)?)\s*V?`)
	satsRe   = regexp.MustCompile(`\bsats=(\d+)`)
)

func parseText(s string, now time.Time) (*domain.Position, error) {
	name, rest, ok := strings.Cut(s, ":")
	if !ok {
		return nil, errors.Join(domain.ErrInvalid, errors.New("expected \"<name>: <report>\""))
	}
	p := &domain.Position{TrackerName: name, Time: now, ReceivedAt: now}
	rest = strings.TrimSpace(rest)
	if f := strings.Fields(rest); len(f) > 0 {
		p.Moving = f[len(f)-1] == "mv" // last token is "mv" or "idle"
	}
	// Battery is reported with or without a fix.
	if b := batRe.FindStringSubmatch(rest); b != nil {
		v, _ := strconv.ParseFloat(b[1], 64)
		p.BatteryV = &v
	}
	if m := satsRe.FindStringSubmatch(rest); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			p.Sats = &n
		}
	}
	if !strings.HasPrefix(strings.ToLower(rest), "no fix") {
		if m := coordsRe.FindStringSubmatch(rest); m != nil {
			p.Lat, _ = strconv.ParseFloat(m[1], 64)
			p.Lon, _ = strconv.ParseFloat(m[2], 64)
			p.HasFix = true
			if a := altRe.FindStringSubmatch(rest); a != nil {
				v, _ := strconv.ParseFloat(a[1], 64)
				if a[2] == "m" { // altitude is kept in feet
					v *= metersToFeet
				}
				p.Alt = &v
			}
		}
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return p, nil
}

func parseJSON(payload []byte, now time.Time) (*domain.Position, error) {
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, errors.Join(domain.ErrInvalid, fmt.Errorf("payload is not JSON: %w", err))
	}
	pick := func(keys ...string) (any, bool) {
		for _, k := range keys {
			if v, ok := raw[k]; ok && v != nil {
				return v, true
			}
		}
		return nil, false
	}
	p := &domain.Position{ReceivedAt: now}
	if v, ok := pick("name", "tracker", "tracker_name", "n"); ok {
		p.TrackerName, _ = v.(string)
	}
	lat, latOK := num(pick("lat", "latitude"))
	lon, lonOK := num(pick("lon", "lng", "long", "longitude"))
	p.HasFix = latOK && lonOK && !(lat == 0 && lon == 0)
	if v, ok := pick("fix", "has_fix", "gps_fix"); ok {
		if b, isBool := toBool(v); isBool && !b {
			p.HasFix = false
		}
	}
	if p.HasFix {
		p.Lat, p.Lon = lat, lon
	}
	if a, ok := num(pick("alt", "altitude", "ele")); ok && p.HasFix {
		p.Alt = &a
	}
	if b, ok := num(pick("bat", "battery", "battery_v")); ok {
		p.BatteryV = &b
	}
	if n, ok := num(pick("sats", "satellites")); ok && n >= 0 && n <= 255 {
		s := int(n)
		p.Sats = &s
	}
	if v, ok := pick("moving", "is_moving", "mv"); ok {
		p.Moving, _ = toBool(v)
	}
	p.Time = now
	if v, ok := pick("ts", "timestamp", "time"); ok {
		if t, ok := toTime(v); ok {
			p.Time = t
		}
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return p, nil
}

func num(v any, ok bool) (float64, bool) {
	if !ok {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	}
	return 0, false
}

func toBool(v any) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case float64:
		return x != 0, true
	case string:
		b, err := strconv.ParseBool(strings.TrimSpace(x))
		return b, err == nil
	}
	return false, false
}

func toTime(v any) (time.Time, bool) {
	switch x := v.(type) {
	case float64:
		if x > 1e12 { // milliseconds
			return time.UnixMilli(int64(x)).UTC(), true
		}
		return time.Unix(int64(x), 0).UTC(), true
	case string:
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t.UTC(), true
		}
		if f, err := strconv.ParseFloat(x, 64); err == nil {
			return toTime(f)
		}
	}
	return time.Time{}, false
}
