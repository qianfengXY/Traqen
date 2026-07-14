CREATE TABLE reverse_skill_registration (
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  registration_id text PRIMARY KEY,
  skill_id text NOT NULL CHECK (btrim(skill_id) <> ''),
  skill_version text NOT NULL CHECK (btrim(skill_version) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  publisher text NOT NULL CHECK (btrim(publisher) <> ''),
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  supply_status text NOT NULL CHECK (supply_status IN ('ALLOWED', 'OBSERVE', 'BLOCKED')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  publisher_attestation jsonb NOT NULL CHECK (
    jsonb_typeof(publisher_attestation) = 'object'
    AND publisher_attestation->>'algorithm' = 'HMAC-SHA256'
    AND publisher_attestation->>'publisher' = publisher
    AND publisher_attestation->>'signature' ~ '^[a-f0-9]{64}$'
  ),
  registered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, skill_version, supply_status, registered_at)
);

CREATE INDEX idx_reverse_skill_current
  ON reverse_skill_registration(skill_id, skill_version, event_sequence DESC);

CREATE TABLE reverse_run (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  source_component_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (
    status IN ('WAITING_REVIEW', 'FAILED', 'CANCELLED', 'BASELINED', 'COMPLETED')
  ),
  input_package jsonb NOT NULL CHECK (jsonb_typeof(input_package) = 'object'),
  run_payload jsonb NOT NULL CHECK (jsonb_typeof(run_payload) = 'object'),
  created_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, source_component_id) REFERENCES snapshot_component(project_id, id),
  CHECK (created_at <= finished_at)
);

CREATE TABLE reverse_run_event (
  project_id text NOT NULL,
  run_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (
    status IN (
      'CREATED', 'FACT_SCANNING', 'SKILL_PLANNING', 'SKILL_RUNNING', 'NORMALIZING',
      'CONFLICT_ANALYSIS', 'WAITING_REVIEW', 'BASELINED', 'COMPLETED', 'FAILED', 'CANCELLED'
    )
  ),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, run_id, sequence),
  FOREIGN KEY (project_id, run_id) REFERENCES reverse_run(project_id, id)
);

CREATE TABLE reverse_skill_execution (
  project_id text NOT NULL,
  run_id text NOT NULL,
  skill_id text NOT NULL,
  skill_version text NOT NULL,
  registration_id text NOT NULL REFERENCES reverse_skill_registration(registration_id),
  status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'CANCELLED')),
  observe_only boolean NOT NULL,
  attempts jsonb NOT NULL CHECK (jsonb_typeof(attempts) = 'array'),
  raw_output jsonb,
  normalized_output jsonb,
  PRIMARY KEY (project_id, run_id, skill_id, skill_version),
  FOREIGN KEY (project_id, run_id) REFERENCES reverse_run(project_id, id),
  CHECK (
    (status = 'COMPLETED' AND jsonb_typeof(raw_output) = 'object' AND jsonb_typeof(normalized_output) = 'object')
    OR (status IN ('FAILED', 'CANCELLED') AND raw_output IS NULL AND normalized_output IS NULL)
  )
);

CREATE TABLE reverse_conflict (
  project_id text NOT NULL,
  run_id text NOT NULL,
  id text NOT NULL,
  conflict_type text NOT NULL CHECK (btrim(conflict_type) <> ''),
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_ids) = 'array'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  detected_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, run_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES reverse_run(project_id, id)
);

CREATE TABLE reverse_open_question (
  project_id text NOT NULL,
  run_id text NOT NULL,
  id text NOT NULL,
  question text NOT NULL CHECK (btrim(question) <> ''),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
  PRIMARY KEY (project_id, run_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES reverse_run(project_id, id)
);

CREATE INDEX idx_reverse_run_snapshot
  ON reverse_run(project_id, snapshot_manifest_id, finished_at DESC);
CREATE INDEX idx_reverse_conflict_open
  ON reverse_conflict(project_id, status, detected_at DESC);

CREATE FUNCTION enforce_reverse_run_source_snapshot() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM snapshot_manifest_component
    WHERE project_id = NEW.project_id
      AND manifest_id = NEW.snapshot_manifest_id
      AND component_id = NEW.source_component_id
      AND component_type = 'SOURCE'
  ) THEN
    RAISE EXCEPTION 'reverse run source component must belong to the referenced snapshot manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_reverse_run_source_manifest
  BEFORE INSERT ON reverse_run
  FOR EACH ROW EXECUTE FUNCTION enforce_reverse_run_source_snapshot();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reverse_skill_registration', 'reverse_run', 'reverse_run_event',
    'reverse_skill_execution', 'reverse_conflict', 'reverse_open_question'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;
