CREATE TABLE source_truth_confirmation (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL,
  run_id text,
  revision integer NOT NULL CHECK (revision>0),
  candidate_id text NOT NULL CHECK (candidate_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES principal(id),
  payload jsonb NOT NULL,
  expires_at timestamptz,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,run_id,revision),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id)
);
CREATE UNIQUE INDEX source_truth_renewal_confirmation_revision
  ON source_truth_confirmation(workspace_id,candidate_id,revision) WHERE run_id IS NULL;
CREATE TABLE source_truth_publication_operation (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL,
  run_id text,
  confirmation_id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  status text NOT NULL CHECK (status IN ('PREPARING','COMMITTED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,confirmation_id),
  FOREIGN KEY (workspace_id,confirmation_id) REFERENCES source_truth_confirmation(workspace_id,id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id),
  CHECK ((status='COMMITTED')=(result IS NOT NULL))
);
CREATE TABLE source_truth_publication_token (
  workspace_id text NOT NULL,
  client_token text NOT NULL,
  operation_id text NOT NULL,
  binding jsonb NOT NULL,
  PRIMARY KEY (workspace_id,client_token),
  FOREIGN KEY (workspace_id,operation_id) REFERENCES source_truth_publication_operation(workspace_id,id)
);
CREATE TABLE source_truth_receipt (
  workspace_id text NOT NULL,
  id text NOT NULL,
  bundle_id text NOT NULL,
  confirmation_id text NOT NULL,
  operation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('READY','READY_WITH_ACCEPTED_GAPS')),
  payload jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,operation_id),
  FOREIGN KEY (workspace_id,bundle_id) REFERENCES source_truth_bundle(workspace_id,id),
  FOREIGN KEY (workspace_id,confirmation_id) REFERENCES source_truth_confirmation(workspace_id,id),
  FOREIGN KEY (workspace_id,operation_id) REFERENCES source_truth_publication_operation(workspace_id,id)
);
CREATE INDEX source_truth_receipt_history ON source_truth_receipt(workspace_id,issued_at,id);
CREATE TABLE source_truth_bundle_component (
  workspace_id text NOT NULL,
  bundle_id text NOT NULL,
  component_id text NOT NULL,
  PRIMARY KEY (workspace_id,bundle_id,component_id),
  FOREIGN KEY (workspace_id,bundle_id) REFERENCES source_truth_bundle(workspace_id,id),
  FOREIGN KEY (workspace_id,component_id) REFERENCES source_truth_component(workspace_id,id)
);
CREATE TRIGGER source_truth_immutable_confirmation BEFORE UPDATE OR DELETE ON source_truth_confirmation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_receipt BEFORE UPDATE OR DELETE ON source_truth_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_publication_token BEFORE UPDATE OR DELETE ON source_truth_publication_token
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_bundle_component BEFORE UPDATE OR DELETE ON source_truth_bundle_component
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE FUNCTION source_truth_guard_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='COMMITTED' THEN RAISE EXCEPTION 'Committed publication is immutable'; END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.id<>OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.confirmation_id<>OLD.confirmation_id OR NEW.actor_id<>OLD.actor_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Publication binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_bound_operation BEFORE UPDATE OR DELETE ON source_truth_publication_operation
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_operation();
