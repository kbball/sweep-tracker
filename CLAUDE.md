# Sweep Tracker – project rules

Shows the location of race "sweep" teams (last runners on course, removing flagging) on an offline topo map, fed by Meshcore trackers via MQTT.

## Architecture (hexagonal)
- `internal/domain` – entities and pure logic. No imports from other internal packages.
- `internal/app` – use cases and **port interfaces** (`ports.go`). Depends only on domain.
- `internal/adapters/*` – implementations of ports (postgres, mqtt, httpapi, gpx, tiles, memory). Adapters may depend on app/domain, never on each other (except `cmd` wiring).
- `cmd/sweeptracker` – composition root only: config, wiring, subcommands.
- `web/` – React + TypeScript (Vite). Built output is embedded (`web/embed.go`) and served by the Go backend. Single container in production.

## Rules
- Backend Go, frontend React+TS, DB Postgres, migrations with Goose (embedded, run at startup). New schema changes = new numbered migration; never edit an applied one.
- Test coverage must stay **> 80%** for Go (`make cover`) and for the frontend (vitest threshold). Business logic is tested against `adapters/memory`; postgres tests need `TEST_DATABASE_URL`.
- The app must run fully offline: no runtime calls to external services except the explicit, user-triggered map refresh.
- Semantic versioning; version lives in `VERSION`. Every user-visible change gets a `CHANGELOG.md` entry (Keep a Changelog format) under `Unreleased`.
- `plan.md` lists only **remaining** work; delete items when done.
- Run `gofmt`, `go vet`, tests before committing. Commit only when asked.

## Tracker message format
Plain text on the MQTT topic (no timestamp – receive time is used; altitude is feet and stays in feet end to end):
- Fix: `Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv` (last token `mv` = moving, `idle` = stopped)
- No fix: `Sweep1: no fix (no position yet) idle`
A JSON object (name/lat/lon/ts/alt/moving/fix) is also accepted. `sats` and `bat` are parsed past but not stored yet.
