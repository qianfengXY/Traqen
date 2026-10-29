-- A bounded execution projection, separate from immutable facts and profiles.
ALTER TABLE f002_scope ADD COLUMN progress jsonb;
