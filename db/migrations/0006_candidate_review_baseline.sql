ALTER TABLE claim
  ADD COLUMN constraint_payload jsonb
  CHECK (constraint_payload IS NULL OR jsonb_typeof(constraint_payload) = 'object');

DROP VIEW trace_chain_current;

ALTER TABLE trace_chain_revision
  ADD COLUMN segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(segments) = 'array'),
  ADD COLUMN conflicts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array');

CREATE VIEW trace_chain_current AS
SELECT DISTINCT ON (project_id, chain_id)
  project_id,
  chain_id,
  revision,
  feature_id,
  claim_id,
  claim_version,
  scope_id,
  scope_version,
  snapshot_manifest_id,
  deployment_component_id,
  dimensions,
  stages,
  segments,
  conflicts,
  complete,
  computed_at,
  created_at
FROM trace_chain_revision
ORDER BY project_id, chain_id, revision DESC;

CREATE TABLE implementation_mapping (
  project_id text NOT NULL,
  id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  snapshot_manifest_id text NOT NULL,
  source_component_id text NOT NULL,
  source_run_id text NOT NULL,
  source_candidate_id text NOT NULL,
  mapping_status text NOT NULL CHECK (mapping_status IN ('ACTIVE', 'STALE')),
  fact_refs jsonb NOT NULL CHECK (jsonb_typeof(fact_refs) = 'array' AND jsonb_array_length(fact_refs) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, source_component_id) REFERENCES snapshot_component(project_id, id),
  FOREIGN KEY (project_id, source_run_id) REFERENCES reverse_run(project_id, id)
);

ALTER TABLE implementation_conformance
  ADD COLUMN mapping_id text;

ALTER TABLE implementation_conformance
  ADD CONSTRAINT fk_conformance_mapping
  FOREIGN KEY (project_id, mapping_id) REFERENCES implementation_mapping(project_id, id);

CREATE TABLE reverse_candidate_review (
  project_id text NOT NULL,
  id text NOT NULL,
  request_fingerprint text NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  run_id text NOT NULL,
  candidate_id text NOT NULL,
  candidate_type text NOT NULL CHECK (candidate_type = 'CLAIM'),
  outcome text NOT NULL CHECK (
    outcome IN ('CONFIRMED', 'EXCEPTION_RECORDED', 'REJECTED', 'INSUFFICIENT_EVIDENCE', 'DEFERRED')
  ),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  acknowledged_conflict_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(acknowledged_conflict_ids) = 'array'),
  feature_id text,
  claim_id text,
  claim_version integer,
  decision_id text,
  implementation_mapping_id text,
  conformance_id text,
  review_payload jsonb NOT NULL CHECK (jsonb_typeof(review_payload) = 'object'),
  reviewed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, run_id, candidate_id),
  FOREIGN KEY (project_id, run_id) REFERENCES reverse_run(project_id, id),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, decision_id) REFERENCES human_decision(project_id, id),
  FOREIGN KEY (project_id, implementation_mapping_id) REFERENCES implementation_mapping(project_id, id),
  FOREIGN KEY (project_id, conformance_id) REFERENCES implementation_conformance(project_id, id),
  FOREIGN KEY (actor_id) REFERENCES principal(id),
  CHECK (
    (
      outcome IN ('CONFIRMED', 'EXCEPTION_RECORDED')
      AND feature_id IS NOT NULL
      AND claim_id IS NOT NULL
      AND claim_version IS NOT NULL
      AND decision_id IS NOT NULL
      AND implementation_mapping_id IS NOT NULL
      AND conformance_id IS NOT NULL
    ) OR (
      outcome IN ('REJECTED', 'INSUFFICIENT_EVIDENCE', 'DEFERRED')
      AND feature_id IS NULL
      AND claim_id IS NULL
      AND claim_version IS NULL
      AND decision_id IS NULL
      AND implementation_mapping_id IS NULL
      AND conformance_id IS NULL
    )
  )
);

CREATE INDEX idx_implementation_mapping_claim
  ON implementation_mapping(project_id, claim_id, claim_version, snapshot_manifest_id, created_at DESC);
CREATE INDEX idx_candidate_review_run
  ON reverse_candidate_review(project_id, run_id, reviewed_at, id);

CREATE FUNCTION enforce_mapping_source_snapshot() RETURNS trigger
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
    RAISE EXCEPTION 'implementation mapping source component must belong to the referenced snapshot manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_mapping_source_manifest
  BEFORE INSERT ON implementation_mapping
  FOR EACH ROW EXECUTE FUNCTION enforce_mapping_source_snapshot();

CREATE TRIGGER enforce_mapping_claim_scope
  BEFORE INSERT ON implementation_mapping
  FOR EACH ROW EXECUTE FUNCTION enforce_claim_bound_scope();

CREATE TRIGGER enforce_candidate_review_tenant
  BEFORE INSERT ON reverse_candidate_review
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_actor_tenant();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON implementation_mapping
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON reverse_candidate_review
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
