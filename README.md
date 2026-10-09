# Sweep Tracker

Shows where the sweep teams (the last runners on course, who make sure everyone is off the course and remove flagging) are, on an offline topo map. Trackers report over [Meshcore](https://meshcore.co.uk); a Meshcore→MQTT bridge publishes their messages to a topic this app subscribes to.

- Runs fully offline once maps are downloaded (USGS Topo tiles, US coverage only)
- Multiple sweep teams at once, each with its own label and colour
- Course from a GPX file: track line plus waypoints/aid stations
- Latest position at full strength; earlier reports fade out down the list and on the map
- Per report: moving/stopped, altitude (ft), battery voltage, or "no fix"
- Live updates (no refresh needed)
- Events can be exported and imported to share with other aid stations
- Single container: Go backend serving the React frontend; Postgres for storage

## Quick start

```sh
docker compose up -d                          # Postgres + the published image; set SWEEP_MQTT_BROKER to your broker
docker compose --profile local-broker up -d   # ...or with a throwaway local MQTT broker, to try it out
```

Open http://localhost:8080 and go to **Admin**. The compose file is an example: point `SWEEP_MQTT_BROKER` at the broker your Meshcore bridge publishes to. `docker compose up -d --build` builds from a checkout instead of pulling the image.

### The image

Images are published to GitHub Container Registry as `ghcr.io/kbball/sweep-tracker`, for amd64 and arm64:

| Tag | Meaning |
|---|---|
| `0.2.0` | That release: the version in the `VERSION` file. Written once and never replaced. |
| `latest` | The newest build of `main`. |
| `sha-abc1234` | A specific commit on `main`. |

Pin a release with `SWEEP_VERSION=0.2.0 docker compose up -d`. The image runs as a non-root user, keeps map tiles in the `/data` volume, and has a built-in health check (`sweeptracker healthcheck`), so `docker ps` and compose show whether it is up.

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

The **Setup guide** at the top of Admin lists these steps in order, shows which are done, and jumps to each section. Each step needs the ones before it.

1. **Event details.** Admin → create an event, then set its date (the first day of the race) and start time. Cutoffs show as clock times from these.
2. **Course.** Upload the course GPX. Aid stations, team starts and maps all depend on it.
3. **Aid stations and cutoffs.** One row each time the course goes by an aid station (an out-and-back passes each twice). Paste the table from the runner handbook PDF under *Fill from the runner handbook*, or type it: official mile, cutoff (like `6PM Friday`, or `+6h` for hours after the start), pacer and crew/drop-bag. Untick a row that is just the trail running close by.
4. **Sweep teams.** Add each team's tracker name (it can be typed before the tracker has been heard; any tracker heard on MQTT also shows up in the picker), a label and a colour. On an out-and-back course, say where each team starts (for example leaving Dry Creek) so it is placed on the right leg.
5. **Offline maps, while online** (Admin → *Download / refresh maps*, or `sweeptracker maps download --event <id>`). Tiles for the course area are stored in `SWEEP_TILE_DIR` at zoom 6–15 by default (adjustable); re-run any time to refresh. Existing tiles are skipped.
6. **Check the trackers.** Each team should be heard on the mesh before race day (or try the simulator below).
7. **In the field everything runs offline.** Open the event page for the live map.
8. **Share with another aid station:** Admin → *Share* downloads the event file (`.sweep.json`: event, start time, course, aid station table, teams and where each starts) to import on their instance, where they download their own maps. The aid station table is also available as a CSV for crews and volunteers.

### Tracker messages

Plain text on the MQTT topic:

```
Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv     (fix, moving)
Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V idle   (fix, stopped)
Sweep1: no fix (no position yet) mv                            (no fix)
```

Messages carry no timestamp, so the time received is used. Altitude is kept in feet. Reports without a fix are recorded and listed but can't be placed on the map; the map shows the last known fix. Battery voltage (`bat`) and satellite count (`sats`) are stored and shown. A JSON object (`name`, `lat`, `lon`, `ts`, `alt`, `bat`, `sats`, `moving`, `fix`) is also accepted.

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

Run locally: `make dev-up` starts Postgres and a Mosquitto MQTT broker from `docker-compose.dev.yml` (in production both already exist) and prints the `SWEEP_DATABASE_URL` / `SWEEP_MQTT_BROKER` exports to use; then `./bin/sweeptracker serve`. `make dev-down` stops them, `make dev-reset` also deletes their data. Host ports default to 5433 (Postgres) and 1884 (MQTT) so they don't clash with other local stacks; override with `SWEEP_DEV_DB_PORT` / `SWEEP_DEV_MQTT_PORT`. For frontend development run `npm run dev` in `web/` (serves the UI on :5173 and proxies `/api` to :8080). Database migrations (Goose) are embedded and applied at startup.

### Demo / QA simulator

`sweeptracker simulate` walks fake sweep teams along an event's course and publishes their positions to the MQTT broker, so the whole pipeline (broker → server → live map) is exercised without hardware. The server must be subscribed to the same broker (`SWEEP_MQTT_BROKER`).

```sh
make dev-up                                                          # Postgres + MQTT; prints the exports below
eval "$(make -s dev-env)"                                            # SWEEP_DATABASE_URL and SWEEP_MQTT_BROKER
./bin/sweeptracker serve                                             # in one terminal
./bin/sweeptracker simulate --event <id> --speedup 60 --interval 2s  # in another
```

It uses the trackers assigned to the event (or `--trackers A,B`), `--speed-kmh` (default 5), `--stagger-m` to start extra teams further along, `--start-mile` to start the first team part-way along the course (by default each team starts at the start point set for it in Admin, such as leaving Dry Creek), and `--server` (default `http://localhost:8080`) to read the event.

The UI font (DM Sans, SIL OFL 1.1) is bundled via `@fontsource-variable/dm-sans`, so nothing is fetched from the internet at runtime.

Layout (hexagonal): `internal/domain` → `internal/app` (use cases + ports) → `internal/adapters/*` (postgres, mqtt, httpapi, gpx, tiles, memory); `cmd/sweeptracker` wires it together. See `CLAUDE.md` for the project rules, `plan.md` for remaining work and `CHANGELOG.md` for changes. Versioning is semantic; the version lives in `VERSION`.

## CI and releases

Every pull request and every push to `main` runs the GitHub Actions workflow in `.github/workflows/ci.yml`: `gofmt`, `go vet`, the Go tests (with the race detector, against a Postgres service) and the Go coverage gate; the frontend type check, tests, coverage gate and build; then the Docker image is built and smoke-tested (`scripts/smoke-image.sh`: real Postgres and MQTT containers, a position sent over MQTT and read back from the API). `make image` and `make smoke` do the same locally.

`main` is protected: changes go in through a pull request whose checks (`Go`, `Frontend`, `Image`) pass. When a change reaches `main` the image is pushed to GHCR.

**To release a new version:** bump `VERSION`, move the `Unreleased` entries in `CHANGELOG.md` under the new version, and merge. If `VERSION` is unchanged the build still updates `latest` and `sha-…`, but leaves the existing version tag alone and says so in the run's warnings.

