CREATE TABLE change_set (
  project_id text NOT NULL,
  id text NOT NULL,
  from_snapshot_manifest_id text NOT NULL,
  to_snapshot_manifest_id text NOT NULL,
  complete boolean NOT NULL,
  warnings jsonb NOT NULL CHECK (jsonb_typeof(warnings) = 'array'),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  change_set_payload jsonb NOT NULL CHECK (jsonb_typeof(change_set_payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, from_snapshot_manifest_id, to_snapshot_manifest_id),
  FOREIGN KEY (project_id, from_snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, to_snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  CHECK (from_snapshot_manifest_id <> to_snapshot_manifest_id)
);

CREATE TABLE impact_assessment (
  project_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  impact_payload jsonb NOT NULL CHECK (jsonb_typeof(impact_payload) = 'object'),
  change_impact_payload jsonb NOT NULL CHECK (jsonb_typeof(change_impact_payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, change_set_id),
  FOREIGN KEY (project_id, change_set_id) REFERENCES change_set(project_id, id)
);

CREATE TABLE implementation_continuity_event (
  project_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  feature_id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  from_snapshot_manifest_id text NOT NULL,
  to_snapshot_manifest_id text NOT NULL,
  from_mapping_id text NOT NULL,
  to_mapping_id text NOT NULL,
  from_conformance_id text NOT NULL,
  to_conformance_id text NOT NULL,
  fact_ref_rebindings jsonb NOT NULL CHECK (
    jsonb_typeof(fact_ref_rebindings) = 'array' AND jsonb_array_length(fact_ref_rebindings) > 0
  ),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, change_set_id) REFERENCES change_set(project_id, id),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (project_id, from_snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, to_snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, from_mapping_id) REFERENCES implementation_mapping(project_id, id),
  FOREIGN KEY (project_id, to_mapping_id) REFERENCES implementation_mapping(project_id, id),
  FOREIGN KEY (project_id, from_conformance_id) REFERENCES implementation_conformance(project_id, id),
  FOREIGN KEY (project_id, to_conformance_id) REFERENCES implementation_conformance(project_id, id)
);

CREATE TABLE trace_invalidation_event (
  project_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  feature_id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  mapping_id text NOT NULL,
  test_spec_ids jsonb NOT NULL CHECK (jsonb_typeof(test_spec_ids) = 'array'),
  change_ids jsonb NOT NULL CHECK (jsonb_typeof(change_ids) = 'array'),
  invalidated_layers jsonb NOT NULL CHECK (jsonb_typeof(invalidated_layers) = 'array'),
  preserved_layers jsonb NOT NULL CHECK (jsonb_typeof(preserved_layers) = 'array'),
  recommended_actions jsonb NOT NULL CHECK (jsonb_typeof(recommended_actions) = 'array'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, change_set_id) REFERENCES change_set(project_id, id),
  FOREIGN KEY (project_id, feature_id) REFERENCES feature(project_id, id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  FOREIGN KEY (project_id, mapping_id) REFERENCES implementation_mapping(project_id, id)
);

CREATE INDEX idx_change_set_pair
  ON change_set(project_id, from_snapshot_manifest_id, to_snapshot_manifest_id, created_at DESC);
CREATE INDEX idx_invalidation_feature
  ON trace_invalidation_event(project_id, feature_id, occurred_at DESC);
CREATE INDEX idx_invalidation_claim
  ON trace_invalidation_event(project_id, claim_id, claim_version, occurred_at DESC);
CREATE INDEX idx_continuity_feature
  ON implementation_continuity_event(project_id, feature_id, occurred_at DESC);

CREATE FUNCTION enforce_mapping_fact_snapshot() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fact_ref jsonb;
  referenced_fact_id text;
BEGIN
  FOR fact_ref IN SELECT value FROM jsonb_array_elements(NEW.fact_refs)
  LOOP
    referenced_fact_id := fact_ref->>'factId';
    IF referenced_fact_id IS NULL OR btrim(referenced_fact_id) = '' OR fact_ref->>'relation' IS NULL THEN
      RAISE EXCEPTION 'implementation mapping fact references must contain factId and relation'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM fact_node
      WHERE project_id = NEW.project_id
        AND snapshot_manifest_id = NEW.snapshot_manifest_id
        AND fact_id = referenced_fact_id
      UNION ALL
      SELECT 1
      FROM fact_edge
      WHERE project_id = NEW.project_id
        AND snapshot_manifest_id = NEW.snapshot_manifest_id
        AND id = referenced_fact_id
    ) THEN
      RAISE EXCEPTION 'implementation mapping fact % does not belong to the referenced Snapshot Manifest', referenced_fact_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_mapping_fact_manifest
  BEFORE INSERT ON implementation_mapping
  FOR EACH ROW EXECUTE FUNCTION enforce_mapping_fact_snapshot();

CREATE FUNCTION enforce_invalidation_consistency() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM implementation_mapping im
    JOIN claim c
      ON c.project_id = im.project_id
     AND c.id = im.claim_id
     AND c.version = im.claim_version
    JOIN change_set cs
      ON cs.project_id = im.project_id
     AND cs.id = NEW.change_set_id
     AND cs.from_snapshot_manifest_id = im.snapshot_manifest_id
    WHERE im.project_id = NEW.project_id
      AND im.id = NEW.mapping_id
      AND im.claim_id = NEW.claim_id
      AND im.claim_version = NEW.claim_version
      AND im.scope_id = NEW.scope_id
      AND im.scope_version = NEW.scope_version
      AND c.feature_id = NEW.feature_id
  ) THEN
    RAISE EXCEPTION 'trace invalidation must match its ChangeSet, mapping, Claim, Scope, and Feature'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_invalidation_references
  BEFORE INSERT ON trace_invalidation_event
  FOR EACH ROW EXECUTE FUNCTION enforce_invalidation_consistency();

CREATE FUNCTION enforce_continuity_consistency() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM implementation_mapping from_mapping
    JOIN implementation_mapping to_mapping
      ON to_mapping.project_id = from_mapping.project_id
     AND to_mapping.id = NEW.to_mapping_id
    JOIN implementation_conformance from_conformance
      ON from_conformance.project_id = from_mapping.project_id
     AND from_conformance.id = NEW.from_conformance_id
     AND from_conformance.mapping_id = from_mapping.id
    JOIN implementation_conformance to_conformance
      ON to_conformance.project_id = to_mapping.project_id
     AND to_conformance.id = NEW.to_conformance_id
     AND to_conformance.mapping_id = to_mapping.id
    JOIN claim c
      ON c.project_id = from_mapping.project_id
     AND c.id = from_mapping.claim_id
     AND c.version = from_mapping.claim_version
    JOIN change_set cs
      ON cs.project_id = from_mapping.project_id
     AND cs.id = NEW.change_set_id
     AND cs.from_snapshot_manifest_id = NEW.from_snapshot_manifest_id
     AND cs.to_snapshot_manifest_id = NEW.to_snapshot_manifest_id
    WHERE from_mapping.project_id = NEW.project_id
      AND from_mapping.id = NEW.from_mapping_id
      AND from_mapping.snapshot_manifest_id = NEW.from_snapshot_manifest_id
      AND to_mapping.snapshot_manifest_id = NEW.to_snapshot_manifest_id
      AND from_mapping.claim_id = NEW.claim_id
      AND from_mapping.claim_version = NEW.claim_version
      AND from_mapping.scope_id = NEW.scope_id
      AND from_mapping.scope_version = NEW.scope_version
      AND to_mapping.claim_id = NEW.claim_id
      AND to_mapping.claim_version = NEW.claim_version
      AND to_mapping.scope_id = NEW.scope_id
      AND to_mapping.scope_version = NEW.scope_version
      AND c.feature_id = NEW.feature_id
  ) THEN
    RAISE EXCEPTION 'implementation continuity must preserve its ChangeSet, Claim, Scope, Feature, mapping, and conformance references'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_continuity_references
  BEFORE INSERT ON implementation_continuity_event
  FOR EACH ROW EXECUTE FUNCTION enforce_continuity_consistency();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON change_set
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON impact_assessment
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON trace_invalidation_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON implementation_continuity_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
