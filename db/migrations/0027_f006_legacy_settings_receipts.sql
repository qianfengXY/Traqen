-- F006 upgrades must be explainable.  These records preserve the source identity
-- and result of the one-time interpretation without rewriting immutable history.
CREATE TABLE f006_legacy_settings_migration_receipt (
  id text PRIMARY KEY,
  source_kind text NOT NULL CHECK (btrim(source_kind) <> ''),
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  outcome text NOT NULL CHECK (outcome IN ('CLI_CANDIDATE', 'UNSUPPORTED_F006_V1', 'NEEDS_ATTENTION')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

CREATE TABLE f006_legacy_settings_source_mapping (
  source_kind text NOT NULL,
  source_id text NOT NULL,
  receipt_id text NOT NULL REFERENCES f006_legacy_settings_migration_receipt(id),
  target_kind text NOT NULL,
  target_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id)
);

CREATE TRIGGER reject_f006_legacy_settings_migration_receipt_mutation
  BEFORE UPDATE OR DELETE ON f006_legacy_settings_migration_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_f006_legacy_settings_source_mapping_mutation
  BEFORE UPDATE OR DELETE ON f006_legacy_settings_source_mapping
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT
  'F006-LEGACY-MODEL-' || r.revision_id,
  'GLOBAL_MODEL_PROFILE_REVISION',
  r.revision_id,
  CASE WHEN upper(coalesce(r.profile_payload ->> 'transport', 'API')) = 'CLI'
    THEN 'CLI_CANDIDATE' ELSE 'UNSUPPORTED_F006_V1' END,
  CASE WHEN upper(coalesce(r.profile_payload ->> 'transport', 'API')) = 'CLI'
    THEN 'Requires Account-backed CLI eligibility verification before use'
    ELSE 'Historical direct-API model is retained but unsupported by F006 v1' END,
  jsonb_build_object(
    'profileId', r.profile_id,
    'revision', r.revision,
    'transport', upper(coalesce(r.profile_payload ->> 'transport', 'API')),
    'accountId', r.profile_payload ->> 'accountId'
  )
FROM global_model_profile_revision r
ON CONFLICT (source_kind, source_id) DO NOTHING;

-- Immutable historical Drafts are not rewritten. When a legacy active Draft has
-- only empty extra Child placeholders, append one normalized Draft revision and
-- advance its guarded head. The first Child remains even when unconfigured.
CREATE TEMP TABLE f006_legacy_draft_normalization ON COMMIT DROP AS
WITH current_draft AS (
  SELECT head.project_id,
         head.version AS head_version,
         draft.id AS prior_draft_id,
         draft.record_payload AS prior_payload
  FROM workspace_capability_head head
  JOIN understanding_record draft
    ON draft.project_id = head.project_id
   AND draft.record_type = 'WORKSPACE_CAPABILITY_DRAFT'
   AND draft.id = head.record_id
  WHERE head.head_key = 'WORKSPACE_CAPABILITY_DRAFT'
), normalized AS (
  SELECT current_draft.*,
         COALESCE(
           (
             SELECT jsonb_agg(slot.child ORDER BY slot.ordinality)
             FROM jsonb_array_elements(COALESCE(current_draft.prior_payload->'childAgentSlots', '[]'::jsonb)) WITH ORDINALITY AS slot(child, ordinality)
             WHERE slot.ordinality = 1
                OR COALESCE(slot.child->>'modelProfileId', slot.child->>'model', '') <> ''
                OR jsonb_array_length(COALESCE(slot.child->'skillGrants', slot.child->'skillNames', '[]'::jsonb)) > 0
                OR jsonb_array_length(COALESCE(slot.child->'mcpGrants', slot.child->'mcpNames', '[]'::jsonb)) > 0
           ),
           jsonb_build_array(jsonb_build_object(
             'id', 'CHILD-1', 'role', 'CHILD', 'displayName', 'Child Agent 1',
             'modelProfileId', '', 'skillGrants', '[]'::jsonb, 'mcpGrants', '[]'::jsonb,
             'rolePolicy', 'SPECIALIST', 'independenceGroup', '', 'enabled', true
           ))
         ) AS normalized_children
  FROM current_draft
)
SELECT normalized.*,
       'F006-DRAFT-NORMALIZED-' || md5(project_id || ':' || prior_draft_id) AS normalized_draft_id,
       head_version + 1 AS normalized_draft_revision
FROM normalized
WHERE normalized_children IS DISTINCT FROM COALESCE(prior_payload->'childAgentSlots', '[]'::jsonb);

INSERT INTO understanding_record (
  project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
)
SELECT project_id,
       'WORKSPACE_CAPABILITY_DRAFT',
       normalized_draft_id,
       NULL,
       NULL,
       NULL,
       prior_payload || jsonb_build_object(
         'id', normalized_draft_id,
         'revision', normalized_draft_revision,
         'childAgentSlots', normalized_children,
         'createdAt', current_timestamp
       ),
       current_timestamp
FROM f006_legacy_draft_normalization;

UPDATE workspace_capability_head head
SET version = normalized.normalized_draft_revision,
    record_id = normalized.normalized_draft_id
FROM f006_legacy_draft_normalization normalized
WHERE head.project_id = normalized.project_id
  AND head.head_key = 'WORKSPACE_CAPABILITY_DRAFT'
  AND head.version = normalized.head_version
  AND head.record_id = normalized.prior_draft_id;

INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT 'F006-LEGACY-DRAFT-' || project_id || '-' || prior_draft_id,
       'WORKSPACE_CAPABILITY_DRAFT',
       project_id || ':' || prior_draft_id,
       'NEEDS_ATTENTION',
       'Empty legacy Child placeholders were removed in a new Draft revision; remaining model and capability references require explicit F006 review',
       jsonb_build_object(
         'workspaceId', project_id,
         'priorDraftId', prior_draft_id,
         'normalizedDraftId', normalized_draft_id,
         'removedEmptyChildSlots', jsonb_array_length(COALESCE(prior_payload->'childAgentSlots', '[]'::jsonb)) - jsonb_array_length(normalized_children)
       )
FROM f006_legacy_draft_normalization
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT 'WORKSPACE_CAPABILITY_DRAFT',
       project_id || ':' || prior_draft_id,
       'F006-LEGACY-DRAFT-' || project_id || '-' || prior_draft_id,
       'WORKSPACE_CAPABILITY_DRAFT',
       normalized_draft_id
FROM f006_legacy_draft_normalization
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT
  'GLOBAL_MODEL_PROFILE_REVISION',
  r.revision_id,
  'F006-LEGACY-MODEL-' || r.revision_id,
  'GLOBAL_MODEL_PROFILE_REVISION',
  r.revision_id
FROM global_model_profile_revision r
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT
  'F006-LEGACY-DRAFT-' || r.project_id || '-' || r.id,
  'WORKSPACE_CAPABILITY_DRAFT',
  r.project_id || ':' || r.id,
  'NEEDS_ATTENTION',
  'Legacy Workspace Draft requires explicit F006 roster and capability review',
  jsonb_build_object('workspaceId', r.project_id, 'draftId', r.id, 'revision', r.record_payload ->> 'revision')
FROM understanding_record r
WHERE r.record_type = 'WORKSPACE_CAPABILITY_DRAFT'
  AND r.id NOT LIKE 'F006-DRAFT-NORMALIZED-%'
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT
  'WORKSPACE_CAPABILITY_DRAFT',
  r.project_id || ':' || r.id,
  'F006-LEGACY-DRAFT-' || r.project_id || '-' || r.id,
  'WORKSPACE_CAPABILITY_DRAFT',
  r.id
FROM understanding_record r
WHERE r.record_type = 'WORKSPACE_CAPABILITY_DRAFT'
  AND r.id NOT LIKE 'F006-DRAFT-NORMALIZED-%'
ON CONFLICT (source_kind, source_id) DO NOTHING;

-- Older template/config records never create implicit Agent grants. Retain their
-- provenance as a repair queue instead of silently interpreting old overlays.
INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT 'F006-LEGACY-TEMPLATE-' || template.id,
       'CAPABILITY_TEMPLATE_REVISION',
       template.id,
       'NEEDS_ATTENTION',
       'Legacy template requires lifecycle and explicit Workspace-grant review; no F006 Agent grant was created',
       jsonb_build_object('kind', template.kind, 'logicalName', template.logical_name, 'revision', template.revision)
FROM capability_template_revision template
WHERE template.kind IN ('SKILL', 'MCP')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT 'CAPABILITY_TEMPLATE_REVISION',
       template.id,
       'F006-LEGACY-TEMPLATE-' || template.id,
       'CAPABILITY_TEMPLATE_REVISION',
       template.id
FROM capability_template_revision template
WHERE template.kind IN ('SKILL', 'MCP')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT 'F006-LEGACY-CONFIG-' || record.project_id || '-' || record.id,
       'WORKSPACE_CAPABILITY_CONFIG',
       record.project_id || ':' || record.id,
       'NEEDS_ATTENTION',
       'Legacy capability-config overlay requires explicit Draft reconstruction; no implicit F006 grant was created',
       jsonb_build_object('workspaceId', record.project_id, 'configId', record.id)
FROM understanding_record record
WHERE record.record_type = 'WORKSPACE_CAPABILITY_CONFIG'
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT 'WORKSPACE_CAPABILITY_CONFIG',
       record.project_id || ':' || record.id,
       'F006-LEGACY-CONFIG-' || record.project_id || '-' || record.id,
       'WORKSPACE_CAPABILITY_CONFIG',
       record.id
FROM understanding_record record
WHERE record.record_type = 'WORKSPACE_CAPABILITY_CONFIG'
ON CONFLICT (source_kind, source_id) DO NOTHING;

-- Historical active Runs remain pinned to their original execution input. The
-- receipt is an audit marker, not a mutation of a running or paused job.
INSERT INTO f006_legacy_settings_migration_receipt (
  id, source_kind, source_id, outcome, reason, payload
)
SELECT 'F006-LEGACY-RUN-' || record.project_id || '-' || record.id,
       'WORKSPACE_ANALYSIS_JOB',
       record.project_id || ':' || record.id,
       'NEEDS_ATTENTION',
       'Historical active Run remains pinned and must not be migrated in place',
       jsonb_build_object('workspaceId', record.project_id, 'runId', record.id, 'status', COALESCE(record.record_payload->>'status', record.status))
FROM understanding_record record
WHERE record.record_type = 'WORKSPACE_ANALYSIS_JOB'
  AND COALESCE(record.record_payload->>'status', record.status) IN ('RUNNING', 'PAUSED')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO f006_legacy_settings_source_mapping (
  source_kind, source_id, receipt_id, target_kind, target_id
)
SELECT 'WORKSPACE_ANALYSIS_JOB',
       record.project_id || ':' || record.id,
       'F006-LEGACY-RUN-' || record.project_id || '-' || record.id,
       'WORKSPACE_ANALYSIS_JOB',
       record.id
FROM understanding_record record
WHERE record.record_type = 'WORKSPACE_ANALYSIS_JOB'
  AND COALESCE(record.record_payload->>'status', record.status) IN ('RUNNING', 'PAUSED')
ON CONFLICT (source_kind, source_id) DO NOTHING;
