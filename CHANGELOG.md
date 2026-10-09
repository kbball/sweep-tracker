# Changelog
Format: Keep a Changelog; versioning: Semantic Versioning.

## [Unreleased]
### Changed
- Tracker messages are parsed from the plain-text Meshcore format (JSON still accepted). Altitude is kept in feet.
- Offline maps default to zoom levels 6–12. Battery voltage (`bat=`) is stored and shown for each report.
### Removed
- Admin token protection.

## [0.1.0] - 2026-10-08
### Added
- Hexagonal Go backend: domain, application services, Postgres (Goose migrations), MQTT subscriber, GPX parser, offline tile store/downloader, HTTP API with live SSE stream.
- `sweeptracker serve` and `sweeptracker maps download` commands.
- React + TypeScript frontend: live map (topo/terrain, course, aid stations, fading position history), sweep status panel, admin page (events, GPX upload, trackers, export/import, map refresh).
- Multiple concurrent sweep teams per event; positions with no GPS fix are recorded and shown.
- Single-container Dockerfile, docker-compose example, Makefile with 80% coverage gate.
