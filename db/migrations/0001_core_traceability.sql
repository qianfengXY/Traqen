CREATE TABLE organization (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE principal (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  principal_type text NOT NULL CHECK (principal_type IN ('USER', 'SERVICE_ACCOUNT', 'RUNNER')),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE snapshot_component (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('SOURCE', 'BUILD', 'DEPLOYMENT', 'RUNTIME')),
  digest text NOT NULL CHECK (btrim(digest) <> ''),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, id, component_type),
  UNIQUE (project_id, component_type, digest)
);

CREATE TABLE snapshot_manifest (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  observed_from timestamptz NOT NULL,
  observed_to timestamptz NOT NULL,
  complete boolean NOT NULL,
  failed_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(failed_sources) = 'array'),
  missing_components jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_components) = 'array'),
  content_hash text NOT NULL CHECK (btrim(content_hash) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, content_hash),
  CHECK (observed_from <= observed_to),
  CHECK (complete = false OR (failed_sources = '[]'::jsonb AND missing_components = '[]'::jsonb))
);

CREATE TABLE snapshot_manifest_component (
  project_id text NOT NULL,
  manifest_id text NOT NULL,
  component_id text NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('SOURCE', 'BUILD', 'DEPLOYMENT', 'RUNTIME')),
  PRIMARY KEY (project_id, manifest_id, component_type),
  FOREIGN KEY (project_id, manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, component_id, component_type)
    REFERENCES snapshot_component(project_id, id, component_type)
);

CREATE TABLE feature (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE feature_version (
  project_id text NOT NULL,
  feature_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  business_domain text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, feature_id, version),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id)
);

CREATE TABLE feature_lineage (
  project_id text NOT NULL,
  predecessor_id text NOT NULL,
  successor_id text NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('PREDECESSOR_OF', 'SUCCESSOR_OF', 'MERGED_INTO', 'SPLIT_INTO')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, predecessor_id, successor_id, relation_type),
  FOREIGN KEY (project_id, predecessor_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, successor_id) REFERENCES feature(project_id, id),
  CHECK (predecessor_id <> successor_id)
);

CREATE TABLE claim_scope (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id, version),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

CREATE TABLE claim (
  project_id text NOT NULL,
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  feature_id text NOT NULL,
  claim_type text NOT NULL CHECK (
    claim_type IN ('NORMATIVE_REQUIREMENT', 'IMPLEMENTATION_BEHAVIOR', 'DESIGN_INTENT', 'QUALITY_EXPECTATION')
  ),
  statement text NOT NULL CHECK (btrim(statement) <> ''),
  source_type text NOT NULL CHECK (source_type IN ('AI_CANDIDATE', 'HUMAN', 'FORMAL_AUTHORITY', 'DETERMINISTIC_DERIVATION')),
  evidence_support text NOT NULL CHECK (
    evidence_support IN ('NONE', 'SINGLE_SOURCE', 'MULTI_SOURCE', 'CONTRADICTED', 'INCOMPLETE')
  ),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id, version),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version)
);

CREATE TABLE human_decision (
  project_id text NOT NULL,
  id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  decision_type text NOT NULL CHECK (
    decision_type IN ('CONFIRMED', 'REJECTED', 'EXCEPTION_RECORDED', 'INSUFFICIENT_EVIDENCE', 'DEFERRED', 'DEPRECATED')
  ),
  content text,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (actor_id) REFERENCES principal(id)
);

CREATE TABLE implementation_conformance (
  project_id text NOT NULL,
  id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  snapshot_manifest_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('UNKNOWN', 'CONFORMS', 'DEVIATES', 'PARTIAL', 'CONFLICTED', 'STALE')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  analysis_method jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(analysis_method) = 'object'),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id)
);

CREATE TABLE test_spec (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  approved boolean NOT NULL DEFAULT false,
  specification jsonb NOT NULL CHECK (jsonb_typeof(specification) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id, version)
);

CREATE TABLE test_spec_claim (
  project_id text NOT NULL,
  test_spec_id text NOT NULL,
  test_spec_version integer NOT NULL CHECK (test_spec_version > 0),
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  PRIMARY KEY (project_id, test_spec_id, test_spec_version, claim_id, claim_version),
  FOREIGN KEY (project_id, test_spec_id, test_spec_version) REFERENCES test_spec(project_id, id, version),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version)
);

CREATE TABLE test_execution (
  project_id text NOT NULL,
  id text NOT NULL,
  test_spec_id text NOT NULL,
  test_spec_version integer NOT NULL CHECK (test_spec_version > 0),
  snapshot_manifest_id text NOT NULL,
  deployment_component_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('NOT_RUN', 'PASS', 'FAIL', 'ERROR', 'INCONCLUSIVE', 'SKIPPED', 'CANCELLED')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attempts) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, test_spec_id, test_spec_version) REFERENCES test_spec(project_id, id, version),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, deployment_component_id) REFERENCES snapshot_component(project_id, id),
  CHECK (finished_at IS NULL OR started_at <= finished_at)
);

