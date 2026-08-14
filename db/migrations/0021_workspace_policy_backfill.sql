CREATE TEMP TABLE f006_workspace_policy_backfill ON COMMIT DROP AS
WITH current_draft AS (
  SELECT head.project_id,
         head.version AS head_version,
         draft.id AS prior_draft_id,
         draft.record_payload AS prior_payload,
         NOT EXISTS (
           SELECT 1 FROM understanding_record policy
           WHERE policy.project_id = head.project_id
             AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
             AND policy.id = draft.record_payload->>'dependencyPolicyRevisionId'
             AND policy.record_payload->>'kind' = 'DEPENDENCY'
         ) AS dependency_missing,
         NOT EXISTS (
           SELECT 1 FROM understanding_record policy
           WHERE policy.project_id = head.project_id
             AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
             AND policy.id = draft.record_payload->>'conventionRevisionId'
             AND policy.record_payload->>'kind' = 'CONVENTION'
         ) AS convention_missing,
         NOT EXISTS (
           SELECT 1 FROM understanding_record policy
           WHERE policy.project_id = head.project_id
             AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
             AND policy.id = draft.record_payload->>'securityPolicyRevisionId'
             AND policy.record_payload->>'kind' = 'SECURITY'
         ) AS security_missing
  FROM workspace_capability_head head
  JOIN understanding_record draft
    ON draft.project_id = head.project_id
   AND draft.record_type = 'WORKSPACE_CAPABILITY_DRAFT'
   AND draft.id = head.record_id
  WHERE head.head_key = 'WORKSPACE_CAPABILITY_DRAFT'
)
SELECT current_draft.*,
       'F006-DRAFT-BACKFILL-' || md5(project_id || ':' || prior_draft_id) AS backfilled_draft_id,
       head_version + 1 AS backfilled_draft_revision,
       CASE WHEN dependency_missing
         THEN 'F006-POLICY-BACKFILL-' || md5(project_id || ':' || prior_draft_id || ':DEPENDENCY')
         ELSE prior_payload->>'dependencyPolicyRevisionId' END AS dependency_policy_id,
       CASE WHEN convention_missing
         THEN 'F006-POLICY-BACKFILL-' || md5(project_id || ':' || prior_draft_id || ':CONVENTION')
         ELSE prior_payload->>'conventionRevisionId' END AS convention_policy_id,
       CASE WHEN security_missing
         THEN 'F006-POLICY-BACKFILL-' || md5(project_id || ':' || prior_draft_id || ':SECURITY')
         ELSE prior_payload->>'securityPolicyRevisionId' END AS security_policy_id,
       COALESCE((SELECT max((policy.record_payload->>'revision')::integer)
                 FROM understanding_record policy
                 WHERE policy.project_id = current_draft.project_id
                   AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
                   AND policy.record_payload->>'kind' = 'DEPENDENCY'), 0) + 1 AS dependency_revision,
       COALESCE((SELECT max((policy.record_payload->>'revision')::integer)
                 FROM understanding_record policy
                 WHERE policy.project_id = current_draft.project_id
                   AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
                   AND policy.record_payload->>'kind' = 'CONVENTION'), 0) + 1 AS convention_revision,
       COALESCE((SELECT max((policy.record_payload->>'revision')::integer)
                 FROM understanding_record policy
                 WHERE policy.project_id = current_draft.project_id
                   AND policy.record_type = 'WORKSPACE_POLICY_REVISION'
                   AND policy.record_payload->>'kind' = 'SECURITY'), 0) + 1 AS security_revision
FROM current_draft
WHERE dependency_missing OR convention_missing OR security_missing;

INSERT INTO understanding_record (
  project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
)
SELECT backfill.project_id,
       'WORKSPACE_POLICY_REVISION',
       policy.id,
       NULL,
       NULL,
       NULL,
       jsonb_build_object(
         'id', policy.id,
         'workspaceId', backfill.project_id,
         'kind', policy.kind,
         'revision', policy.revision,
         'content', policy.content,
         'contentDigest', 'F006-BACKFILL-' || md5(policy.kind || ':' || policy.content::text),
         'createdAt', current_timestamp
       ),
       current_timestamp
FROM f006_workspace_policy_backfill backfill
CROSS JOIN LATERAL (
  VALUES
    ('DEPENDENCY', backfill.dependency_policy_id, backfill.dependency_revision, COALESCE(backfill.prior_payload->'dependencies', '{}'::jsonb), backfill.dependency_missing),
    ('CONVENTION', backfill.convention_policy_id, backfill.convention_revision, COALESCE(backfill.prior_payload->'conventions', '{}'::jsonb), backfill.convention_missing),
    ('SECURITY', backfill.security_policy_id, backfill.security_revision, COALESCE(backfill.prior_payload->'securityPolicy', '{}'::jsonb), backfill.security_missing)
) AS policy(kind, id, revision, content, missing)
WHERE policy.missing;

INSERT INTO workspace_capability_head (project_id, head_key, version, record_id)
SELECT backfill.project_id,
       'WORKSPACE_POLICY_REVISION:' || policy.kind,
       policy.revision,
       policy.id
FROM f006_workspace_policy_backfill backfill
CROSS JOIN LATERAL (
  VALUES
    ('DEPENDENCY', backfill.dependency_policy_id, backfill.dependency_revision, backfill.dependency_missing),
    ('CONVENTION', backfill.convention_policy_id, backfill.convention_revision, backfill.convention_missing),
    ('SECURITY', backfill.security_policy_id, backfill.security_revision, backfill.security_missing)
) AS policy(kind, id, revision, missing)
WHERE policy.missing
ON CONFLICT (project_id, head_key) DO UPDATE
SET version = EXCLUDED.version,
    record_id = EXCLUDED.record_id;

INSERT INTO understanding_record (
  project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
)
SELECT project_id,
       'WORKSPACE_CAPABILITY_DRAFT',
       backfilled_draft_id,
       NULL,
       NULL,
       NULL,
       prior_payload || jsonb_build_object(
         'id', backfilled_draft_id,
         'revision', backfilled_draft_revision,
         'dependencyPolicyRevisionId', dependency_policy_id,
         'conventionRevisionId', convention_policy_id,
         'securityPolicyRevisionId', security_policy_id,
         'createdAt', current_timestamp
       ),
       current_timestamp
FROM f006_workspace_policy_backfill;

UPDATE workspace_capability_head head
SET version = backfill.backfilled_draft_revision,
    record_id = backfill.backfilled_draft_id
FROM f006_workspace_policy_backfill backfill
WHERE head.project_id = backfill.project_id
  AND head.head_key = 'WORKSPACE_CAPABILITY_DRAFT'
  AND head.version = backfill.head_version
  AND head.record_id = backfill.prior_draft_id;
