# Plan

Completed work is in CHANGELOG.md; this file holds only what remains.

## Open assumptions – need confirmation
1. Sharing = export/import `.sweep.json` bundle (no live sync).
2. Each aid station runs its own copy of this app with its own gateway; nothing is collected centrally. Winlink and voice over the team's ham repeaters stay the reliable path; MeshCore is supplemental (decided 2026-10-10).

## Next
- [ ] **Hardware verification with a real tracker and the real bridge.** `SWEEP_MESHCORE_CHANNEL` picks the bridge channel and the bridge's message envelope is unwrapped (tested with simulated messages only). Confirm: the tracker's name arrives as the sender prefix on the text (`Sweep1: lat,lon …`), a position reaches the map, "no fix" and moving/idle are shown correctly, and how far a station's gateway hears a tracker.
- [ ] **Cut the next release** (0.3.0) once the check above passes: bump `VERSION`, move `Unreleased` in CHANGELOG.md under the new version. Not done yet so a version is not published before the real-tracker test.
- [ ] **Decide the default channel.** With `SWEEP_MESHCORE_CHANNEL` unset the app still subscribes to `meshcore/sweep/#` (the original topic). The event convention is channel 0 (sweeps), set by the go-box; consider making that the default.

## Notes
- The tracker report format (`Name: lat,lon alt=…ft sats=… bat=…V mv|idle`) is a contract with the firmware releases of the fork `kbball/MeshCore-tracker`. If the firmware changes the format, change `internal/app/message.go` and say so in the firmware release notes.
- Channel convention across the event (same on every station radio and gateway): 0 sweeps, 1 aid station logging, 2 station chat, 3 all-race chat. This app listens to the sweeps channel only.
- Behind the go-box this app is served at `/sweep/` (`SWEEP_BASE_PATH=/sweep`).
