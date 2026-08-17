CREATE TABLE global_model_profile_revision_head (
  profile_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  current_revision_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
