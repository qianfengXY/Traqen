CREATE TABLE global_account_revision (
  account_id text NOT NULL CHECK (btrim(account_id) <> ''),
  revision integer NOT NULL CHECK (revision > 0),
  id text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, revision)
);

CREATE TRIGGER reject_global_account_revision_mutation
  BEFORE UPDATE OR DELETE ON global_account_revision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
