# Changelog
Format: Keep a Changelog; versioning: Semantic Versioning.

## [Unreleased]
### Changed
- Offline maps now show how much disk space each layer uses (Admin → Offline maps).
- Offline map downloads cover 2.5 km around the course by default (was 2 km).
- The live map opens centred on the course, at the zoom half way between the shallowest and deepest downloaded zoom (zoom 10 when nothing is known), instead of fitting the whole course. The Fit to course button still fits it.
- Course progress strip labels alternate between two rows and stay inside the strip; the initial fit leaves room for the strip.
- New map-first live view: full-screen map with a floating team card (state, last report, mile marker, battery, altitude; click a team to expand its history and pan to it), a left rail, restyled map controls, and a course progress strip showing the elevation profile, aid stations and each team's position.
### Added
- Admin: each event has explicit View, Edit and Delete buttons (the one being edited is marked "Editing") instead of clicking its name. Deleting an event asks for confirmation first.
- Admin restyled to match: panel cards, selectable event list, themed inputs, primary/ghost/danger buttons, file pickers, separate "New event" and "Import an event" cards, team rows, map download chips and progress.
- Events page and Admin share a themed header; events show as cards (date, Today/Upcoming/Past, course length, waypoints, teams).
- Light and dark themes (System / Light / Dark toggle, remembered in the browser). In dark mode the map tiles are darkened with a CSS filter, so no extra tiles are needed.
- DM Sans typeface, bundled with the app (no runtime request to Google).
- Admin: sweep teams can be defined by name up front, before the tracker has ever been heard on the mesh.
- `sweeptracker simulate --event <id>`: walks fake sweep teams along an event's course and publishes their positions over MQTT in the tracker message format, for demos and QA/UAT. Includes an automated end-to-end test (simulator → broker → app).
### Fixed
- The map no longer zooms in past the deepest downloaded tile level, where tiles would be blank.
- The map keeps its zoom and pan during live updates instead of re-fitting to the course every few seconds.
### Added
- Admin: "Clear offline maps" button (with confirmation dialog) and `DELETE /api/maps` to delete all downloaded tiles.
### Changed
- Map tiles and the health check moved under `/api` (`/api/tiles/...`, `/api/healthz`), so production serves everything from one port with the API under `/api`.
- Tracker messages are parsed from the plain-text Meshcore format (JSON still accepted). Altitude is kept in feet.
- Offline maps default to zoom levels 6–15. Battery voltage (`bat=`) is stored and shown for each report.
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
