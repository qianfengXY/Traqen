-- A resolver grants a fixed, server-owned investigation budget.  The account
-- row serializes reservations so concurrent requests cannot overrun it.
ALTER TABLE f002_request
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN cancel_operation_id text,
  ADD COLUMN budget jsonb,
  ADD COLUMN derived_run_id text,
  ADD COLUMN derived_scope_id text,
  ADD CONSTRAINT f002_request_budget_object CHECK (budget IS NULL OR jsonb_typeof(budget) = 'object'),
  ADD CONSTRAINT f002_request_derived_scope_pair CHECK ((derived_run_id IS NULL) = (derived_scope_id IS NULL)),
  ADD CONSTRAINT f002_request_derived_scope FOREIGN KEY (workspace_id,derived_run_id,derived_scope_id)
    REFERENCES f002_scope(workspace_id,run_id,scope_id);

CREATE TABLE f002_request_budget_account (
  workspace_id text NOT NULL,
  investigation_id text NOT NULL,
  binding_digest text NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  budget jsonb NOT NULL CHECK (jsonb_typeof(budget) = 'object'),
  reserved_materials integer NOT NULL DEFAULT 0 CHECK (reserved_materials >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  reserved_rule_applications integer NOT NULL DEFAULT 0 CHECK (reserved_rule_applications >= 0),
  reserved_attempts integer NOT NULL DEFAULT 0 CHECK (reserved_attempts >= 0),
  settled_materials integer NOT NULL DEFAULT 0 CHECK (settled_materials >= 0),
  settled_bytes bigint NOT NULL DEFAULT 0 CHECK (settled_bytes >= 0),
  settled_rule_applications integer NOT NULL DEFAULT 0 CHECK (settled_rule_applications >= 0),
  settled_attempts integer NOT NULL DEFAULT 0 CHECK (settled_attempts >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,investigation_id,binding_digest)
);

CREATE TABLE f002_request_budget_reservation (
  request_id text PRIMARY KEY REFERENCES f002_request(id),
  workspace_id text NOT NULL,
  investigation_id text NOT NULL,
  binding_digest text NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  materials integer NOT NULL CHECK (materials >= 0),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  rule_applications integer NOT NULL CHECK (rule_applications >= 0),
  attempts integer NOT NULL CHECK (attempts >= 0),
  status text NOT NULL CHECK (status IN ('RESERVED','SETTLED','RELEASED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  FOREIGN KEY (workspace_id,investigation_id,binding_digest)
    REFERENCES f002_request_budget_account(workspace_id,investigation_id,binding_digest)
);
CREATE INDEX f002_request_budget_reservation_binding
  ON f002_request_budget_reservation(workspace_id,investigation_id,binding_digest,status);
