CREATE TABLE global_model_lifecycle (
  profile_id TEXT PRIMARY KEY,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'RETIRING', 'RETIRED')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL
);
