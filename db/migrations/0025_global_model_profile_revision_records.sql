CREATE TABLE global_model_profile_revision (
  revision_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  profile_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (profile_id, revision)
);

CREATE INDEX global_model_profile_revision_profile_idx
  ON global_model_profile_revision (profile_id, revision DESC);

CREATE TABLE model_replacement_failure_diagnostic (
  diagnostic_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  diagnostic_payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX model_replacement_failure_diagnostic_plan_idx
  ON model_replacement_failure_diagnostic (plan_id, occurred_at);

UPDATE model_replacement_plan
SET version = version - 1,
    status = 'READY',
    plan_payload = (plan_payload - 'applyingAt') || jsonb_build_object('status', 'READY', 'version', version - 1)
WHERE status = 'APPLYING';

ALTER TABLE model_replacement_plan
  DROP CONSTRAINT model_replacement_plan_status_check;

ALTER TABLE model_replacement_plan
  ADD CONSTRAINT model_replacement_plan_status_check
  CHECK (status IN ('READY', 'APPLIED'));
