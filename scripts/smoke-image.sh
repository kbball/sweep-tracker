#!/usr/bin/env bash
# Runs a built image against real Postgres and MQTT containers and checks it works end to end:
# it starts and reports itself healthy, reports the expected version, can write to its data
# volume (as its non-root user), and a position published on MQTT comes out of the API.
#
#   scripts/smoke-image.sh <image> [expected-version]
#
# Needs Docker. SMOKE_PORT (default 18080) is the host port used for the app.
set -euo pipefail

image=${1:?usage: smoke-image.sh <image> [expected-version]}
want=${2:-}
port=${SMOKE_PORT:-18080}
p=smoke-$$
root=$(cd "$(dirname "$0")/.." && pwd)

cleanup() {
  docker rm -f "$p-app" "$p-db" "$p-mqtt" >/dev/null 2>&1 || true
  docker volume rm "$p-data" >/dev/null 2>&1 || true
  docker network rm "$p" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; docker logs "$p-app" 2>&1 | tail -20 >&2 || true; exit 1; }
ok() { echo "ok: $*"; }

retry() { # retry <seconds> <command...>: run the command until it succeeds or the time is up
  local limit=$1; shift
  for _ in $(seq 1 "$limit"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

docker network create "$p" >/dev/null
docker run -d --name "$p-db" --network "$p" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sweep \
  --health-cmd "pg_isready -h 127.0.0.1 -U postgres -d sweep" --health-interval 2s --health-retries 30 postgres:17-alpine >/dev/null
docker run -d --name "$p-mqtt" --network "$p" \
  -v "$root/dev/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" eclipse-mosquitto:2 >/dev/null
# pg_isready -h 127.0.0.1 checks over TCP: the image's first-start server listens on its socket only, so a socket check can pass while the app still gets "connection refused".
db_ready() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$p-db")" = healthy ]; }
retry 60 db_ready || fail "Postgres did not become ready"

docker run -d --name "$p-app" --network "$p" -p "$port:8080" -v "$p-data:/data" \
  -e SWEEP_DATABASE_URL="postgres://postgres:pw@$p-db:5432/sweep?sslmode=disable" \
  -e SWEEP_MQTT_BROKER="tcp://$p-mqtt:1883" "$image" >/dev/null
url=http://127.0.0.1:$port
retry 30 curl -fsS "$url/api/healthz" || fail "the app did not answer /api/healthz"
ok "the app is up"

# The image has no shell or curl: its own healthcheck command is what Docker runs.
docker exec "$p-app" /sweeptracker healthcheck || fail "the healthcheck command failed inside the container"
ok "the healthcheck command works"

if [ -n "$want" ]; then
  got=$(curl -fsS "$url/api/config")
  case "$got" in *"\"version\":\"$want\""*) ok "version $want" ;; *) fail "expected version $want, got $got" ;; esac
fi

owner=$(docker run --rm -v "$p-data:/data" alpine stat -c %u /data/tiles 2>/dev/null || echo missing)
[ "$owner" = 65532 ] || fail "/data/tiles is $owner, not owned by the app's user (65532): map downloads would fail"
ok "the data volume is writable by the app's user"

# Live path: an event with a team, a message on MQTT, and the position out of the API.
event=$(curl -fsS -X POST "$url/api/events" -d '{"name":"Smoke","date":"2026-10-10T00:00:00Z","trackers":[{"trackerName":"Sweep1","label":"Sweep 1"}]}')
id=$(printf '%s' "$event" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$id" ] || fail "could not create an event: $event"
published() {
  docker exec "$p-mqtt" mosquitto_pub -t meshcore/sweep/Sweep1 -m 'Sweep1: 33.89057,-84.16948 alt=955ft sats=10 bat=3.77V mv'
  curl -fsS "$url/api/events/$id/positions?history=1" | grep -q '"lat":33.89057'
}
retry 20 published || fail "a position published on MQTT never came out of the API"
ok "a position published on MQTT reaches the API"

echo "image $image passed"