CREATE TABLE evidence (
  project_id text NOT NULL,
  id text NOT NULL,
  execution_id text NOT NULL,
  evidence_type text NOT NULL CHECK (
    evidence_type IN ('HTTP', 'DATABASE', 'LOG', 'TRACE', 'COVERAGE', 'SCREENSHOT', 'ASSERTION', 'OTHER')
  ),
  integrity_status text NOT NULL CHECK (integrity_status IN ('VERIFIED', 'UNVERIFIED', 'INVALID')),
  freshness_status text NOT NULL CHECK (freshness_status IN ('FRESH', 'EXPIRING', 'STALE', 'INCOMPLETE')),
  content_hash text NOT NULL CHECK (btrim(content_hash) <> ''),
  storage_uri text,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, execution_id) REFERENCES test_execution(project_id, id),
  UNIQUE (project_id, content_hash)
);

CREATE TABLE trace_chain_revision (
  project_id text NOT NULL,
  chain_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  feature_id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  snapshot_manifest_id text NOT NULL,
  deployment_component_id text NOT NULL,
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  stages jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array'),
  complete boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, chain_id, revision),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, deployment_component_id) REFERENCES snapshot_component(project_id, id),
  UNIQUE (project_id, chain_id, computed_at)
);

CREATE TABLE trace_gap (
  project_id text NOT NULL,
  chain_id text NOT NULL,
  chain_revision bigint NOT NULL CHECK (chain_revision > 0),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  gap_type text NOT NULL CHECK (
    gap_type IN (
      'MISSING_NORMATIVE_CLAIM', 'MISSING_AUTHORITY', 'SCOPE_UNKNOWN', 'SNAPSHOT_INCOMPLETE',
      'IMPLEMENTATION_UNMAPPED', 'CONFORMANCE_UNKNOWN', 'CONFORMANCE_STALE', 'IMPLEMENTATION_DEVIATES',
      'UNRESOLVED_CONFLICT', 'NO_TEST_SPEC', 'TEST_SPEC_NOT_LINKED', 'TEST_SPEC_UNAPPROVED', 'NO_ASSERTION',
      'NOT_EXECUTED_ON_CURRENT_DEPLOYMENT', 'VERIFICATION_FAILED', 'EXECUTION_ERROR',
      'VERIFICATION_INCONCLUSIVE', 'EVIDENCE_MISSING', 'EVIDENCE_UNVERIFIED', 'EVIDENCE_EXPIRING', 'EVIDENCE_STALE'
    )
  ),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCKING')),
  owner_role text NOT NULL CHECK (btrim(owner_role) <> ''),
  message text NOT NULL CHECK (btrim(message) <> ''),
  PRIMARY KEY (project_id, chain_id, chain_revision, ordinal),
  FOREIGN KEY (project_id, chain_id, chain_revision)
    REFERENCES trace_chain_revision(project_id, chain_id, revision)
);

CREATE TABLE audit_event (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  actor_id text,
  subject_type text NOT NULL CHECK (btrim(subject_type) <> ''),
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (actor_id) REFERENCES principal(id)
);

CREATE INDEX idx_snapshot_manifest_created ON snapshot_manifest(project_id, created_at DESC);
CREATE INDEX idx_claim_feature ON claim(project_id, feature_id, version DESC);
CREATE INDEX idx_decision_claim ON human_decision(project_id, claim_id, claim_version, created_at DESC);
CREATE INDEX idx_conformance_claim_manifest
  ON implementation_conformance(project_id, claim_id, claim_version, snapshot_manifest_id, computed_at DESC);
CREATE INDEX idx_execution_spec ON test_execution(project_id, test_spec_id, test_spec_version, created_at DESC);
CREATE INDEX idx_evidence_execution ON evidence(project_id, execution_id, created_at DESC);
CREATE INDEX idx_trace_chain_feature ON trace_chain_revision(project_id, feature_id, computed_at DESC);
CREATE INDEX idx_trace_gap_open_work ON trace_gap(project_id, severity, owner_role, gap_type);
CREATE INDEX idx_audit_subject ON audit_event(project_id, subject_type, subject_id, occurred_at DESC);

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
  complete,
  computed_at,
  created_at
FROM trace_chain_revision
ORDER BY project_id, chain_id, revision DESC;

CREATE FUNCTION reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE and DELETE are forbidden', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE
  immutable_table text;
BEGIN
  FOREACH immutable_table IN ARRAY ARRAY[
    'snapshot_component',
    'snapshot_manifest',
    'snapshot_manifest_component',
    'feature',
    'feature_version',
    'feature_lineage',
    'claim_scope',
    'claim',
    'human_decision',
    'implementation_conformance',
    'test_spec',
    'test_spec_claim',
    'test_execution',
    'evidence',
    'trace_chain_revision',
    'trace_gap',
    'audit_event'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation()',
      immutable_table
    );
  END LOOP;
END;
$$;
