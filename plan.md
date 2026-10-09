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

## Future
- Configurable tile sources (non-US coverage), MBTiles/PMTiles
- Off-course detection / distance to finish / ETA for sweep teams
- Instance-to-instance sync
- Per-user auth
- Retention/pruning of old position rows
