# Sweep Tracker

Shows where the sweep teams (the last runners on course, who make sure everyone is off the course and remove flagging) are, on an offline topo/terrain map. Trackers report over [Meshcore](https://meshcore.co.uk); a Meshcore→MQTT bridge publishes their messages to a topic this app subscribes to.

- Runs fully offline once maps are downloaded (USGS Topo and Terrain tiles, US coverage only)
- Multiple sweep teams at once, each with its own label and colour
- Course from a GPX file: track line plus waypoints/aid stations
- Latest position at full strength; earlier reports fade out down the list and on the map
- Per report: moving/stopped, altitude (ft), battery voltage, or "no fix"
- Live updates (no refresh needed)
- Events can be exported and imported to share with other aid stations
- Single container: Go backend serving the React frontend; Postgres for storage

## Quick start

```sh
docker compose up --build
```

Open http://localhost:8080 and go to **Admin**. The compose file is an example: point `SWEEP_MQTT_BROKER` at the broker your Meshcore bridge publishes to.

### Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `SWEEP_DATABASE_URL` | required | Postgres connection string |
| `SWEEP_ADDR` | `:8080` | Listen address |
| `SWEEP_TILE_DIR` | `./data/tiles` | Where offline map tiles are stored (mount a volume) |
| `SWEEP_MQTT_BROKER` | unset | e.g. `tcp://mqtt:1883`; ingestion is disabled when unset |
| `SWEEP_MQTT_TOPIC` | `meshcore/sweep/#` | Topic to subscribe to |
| `SWEEP_MQTT_CLIENT_ID` / `_USER` / `_PASSWORD` | `sweep-tracker` / unset / unset | Broker client settings |
| `SWEEP_TILE_RPS` | `8` | Max upstream requests per second when downloading maps |

There is no login: anyone who can reach the server can use the admin page, so keep it on a trusted network.

## Using it

1. **Admin → create an event.** Upload the course GPX, then add the trackers. Any tracker heard on MQTT shows up in the picker; set a label and colour for each sweep team.
2. **While online, download maps** (Admin → *Download / refresh maps*, or `sweeptracker maps download --event <id>`). Tiles for the course area are stored in `SWEEP_TILE_DIR` at zoom 6–12 by default (adjustable); re-run any time to refresh. Existing tiles are skipped.
3. **In the field everything runs offline.** Open the event page for the live map.
4. **Share with another aid station:** *Export event to share* downloads a `.sweep.json` (event, course, tracker assignments). Import it on their instance, where they download their own maps.

### Tracker messages

Plain text on the MQTT topic:

```
Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv     (fix, moving)
Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V idle   (fix, stopped)
Sweep1: no fix (no position yet) mv                            (no fix)
```

Messages carry no timestamp, so the time received is used. Altitude is kept in feet. Reports without a fix are recorded and listed but can't be placed on the map; the map shows the last known fix. Satellite count is not stored. A JSON object (`name`, `lat`, `lon`, `ts`, `alt`, `bat`, `moving`, `fix`) is also accepted.

Map data: USGS The National Map (public domain).

## Develop

Requirements: Go 1.27+, Node 24+, Docker (for Postgres in tests).

```sh
make db                                  # throwaway Postgres on :55432
export TEST_DATABASE_URL='postgres://postgres:pw@localhost:55432/postgres?sslmode=disable'
make cover                               # Go tests, fails below 80% coverage
cd web && npm ci && npm run cover        # frontend tests, 80% thresholds
make build                               # frontend + single binary in bin/
```

Run locally: set `SWEEP_DATABASE_URL`, `./bin/sweeptracker serve`. For frontend development run `npm run dev` in `web/` (proxies `/api` and `/tiles` to :8080). Database migrations (Goose) are embedded and applied at startup.

Layout (hexagonal): `internal/domain` → `internal/app` (use cases + ports) → `internal/adapters/*` (postgres, mqtt, httpapi, gpx, tiles, memory); `cmd/sweeptracker` wires it together. See `CLAUDE.md` for the project rules, `plan.md` for remaining work and `CHANGELOG.md` for changes. Versioning is semantic; the version lives in `VERSION`.
