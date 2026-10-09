-- +goose Up
ALTER TABLE positions ADD COLUMN battery_v DOUBLE PRECISION;

-- +goose Down
ALTER TABLE positions DROP COLUMN battery_v;
