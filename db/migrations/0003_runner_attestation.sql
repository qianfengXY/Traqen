ALTER TABLE test_execution
  ADD COLUMN runner_id text,
  ADD COLUMN runner_version text,
  ADD COLUMN completion_reason text,
  ADD COLUMN runner_attestation jsonb;

ALTER TABLE test_execution
  ADD CONSTRAINT ck_test_execution_runner_attestation
  CHECK (
    (
      runner_id IS NULL
      AND runner_version IS NULL
      AND completion_reason IS NULL
      AND runner_attestation IS NULL
    )
    OR
    (
      btrim(runner_id) <> ''
      AND btrim(runner_version) <> ''
      AND completion_reason IN ('COMPLETED', 'SKIPPED', 'CANCELLED')
      AND jsonb_typeof(runner_attestation) = 'object'
      AND runner_attestation->>'runnerId' = runner_id
      AND runner_attestation->>'algorithm' = 'HMAC-SHA256'
    )
  );

CREATE INDEX idx_test_execution_spec_finished
  ON test_execution(project_id, test_spec_id, test_spec_version, finished_at DESC);

CREATE INDEX idx_evidence_execution_created
  ON evidence(project_id, execution_id, created_at);

CREATE FUNCTION enforce_execution_deployment_manifest() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM snapshot_manifest_component
    WHERE project_id = NEW.project_id
      AND manifest_id = NEW.snapshot_manifest_id
      AND component_id = NEW.deployment_component_id
      AND component_type = 'DEPLOYMENT'
  ) THEN
    RAISE EXCEPTION 'execution deployment must belong to the referenced snapshot manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_execution_manifest_deployment
  BEFORE INSERT ON test_execution
  FOR EACH ROW EXECUTE FUNCTION enforce_execution_deployment_manifest();
