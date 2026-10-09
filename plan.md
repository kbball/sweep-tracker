# Plan

Completed work is in CHANGELOG.md; this file holds only what remains.

## Open assumptions – need confirmation
1. Sharing = export/import `.sweep.json` bundle (no live sync).

## Next
- [ ] Verify the UI in a real browser (Leaflet rendering, marker fading, layer switch) – only tested with mocks so far
- [ ] Verify against the real Meshcore→MQTT bridge (text format implemented from your examples)
- [ ] Store/show `sats` and `bat` (battery) from tracker messages
- [ ] Run the built Docker image end to end (image builds; not yet run against compose)
- [ ] CI workflow running both coverage gates

## Backlog
- [ ] Aid station (AS) info upload (e.g. CSV) matched to the AS waypoints in the GPX: cutoff times, distance to next aid station
- [ ] UI/UX overhaul – needs a design to base it on (user to supply; Claude implements from it)
- [ ] Admin: setup guide walking through the order of operations
- [ ] New-user walkthrough

## Future
- Configurable tile sources (non-US coverage), MBTiles/PMTiles
- Off-course detection / distance to finish / ETA for sweep teams
- Instance-to-instance sync
- Per-user auth
- Retention/pruning of old position rows
