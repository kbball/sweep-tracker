# Sweep Tracker

Shows where the sweep teams (the last runners on course, removing flagging) are, on an offline topo/terrain map. Trackers report over Meshcore; a Meshcore→MQTT bridge publishes to a topic this app subscribes to.

## Run
`docker compose up --build`, then open http://localhost:8080 and go to **Admin**.
Config (env): `SWEEP_DATABASE_URL` (required), `SWEEP_ADDR`, `SWEEP_TILE_DIR`, `SWEEP_MQTT_BROKER`, `SWEEP_MQTT_TOPIC`, `SWEEP_MQTT_USER/PASSWORD`, `SWEEP_TILE_RPS`.

## Workflow
1. Admin → create an event, upload the course GPX (track + waypoints/aid stations), assign trackers (any tracker heard on MQTT appears in the picker), pick labels/colours.
2. **While online**: Admin → *Download / refresh maps* (or `sweeptracker maps download --event <id>`). USGS Topo and Shaded Relief tiles around the course are stored in `SWEEP_TILE_DIR`. Re-run to refresh; existing tiles are skipped.
3. In the field everything runs offline. Share an event with other aid stations via *Export*, then *Import* on their instance (they download their own maps).

Map data: USGS The National Map (US coverage only).

## Develop
`make db` (throwaway Postgres on :55432) then
`TEST_DATABASE_URL='postgres://postgres:pw@localhost:55432/postgres?sslmode=disable' make cover`; frontend: `cd web && npm run cover`. See CLAUDE.md for architecture rules.
