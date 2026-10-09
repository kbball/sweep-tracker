# Changelog
Format: Keep a Changelog; versioning: Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-10-09
### Added
- **Setup guide** at the top of Admin: a checklist in the order an event is best set up (details and start time, course, aid stations and cutoffs, sweep teams, offline maps, trackers reporting). Each step is Done, To do, Waiting (on an earlier step) or Optional, says what to do next, and has a Go button to its section. The sections are numbered to match.
- **Aid station table** (Admin → Aid stations): one row each time the course passes a station, with an official mile, cutoff, pacer flag and crew/drop-bag note, plus a name. Fill it by pasting the table from the runner handbook PDF (fields are recognised by shape, so lost blank cells don't matter, and the printed distances are cross-checked) or by typing. Cutoffs are times like "6PM Friday" or hours after the start ("+6h"). Re-uploading a corrected GPX keeps these details.
- **Out-and-back courses:** each aid station has one marker per time the course passes it (detected within 75 m, shown as "(out)" and "(in)"); untick passes that are just the trail running close by. Existing courses get their passes detected when read.
- Event **start time**, used to show cutoffs as clock times (it can be worked out from the first row of a pasted table), and a **starting point for each sweep team** (a stop, such as leaving Dry Creek or Snake Creek after the final cutoff). A team is only placed from its start onwards, which also settles its first report.
- The team card shows the official mile, the next stop with the miles to it and its cutoff; the course strip uses the official miles and the handbook names. Between stops a position is interpolated between the official miles.
- **Export:** the event file (`.sweep.json`: course, aid station table, start time, teams and where each starts) and the aid station table as CSV for crews and volunteers.
- Satellite count (`sats`, also `satellites` in JSON) from tracker messages is stored and shown next to the battery voltage and elevation, each with a Google Material icon (inlined as SVG, so they work offline).
- Light and dark themes (System / Light / Dark toggle, remembered in the browser; map tiles are darkened with a CSS filter in dark mode) and the DM Sans typeface, bundled with the app.
- Admin: explicit View, Edit and Delete buttons for each event, with a confirmation before deleting; sweep teams can be defined by name before the tracker is heard; separate "New event" and "Import an event" cards; "Clear offline maps" (with confirmation, `DELETE /api/maps`); disk space used by each offline map layer.
- `sweeptracker simulate --event <id>`: walks fake sweep teams along an event's course and publishes their positions over MQTT, for demos and QA/UAT. Each team starts at its own start point (override with `--start-mile`). Includes an end-to-end test (simulator → broker → app).
- Local development stack: `docker-compose.dev.yml` (Postgres and an MQTT broker) with `make dev-up`, `dev-down`, `dev-reset` and `dev-env`.
- **CI and releases** (GitHub Actions): gofmt, vet, race tests against Postgres and both coverage gates (80%), then the Docker image is built and smoke-tested against real Postgres and MQTT containers. On `main` it is published to GHCR as `ghcr.io/kbball/sweep-tracker` with the version from `VERSION` (written once, never replaced), `latest` and `sha-<commit>`, for amd64 and arm64. A pull request from the repository publishes a preview (`pr-<number>` and `<version>-pr<number>.<commit>`) instead, never `latest`; previews are deleted when the pull request is merged or closed (and a weekly run tidies up anything missed).
- `sweeptracker healthcheck` and a Docker `HEALTHCHECK` (the image has no shell or curl); `scripts/smoke-image.sh`, `make image` and `make smoke`.

### Changed
- New map-first live view: a full-screen map with a floating team card (state, last report, mile, battery, satellites, elevation; click a team to expand it and pan to it; its report history is a collapsible section), a left rail, restyled controls and a course progress strip with the elevation profile, aid stations and each team's position. The events page and Admin are restyled to match.
- A sweep team's mile marker and place on the strip follow its direction of travel: it is placed at the pass that is the smallest step forward along the course from where it was a moment ago, so on an out-and-back a team heading home is on the return leg. A team resting at an aid station is judged by how it arrived, reports from more than 12 hours before the event date are ignored, and unticked passes are not places a team can be.
- The live map opens centred on the course at the zoom half way between the shallowest and deepest downloaded zoom (the Fit to course button still fits it); the strip's labels alternate between two rows and stay inside it.
- Admin: details, aid stations and sweep teams each save on their own, so saving one no longer discards a start time or team edits typed above it ("Save event" is now "Save details" and "Save teams").
- Offline maps default to zoom 6–15 and a 2.5 km buffer around the course.
- Map tiles and the health check moved under `/api` (`/api/tiles/...`, `/api/healthz`), so production serves everything from one port with the API under `/api`.
- Tracker messages are parsed from the plain-text Meshcore format (JSON still accepted); altitude is kept in feet; battery voltage is stored and shown.
- `docker-compose.yml` example: waits for a healthy database, restarts on failure, uses the published image and has an optional local MQTT broker (`--profile local-broker`).
- `make test` and `make cover` run packages one at a time, so the integration tests don't reset the same database at once.

### Fixed
- Docker image: map downloads failed with "permission denied" because the data volume belonged to root; and under compose the app exited if Postgres wasn't ready yet.
- The map no longer zooms in past the deepest downloaded tile level, where tiles would be blank, and keeps its zoom and pan during live updates instead of re-fitting every few seconds.

### Removed
- Terrain map layer (Topo is the only layer). Tiles already downloaded under `terrain/` in the tile directory are no longer used and can be deleted.
- Admin token protection.

## [0.1.0] - 2026-10-08
### Added
- Hexagonal Go backend: domain, application services, Postgres (Goose migrations), MQTT subscriber, GPX parser, offline tile store/downloader, HTTP API with live SSE stream.
- `sweeptracker serve` and `sweeptracker maps download` commands.
- React + TypeScript frontend: live map (topo/terrain, course, aid stations, fading position history), sweep status panel, admin page (events, GPX upload, trackers, export/import, map refresh).
- Multiple concurrent sweep teams per event; positions with no GPS fix are recorded and shown.
- Single-container Dockerfile, docker-compose example, Makefile with 80% coverage gate.
