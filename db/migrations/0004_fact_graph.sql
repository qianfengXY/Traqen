CREATE TABLE fact_bundle (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  source_component_id text NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^sha256:[a-f0-9]{64}$'),
  extractor_id text NOT NULL CHECK (btrim(extractor_id) <> ''),
  extractor_version text NOT NULL CHECK (btrim(extractor_version) <> ''),
  observed_at timestamptz NOT NULL,
  complete boolean NOT NULL,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(diagnostics) = 'array'),
  scanner_attestation jsonb NOT NULL CHECK (
    jsonb_typeof(scanner_attestation) = 'object'
    AND scanner_attestation->>'algorithm' = 'HMAC-SHA256'
    AND scanner_attestation->>'extractorId' = extractor_id
    AND scanner_attestation->>'signature' ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, source_component_id) REFERENCES snapshot_component(project_id, id),
  UNIQUE (project_id, snapshot_manifest_id, source_digest, extractor_id, extractor_version, observed_at)
);

CREATE TABLE fact_node (
  project_id text NOT NULL,
  bundle_id text NOT NULL,
  fact_id text NOT NULL,
  node_id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  node_type text NOT NULL CHECK (
    node_type IN (
      'ARTIFACT', 'MODULE', 'CODE_SYMBOL', 'ENDPOINT', 'DATA_OBJECT',
      'CONFIGURATION', 'EXTERNAL_DEPENDENCY', 'TEST_ASSET'
    )
  ),
  natural_key text NOT NULL CHECK (btrim(natural_key) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  source_artifact text NOT NULL CHECK (btrim(source_artifact) <> ''),
  start_line integer NOT NULL CHECK (start_line > 0),
  end_line integer NOT NULL CHECK (end_line >= start_line),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, bundle_id, fact_id),
  UNIQUE (project_id, bundle_id, node_id),
  FOREIGN KEY (project_id, bundle_id) REFERENCES fact_bundle(project_id, id)
);

CREATE TABLE fact_edge (
  project_id text NOT NULL,
  bundle_id text NOT NULL,
  id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  subject_node_id text NOT NULL,
  predicate text NOT NULL CHECK (
    predicate IN (
      'CONTAINS', 'IMPLEMENTED_BY', 'CALLS', 'READS', 'WRITES',
      'CONTROLLED_BY', 'DEPENDS_ON', 'EXERCISES'
    )
  ),
  object_node_id text NOT NULL,
  source_artifact text NOT NULL CHECK (btrim(source_artifact) <> ''),
  start_line integer NOT NULL CHECK (start_line > 0),
  end_line integer NOT NULL CHECK (end_line >= start_line),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, bundle_id, id),
  FOREIGN KEY (project_id, bundle_id) REFERENCES fact_bundle(project_id, id),
  FOREIGN KEY (project_id, bundle_id, subject_node_id)
    REFERENCES fact_node(project_id, bundle_id, node_id),
  FOREIGN KEY (project_id, bundle_id, object_node_id)
    REFERENCES fact_node(project_id, bundle_id, node_id),
  CHECK (subject_node_id <> object_node_id)
);

CREATE INDEX idx_fact_bundle_snapshot
  ON fact_bundle(project_id, snapshot_manifest_id, observed_at DESC);
CREATE INDEX idx_fact_node_type
  ON fact_node(project_id, snapshot_manifest_id, node_type, natural_key);
CREATE INDEX idx_fact_node_name_search
  ON fact_node(project_id, lower(name));
CREATE INDEX idx_fact_edge_subject
  ON fact_edge(project_id, snapshot_manifest_id, subject_node_id, predicate);
CREATE INDEX idx_fact_edge_object
  ON fact_edge(project_id, snapshot_manifest_id, object_node_id, predicate);

CREATE FUNCTION enforce_fact_bundle_source_snapshot() RETURNS trigger
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
    RAISE EXCEPTION 'fact bundle source component must belong to the referenced snapshot manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_fact_bundle_source_manifest
  BEFORE INSERT ON fact_bundle
  FOR EACH ROW EXECUTE FUNCTION enforce_fact_bundle_source_snapshot();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['fact_bundle', 'fact_node', 'fact_edge']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;
