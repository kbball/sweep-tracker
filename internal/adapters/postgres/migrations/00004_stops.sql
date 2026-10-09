-- +goose Up
ALTER TABLE events ADD COLUMN start_time TEXT NOT NULL DEFAULT '';
ALTER TABLE event_trackers ADD COLUMN start_m DOUBLE PRECISION;

-- +goose Down
ALTER TABLE event_trackers DROP COLUMN start_m;
ALTER TABLE events DROP COLUMN start_time;
