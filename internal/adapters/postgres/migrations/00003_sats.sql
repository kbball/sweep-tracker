-- +goose Up
ALTER TABLE positions ADD COLUMN sats INTEGER;

-- +goose Down
ALTER TABLE positions DROP COLUMN sats;
