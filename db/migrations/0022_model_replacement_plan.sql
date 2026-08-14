CREATE TABLE model_replacement_plan (
  plan_id TEXT PRIMARY KEY,
  source_profile_id TEXT NOT NULL,
  replacement_profile_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('READY', 'APPLYING', 'APPLIED')),
  plan_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX model_replacement_plan_source_status_idx
  ON model_replacement_plan (source_profile_id, status);
