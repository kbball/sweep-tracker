-- +goose Up
CREATE TABLE events (
    id         TEXT PRIMARY KEY,
    name       TEXT        NOT NULL,
    date       TIMESTAMPTZ NOT NULL,
    notes      TEXT        NOT NULL DEFAULT '',
    course     JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE trackers (
    name      TEXT PRIMARY KEY,
    last_seen TIMESTAMPTZ NOT NULL
);

CREATE TABLE event_trackers (
    event_id     TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    tracker_name TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    color        TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL,
    PRIMARY KEY (event_id, tracker_name)
);

CREATE TABLE positions (
    id           BIGSERIAL PRIMARY KEY,
    tracker_name TEXT             NOT NULL,
    has_fix      BOOLEAN          NOT NULL,
    lat          DOUBLE PRECISION NOT NULL DEFAULT 0,
    lon          DOUBLE PRECISION NOT NULL DEFAULT 0,
    alt          DOUBLE PRECISION,
    moving       BOOLEAN          NOT NULL DEFAULT FALSE,
    ts           TIMESTAMPTZ      NOT NULL,
    received_at  TIMESTAMPTZ      NOT NULL
);
CREATE INDEX positions_tracker_ts ON positions (tracker_name, ts DESC, id DESC);

-- +goose Down
DROP TABLE positions;
DROP TABLE event_trackers;
DROP TABLE trackers;
DROP TABLE events;
