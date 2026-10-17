-- Authentication records have distinct keys; immutable audit and notifications never expire.
CREATE TABLE IF NOT EXISTS auth_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initialized boolean NOT NULL DEFAULT false,
  recovery boolean NOT NULL DEFAULT false,
  epoch bigint NOT NULL DEFAULT 1,
  revision bigint NOT NULL DEFAULT 0
);
INSERT INTO auth_control(singleton) VALUES (true) ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE auth_record (
  kind text NOT NULL CHECK (kind IN ('accounts','sessions','credentials','grants','spaces','applications','programs','notifications','bindings','attempts')),
  id text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  PRIMARY KEY(kind,id)
);
CREATE UNIQUE INDEX auth_account_login ON auth_record ((payload->>'login')) WHERE kind='accounts';
CREATE TABLE auth_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  workspace_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_audit_workspace ON auth_audit(workspace_id,sequence);
ALTER TABLE source_truth_access RENAME TO source_truth_access_legacy;
CREATE VIEW source_truth_access AS
 SELECT g.payload->>'workspaceId' AS workspace_id, b.id AS actor_id,
 CASE WHEN bool_or(g.payload->'roles' ? 'OWNER' OR g.payload->'roles' ? 'MAINTAIN') THEN 'MAINTAIN' ELSE 'READ' END AS role,
 max(COALESCE((g.payload->>'version')::integer,1)) AS revision
 FROM auth_record g
 JOIN auth_record a ON a.kind='accounts' AND a.id=g.payload->>'accountId'
 JOIN auth_record b ON b.kind='bindings' AND b.payload->>'accountId'=a.id
 WHERE g.kind='grants' AND a.payload->>'status'='ACTIVE'
 AND (g.payload->'roles' ?| ARRAY['OWNER','MAINTAIN','READ'])
 AND (g.payload->>'source'<>'ADMIN' OR a.payload->>'admin'='true')
 AND b.payload->>'tenantId'=(SELECT p.tenant_id FROM project p WHERE p.id=g.payload->>'workspaceId')
 GROUP BY g.payload->>'workspaceId',b.id
 UNION ALL
 SELECT l.workspace_id,l.actor_id,l.role,l.revision FROM source_truth_access_legacy l
 WHERE NOT (SELECT initialized FROM auth_control WHERE singleton);
