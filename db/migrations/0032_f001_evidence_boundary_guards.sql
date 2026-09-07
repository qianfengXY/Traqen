CREATE FUNCTION source_truth_guard_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Source registration in a run is immutable'; END IF;
  IF OLD.source IS DISTINCT FROM NEW.source OR OLD.workspace_id<>NEW.workspace_id OR OLD.run_id<>NEW.run_id
    OR OLD.source_id<>NEW.source_id OR OLD.kind<>NEW.kind
    OR (OLD.enumeration_closed AND NOT NEW.enumeration_closed)
    OR (OLD.manifest_id IS NOT NULL AND OLD.manifest_id IS DISTINCT FROM NEW.manifest_id) THEN
    RAISE EXCEPTION 'Locked source identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_locked_source BEFORE UPDATE OR DELETE ON source_truth_run_source
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_source();

CREATE FUNCTION source_truth_parent_path(value bytea) RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE at integer;
BEGIN
  FOR at IN REVERSE length(value)-1..0 LOOP
    IF get_byte(value,at)=47 THEN RETURN substring(value FROM 1 FOR at); END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION source_truth_guard_manifest_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_truth_manifest WHERE workspace_id=NEW.workspace_id AND id=NEW.manifest_id) THEN
    RAISE EXCEPTION 'Completed manifest shard membership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_closed_manifest_shards BEFORE INSERT ON source_truth_manifest_shard
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_manifest_membership();

CREATE FUNCTION source_truth_guard_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('CANCELLED','BLOCKED','FAILED_RETRYABLE','SUCCEEDED') THEN
    RAISE EXCEPTION 'Terminal capture attempts are immutable';
  END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.id<>OLD.id OR NEW.actor_id<>OLD.actor_id
    OR NEW.draft_revision<>OLD.draft_revision OR NEW.input IS DISTINCT FROM OLD.input
    OR NEW.policy_revision_id<>OLD.policy_revision_id OR NEW.retry_of IS DISTINCT FROM OLD.retry_of OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Capture attempt identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_immutable_run_identity BEFORE UPDATE OR DELETE ON source_truth_run
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_run_identity();

CREATE FUNCTION source_truth_guard_bundle_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM source_truth_bundle b, jsonb_array_elements(b.payload->'identity'->'components') c
    WHERE b.workspace_id=NEW.workspace_id AND b.id=NEW.bundle_id AND c->>'id'=NEW.component_id) THEN
    RAISE EXCEPTION 'Component not in immutable bundle identity';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_exact_bundle_members BEFORE INSERT ON source_truth_bundle_component
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_bundle_membership();

-- Existing Workspace lifecycle writers and Source Truth transactions serialize
-- on the project row. A deletion cannot race the final permission check/seal.
CREATE FUNCTION source_truth_lock_workspace_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM project WHERE id=NEW.project_id FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_workspace_lifecycle_boundary BEFORE INSERT ON understanding_record
  FOR EACH ROW WHEN (NEW.record_type='WORKSPACE_EVENT') EXECUTE FUNCTION source_truth_lock_workspace_lifecycle();
