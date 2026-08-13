import { createHash } from "node:crypto";

import { assertEvaluationPublicationReady, canonicalJson, contentId, deepFreeze } from "../../domain/index.js";
import { TraceabilityStore } from "../traceability-store.js";
import { PersistenceConflictError } from "../errors.js";

const componentTypes = Object.freeze({
  source: "SOURCE",
  build: "BUILD",
  deployment: "DEPLOYMENT",
  runtime: "RUNTIME",
});

function requireId(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function isoOrNull(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function recordIdentity(record) {
  const { createdAt: _createdAt, ...identity } = record;
  return identity;
}

function manifestContentHash(manifest) {
  return createHash("sha256")
    .update(
      canonicalJson({
        components: manifest.components,
        failedSources: manifest.failedSources,
        missingComponents: manifest.missingComponents,
        observedFrom: manifest.observedFrom,
        observedTo: manifest.observedTo,
      }),
    )
    .digest("hex");
}

function normalizePersistenceError(error) {
  if (error instanceof PersistenceConflictError) return error;
  if (typeof error?.code === "string" && error.code.startsWith("23")) {
    return new PersistenceConflictError("Persistence constraints rejected the append operation", { cause: error });
  }
  return error;
}

function testSpecPayload(testSpec) {
  const { id: _id, version: _version, name: _name, approved: _approved, createdAt: _createdAt, ...payload } =
    testSpec;
  return payload;
}

function testSpecFromRow(row) {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    approved: row.approved,
    ...row.specification,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function executionFromRow(row) {
  return {
    id: row.id,
    testSpecId: row.test_spec_id,
    testSpecVersion: row.test_spec_version,
    snapshotManifestId: row.snapshot_manifest_id,
    deploymentId: row.deployment_component_id,
    runner: { id: row.runner_id, version: row.runner_version },
    completionReason: row.completion_reason,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: new Date(row.finished_at).toISOString(),
    attempts: row.attempts,
  };
}

function evidenceFromRow(row) {
  return {
    id: row.id,
    executionId: row.execution_id,
    type: row.evidence_type,
    integrity: row.integrity_status,
    freshness: row.freshness_status,
    contentHash: row.content_hash,
    storageUri: row.storage_uri,
    manifest: row.manifest,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function reverseSkillRegistrationFromRow(row) {
  return {
    id: row.registration_id,
    manifest: row.manifest,
    status: row.supply_status,
    attestation: row.publisher_attestation,
    registeredAt: new Date(row.registered_at).toISOString(),
  };
}

export class PostgresTraceabilityStore extends TraceabilityStore {
  #database;

  constructor(database) {
    super();
    if (typeof database?.exec !== "function" || typeof database?.query !== "function") {
      throw new TypeError("database must provide exec(sql) and query(sql, params?) methods");
    }
    this.#database = database;
  }

  async #transaction(work) {
    await this.#database.exec("BEGIN");
    try {
      const result = await work();
      await this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      await this.#database.exec("ROLLBACK");
      throw normalizePersistenceError(error);
    }
  }

  async appendProjectFoundation(foundation) {
    return this.#transaction(async () => {
      await this.#database.query(
        "INSERT INTO organization (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [foundation.organization.id, foundation.organization.name],
      );
      await this.#database.query(
        `INSERT INTO tenant (id, organization_id, name)
         VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [foundation.tenant.id, foundation.organization.id, foundation.tenant.name],
      );
      await this.#database.query(
        `INSERT INTO project (id, tenant_id, name, status)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [foundation.project.id, foundation.tenant.id, foundation.project.name, foundation.project.status],
      );
      for (const principal of foundation.principals) {
        await this.#database.query(
          `INSERT INTO principal (id, tenant_id, principal_type, display_name)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [principal.id, foundation.tenant.id, principal.type, principal.displayName],
        );
      }
      const stored = await this.getProjectFoundation(foundation.project.id);
      if (!stored || canonicalJson(stored) !== canonicalJson(foundation)) {
        throw new PersistenceConflictError(`Project ${foundation.project.id} conflicts with an existing record`);
      }
      return stored;
    });
  }

  async getProjectFoundation(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT
         o.id AS organization_id, o.name AS organization_name,
         t.id AS tenant_id, t.name AS tenant_name,
         p.id AS project_id, p.name AS project_name, p.status AS project_status
       FROM project p
       JOIN tenant t ON t.id = p.tenant_id
       JOIN organization o ON o.id = t.organization_id
       WHERE p.id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const principalResult = await this.#database.query(
      `SELECT id, principal_type, display_name
       FROM principal WHERE tenant_id = $1 ORDER BY id`,
      [row.tenant_id],
    );
    return deepFreeze({
      organization: { id: row.organization_id, name: row.organization_name },
      tenant: { id: row.tenant_id, name: row.tenant_name, organizationId: row.organization_id },
      project: {
        id: row.project_id,
        name: row.project_name,
        tenantId: row.tenant_id,
        status: row.project_status,
      },
      principals: principalResult.rows.map((principal) => ({
        id: principal.id,
        type: principal.principal_type,
        displayName: principal.display_name,
      })),
    });
  }

  async listProjectFoundations() {
    const result = await this.#database.query("SELECT id FROM project ORDER BY name, id");
    const foundations = [];
    for (const row of result.rows) foundations.push(await this.getProjectFoundation(row.id));
    return deepFreeze(foundations);
  }

  async appendCapabilityTemplateRevision(template) {
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO capability_template_revision (kind, logical_name, revision, id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (kind, logical_name, revision) DO NOTHING`,
        [template.kind, template.logicalName, template.revision, template.id, JSON.stringify(template), template.createdAt],
      );
      const result = await this.#database.query(
        `SELECT payload FROM capability_template_revision
         WHERE kind = $1 AND logical_name = $2 AND revision = $3`,
        [template.kind, template.logicalName, template.revision],
      );
      const stored = result.rows[0]?.payload;
      if (!stored || canonicalJson(stored) !== canonicalJson(template)) {
        throw new PersistenceConflictError(`Capability template ${template.logicalName} revision ${template.revision} conflicts`);
      }
      return deepFreeze(stored);
    });
  }

  async listCapabilityTemplateRevisions() {
    const result = await this.#database.query(
      `SELECT payload FROM capability_template_revision
       ORDER BY kind, logical_name, revision DESC`,
    );
    return deepFreeze(result.rows.map(({ payload }) => payload));
  }

  async appendSnapshotManifest(projectId, manifest) {
    requireId(projectId, "projectId");
    requireId(manifest?.id, "manifest.id");

    return this.#transaction(async () => {
      for (const [componentName, componentType] of Object.entries(componentTypes)) {
        const component = manifest.components?.[componentName];
        if (!component) continue;
        await this.#database.query(
          `INSERT INTO snapshot_component (project_id, id, component_type, digest, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (project_id, id) DO NOTHING`,
          [projectId, component.id, componentType, component.digest, JSON.stringify(component)],
        );
        const storedComponent = await this.#database.query(
          `SELECT component_type, digest, payload
           FROM snapshot_component
           WHERE project_id = $1 AND id = $2`,
          [projectId, component.id],
        );
        const componentRow = storedComponent.rows[0];
        if (
          !componentRow ||
          componentRow.component_type !== componentType ||
          componentRow.digest !== component.digest ||
          canonicalJson(componentRow.payload) !== canonicalJson(component)
        ) {
          throw new PersistenceConflictError(`Snapshot component ${component.id} conflicts with an existing immutable record`);
        }
      }

      await this.#database.query(
        `INSERT INTO snapshot_manifest (
           project_id, id, observed_from, observed_to, complete, failed_sources,
           missing_components, content_hash, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          manifest.id,
          manifest.observedFrom,
          manifest.observedTo,
          manifest.complete,
          JSON.stringify(manifest.failedSources ?? []),
          JSON.stringify(manifest.missingComponents ?? []),
          manifestContentHash(manifest),
          manifest.createdAt,
        ],
      );

      for (const [componentName, componentType] of Object.entries(componentTypes)) {
        const component = manifest.components?.[componentName];
        if (!component) continue;
        await this.#database.query(
          `INSERT INTO snapshot_manifest_component (
             project_id, manifest_id, component_id, component_type
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, manifest_id, component_type) DO NOTHING`,
          [projectId, manifest.id, component.id, componentType],
        );
      }

      const stored = await this.#database.query(
        `SELECT id, content_hash, complete
         FROM snapshot_manifest
         WHERE project_id = $1 AND id = $2`,
        [projectId, manifest.id],
      );
      const row = stored.rows[0];
      if (!row || row.content_hash !== manifestContentHash(manifest) || row.complete !== manifest.complete) {
        throw new PersistenceConflictError(`Snapshot manifest ${manifest.id} conflicts with an existing immutable record`);
      }
      return manifest.id;
    });
  }

  async getSnapshotManifest(projectId, snapshotManifestId) {
    requireId(projectId, "projectId");
    requireId(snapshotManifestId, "snapshotManifestId");
    const manifestResult = await this.#database.query(
      `SELECT * FROM snapshot_manifest WHERE project_id = $1 AND id = $2`,
      [projectId, snapshotManifestId],
    );
    const row = manifestResult.rows[0];
    if (!row) return null;
    const componentResult = await this.#database.query(
      `SELECT smc.component_type, sc.id AS component_id, sc.digest, sc.payload
       FROM snapshot_manifest_component smc
       JOIN snapshot_component sc
         ON sc.project_id = smc.project_id
        AND sc.id = smc.component_id
        AND sc.component_type = smc.component_type
       WHERE smc.project_id = $1 AND smc.manifest_id = $2`,
      [projectId, snapshotManifestId],
    );
    const components = {};
    for (const componentRow of componentResult.rows) {
      const name = Object.entries(componentTypes).find(([, type]) => type === componentRow.component_type)?.[0];
      if (name) {
        components[name] = {
          ...componentRow.payload,
          id: componentRow.component_id,
          digest: componentRow.digest,
        };
      }
    }
    return deepFreeze({
      id: row.id,
      components,
      failedSources: row.failed_sources,
      observedFrom: new Date(row.observed_from).toISOString(),
      observedTo: new Date(row.observed_to).toISOString(),
      complete: row.complete,
      missingComponents: row.missing_components,
      createdAt: new Date(row.created_at).toISOString(),
    });
  }

  async listSnapshotManifests(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT id
       FROM snapshot_manifest
       WHERE project_id = $1
       ORDER BY created_at DESC, id`,
      [projectId],
    );
    return deepFreeze(await Promise.all(result.rows.map((row) => this.getSnapshotManifest(projectId, row.id))));
  }

  async getPlatformOperationObservations(projectId) {
    requireId(projectId, "projectId");
    const [runs, jobEvents, bundles, executions, evidence, lifecycleEvents, impacts] = await Promise.all([
      this.#database.query("SELECT run_payload FROM reverse_run WHERE project_id = $1 ORDER BY created_at, id", [projectId]),
      this.#database.query(
        `SELECT j.id, e.status, e.append_sequence
         FROM reverse_run_job j
         LEFT JOIN reverse_run_job_event e ON e.project_id = j.project_id AND e.job_id = j.id
         WHERE j.project_id = $1 ORDER BY j.id, e.append_sequence`, [projectId],
      ),
      this.#database.query(
        `SELECT fb.extractor_id, fb.extractor_version, fb.complete,
           (SELECT count(*) FROM fact_node fn WHERE fn.project_id = fb.project_id AND fn.bundle_id = fb.id) AS node_count,
           (SELECT count(*) FROM fact_edge fe WHERE fe.project_id = fb.project_id AND fe.bundle_id = fb.id) AS edge_count
         FROM fact_bundle fb WHERE fb.project_id = $1 ORDER BY fb.observed_at, fb.id`, [projectId],
      ),
      this.#database.query(
        `SELECT test_spec_id, test_spec_version, status, started_at, finished_at, attempts
         FROM test_execution WHERE project_id = $1 ORDER BY started_at, id`, [projectId],
      ),
      this.#database.query(
        `SELECT evidence_type, integrity_status, freshness_status, storage_uri
         FROM evidence WHERE project_id = $1 ORDER BY created_at, id`, [projectId],
      ),
      this.#database.query(
        `SELECT action FROM evidence_lifecycle_event WHERE project_id = $1 ORDER BY append_sequence`, [projectId],
      ),
      this.#database.query(
        `SELECT cs.created_at AS change_set_created_at, ia.created_at AS impact_created_at,
                cs.changes, ia.impact_payload
         FROM change_set cs JOIN impact_assessment ia
           ON ia.project_id = cs.project_id AND ia.change_set_id = cs.id
         WHERE cs.project_id = $1 ORDER BY cs.created_at, cs.id`, [projectId],
      ),
    ]);
    const jobs = new Map();
    for (const row of jobEvents.rows) jobs.set(row.id, { id: row.id, status: row.status ?? "QUEUED" });
    return deepFreeze({
      reverseRuns: runs.rows.map((row) => row.run_payload),
      reverseJobs: [...jobs.values()],
      factBundles: bundles.rows.map((row) => ({
        extractorId: row.extractor_id, extractorVersion: row.extractor_version, complete: row.complete,
        nodeCount: Number(row.node_count), edgeCount: Number(row.edge_count),
      })),
      testExecutions: executions.rows.map((row) => ({
        testSpecId: row.test_spec_id, testSpecVersion: row.test_spec_version, status: row.status,
        startedAt: new Date(row.started_at).toISOString(), finishedAt: isoOrNull(row.finished_at), attempts: row.attempts,
      })),
      evidence: evidence.rows.map((row) => ({
        type: row.evidence_type, integrity: row.integrity_status, freshness: row.freshness_status, storageUri: row.storage_uri,
      })),
      evidenceLifecycleEvents: lifecycleEvents.rows.map((row) => ({ action: row.action })),
      changeImpacts: impacts.rows.map((row) => ({
        changeSetCreatedAt: new Date(row.change_set_created_at).toISOString(),
        impactCreatedAt: new Date(row.impact_created_at).toISOString(),
        changedFactCount: row.changes.length,
        affectedFeatureCount: row.impact_payload.affectedFeatureIds.length,
        regressionSelectionCount: row.impact_payload.affectedTestSpecIds.length,
      })),
    });
  }

  async appendTraceChainRevision(projectId, chain, options = {}) {
    requireId(projectId, "projectId");
    requireId(chain?.id, "chain.id");
    const scopeVersion = options.scopeVersion ?? 1;
    if (!Number.isInteger(scopeVersion) || scopeVersion < 1) {
      throw new TypeError("options.scopeVersion must be a positive integer");
    }

    return this.#transaction(async () => {
      await this.#database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${projectId}:${chain.id}`]);
      const revisionResult = await this.#database.query(
        `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
         FROM trace_chain_revision
         WHERE project_id = $1 AND chain_id = $2`,
        [projectId, chain.id],
      );
      const revision = Number(revisionResult.rows[0].revision);

      await this.#database.query(
        `INSERT INTO trace_chain_revision (
           project_id, chain_id, revision, feature_id, claim_id, claim_version,
           scope_id, scope_version, snapshot_manifest_id, deployment_component_id,
           dimensions, stages, segments, conflicts, complete, computed_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
         )`,
        [
          projectId,
          chain.id,
          revision,
          chain.featureId,
          chain.claimId,
          chain.claimVersion,
          chain.scopeId,
          scopeVersion,
          chain.snapshotManifestId,
          chain.deploymentId,
          JSON.stringify(chain.dimensions),
          JSON.stringify(chain.stages),
          JSON.stringify(chain.segments),
          JSON.stringify(chain.conflicts),
          chain.complete,
          chain.computedAt,
        ],
      );

      for (const [ordinal, traceGap] of chain.gaps.entries()) {
        await this.#database.query(
          `INSERT INTO trace_gap (
             project_id, chain_id, chain_revision, ordinal, gap_type, severity, owner_role, message
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            projectId,
            chain.id,
            revision,
            ordinal,
            traceGap.type,
            traceGap.severity,
            traceGap.ownerRole,
            traceGap.message,
          ],
        );
      }

      return Object.freeze({ chainId: chain.id, revision });
    });
  }

  async getCurrentTraceChain(projectId, chainId) {
    requireId(projectId, "projectId");
    requireId(chainId, "chainId");

    const chainResult = await this.#database.query(
      `SELECT *
       FROM trace_chain_current
       WHERE project_id = $1 AND chain_id = $2`,
      [projectId, chainId],
    );
    const row = chainResult.rows[0];
    if (!row) return null;

    const gapResult = await this.#database.query(
      `SELECT gap_type, severity, owner_role, message
       FROM trace_gap
       WHERE project_id = $1 AND chain_id = $2 AND chain_revision = $3
       ORDER BY ordinal`,
      [projectId, chainId, row.revision],
    );

    return deepFreeze({
      id: row.chain_id,
      revision: Number(row.revision),
      featureId: row.feature_id,
      claimId: row.claim_id,
      claimVersion: row.claim_version,
      scopeId: row.scope_id,
      scopeVersion: row.scope_version,
      snapshotManifestId: row.snapshot_manifest_id,
      deploymentId: row.deployment_component_id,
      dimensions: row.dimensions,
      stages: row.stages,
      segments: row.segments,
      conflicts: row.conflicts,
      complete: row.complete,
      gaps: gapResult.rows.map((gapRow) =>
          ({
            type: gapRow.gap_type,
            severity: gapRow.severity,
            ownerRole: gapRow.owner_role,
            message: gapRow.message,
          }),
        ),
      computedAt: new Date(row.computed_at).toISOString(),
    });
  }

  async listCurrentTraceChains(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT chain_id FROM trace_chain_current WHERE project_id = $1 ORDER BY chain_id`,
      [projectId],
    );
    return Promise.all(result.rows.map(({ chain_id: chainId }) => this.getCurrentTraceChain(projectId, chainId)));
  }

  async appendFeatureVersion(projectId, feature) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO feature (project_id, id) VALUES ($1, $2)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [projectId, feature.id],
      );
      await this.#database.query(
        `INSERT INTO feature_version (
           project_id, feature_id, version, name, business_domain, description, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (project_id, feature_id, version) DO NOTHING`,
        [
          projectId,
          feature.id,
          feature.version,
          feature.name,
          feature.businessDomain,
          feature.description,
          feature.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT name, business_domain, description
         FROM feature_version
         WHERE project_id = $1 AND feature_id = $2 AND version = $3`,
        [projectId, feature.id, feature.version],
      );
      const row = stored.rows[0];
      if (
        !row ||
        row.name !== feature.name ||
        row.business_domain !== feature.businessDomain ||
        row.description !== feature.description
      ) {
        throw new PersistenceConflictError(`Feature ${feature.id} version ${feature.version} conflicts with an existing record`);
      }
      return feature;
    });
  }

  async appendClaimScope(projectId, scope) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO claim_scope (
           project_id, id, version, scope, effective_from, effective_to, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         ON CONFLICT (project_id, id, version) DO NOTHING`,
        [
          projectId,
          scope.id,
          scope.version,
          JSON.stringify(scope.scope),
          scope.effectiveFrom,
          scope.effectiveTo,
          scope.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT scope, effective_from, effective_to
         FROM claim_scope
         WHERE project_id = $1 AND id = $2 AND version = $3`,
        [projectId, scope.id, scope.version],
      );
      const row = stored.rows[0];
      if (
        !row ||
        canonicalJson(row.scope) !== canonicalJson(scope.scope) ||
        isoOrNull(row.effective_from) !== scope.effectiveFrom ||
        isoOrNull(row.effective_to) !== scope.effectiveTo
      ) {
        throw new PersistenceConflictError(`ClaimScope ${scope.id} version ${scope.version} conflicts with an existing record`);
      }
      return scope;
    });
  }

  async appendClaim(projectId, claim) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO claim (
           project_id, id, version, feature_id, claim_type, statement, source_type,
           evidence_support, scope_id, scope_version, provenance, constraint_payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
         ON CONFLICT (project_id, id, version) DO NOTHING`,
        [
          projectId,
          claim.id,
          claim.version,
          claim.featureId,
          claim.type,
          claim.statement,
          claim.sourceType,
          claim.evidenceSupport,
          claim.scopeId,
          claim.scopeVersion,
          JSON.stringify(claim.provenance),
          claim.constraint === null ? null : JSON.stringify(claim.constraint),
          claim.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT feature_id, claim_type, statement, source_type, evidence_support,
                scope_id, scope_version, provenance, constraint_payload
         FROM claim
         WHERE project_id = $1 AND id = $2 AND version = $3`,
        [projectId, claim.id, claim.version],
      );
      const row = stored.rows[0];
      if (
        !row ||
        row.feature_id !== claim.featureId ||
        row.claim_type !== claim.type ||
        row.statement !== claim.statement ||
        row.source_type !== claim.sourceType ||
        row.evidence_support !== claim.evidenceSupport ||
        row.scope_id !== claim.scopeId ||
        row.scope_version !== claim.scopeVersion ||
        canonicalJson(row.provenance) !== canonicalJson(claim.provenance) ||
        canonicalJson(row.constraint_payload) !== canonicalJson(claim.constraint)
      ) {
        throw new PersistenceConflictError(`Claim ${claim.id} version ${claim.version} conflicts with an existing record`);
      }
      return claim;
    });
  }

  async appendDecision(projectId, decision) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO human_decision (
           project_id, id, claim_id, claim_version, scope_id, scope_version,
           decision_type, content, actor_id, actor_role, evidence_refs, valid_until, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          decision.id,
          decision.claimId,
          decision.claimVersion,
          decision.scopeId,
          decision.scopeVersion,
          decision.type,
          decision.content,
          decision.actorId,
          decision.actorRole,
          JSON.stringify(decision.evidenceRefs),
          decision.validUntil,
          decision.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT claim_id, claim_version, scope_id, scope_version, decision_type,
                content, actor_id, actor_role, evidence_refs, valid_until
         FROM human_decision
         WHERE project_id = $1 AND id = $2`,
        [projectId, decision.id],
      );
      const row = stored.rows[0];
      if (
        !row ||
        row.claim_id !== decision.claimId ||
        row.claim_version !== decision.claimVersion ||
        row.scope_id !== decision.scopeId ||
        row.scope_version !== decision.scopeVersion ||
        row.decision_type !== decision.type ||
        row.content !== decision.content ||
        row.actor_id !== decision.actorId ||
        row.actor_role !== decision.actorRole ||
        canonicalJson(row.evidence_refs) !== canonicalJson(decision.evidenceRefs) ||
        isoOrNull(row.valid_until) !== decision.validUntil
      ) {
        throw new PersistenceConflictError(`Decision ${decision.id} conflicts with an existing record`);
      }
      return decision;
    });
  }

  async appendBusinessProcessModel(projectId, processModel) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO business_process_model (
           project_id, id, version, feature_id, feature_version, model_payload,
           authority_actor_id, authority_actor_role, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (project_id, id, version) DO NOTHING`,
        [
          projectId,
          processModel.id,
          processModel.version,
          processModel.featureId,
          processModel.featureVersion,
          JSON.stringify(processModel),
          processModel.authority.actorId,
          processModel.authority.actorRole,
          processModel.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT model_payload
         FROM business_process_model
         WHERE project_id = $1 AND id = $2 AND version = $3`,
        [projectId, processModel.id, processModel.version],
      );
      if (!stored.rows[0] || canonicalJson(stored.rows[0].model_payload) !== canonicalJson(processModel)) {
        throw new PersistenceConflictError(
          `BusinessProcessModel ${processModel.id} version ${processModel.version} conflicts with an existing record`,
        );
      }
      return processModel;
    });
  }

  async getLatestBusinessProcessModel(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    const result = await this.#database.query(
      `SELECT model_payload
       FROM business_process_model
       WHERE project_id = $1 AND feature_id = $2
       ORDER BY version DESC, created_at DESC
       LIMIT 1`,
      [projectId, featureId],
    );
    return result.rows[0]?.model_payload ?? null;
  }

  async appendDecisionReviewCase(projectId, reviewCase) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO decision_review_case (
           project_id, id, claim_id, claim_version, scope_id, scope_version, risk,
           approval_mode, proposed_decision_id, case_payload, proposer_id, proposer_role,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          reviewCase.id,
          reviewCase.claimId,
          reviewCase.claimVersion,
          reviewCase.scopeId,
          reviewCase.scopeVersion,
          reviewCase.risk,
          reviewCase.approvalMode,
          reviewCase.proposedDecision.id,
          JSON.stringify(reviewCase),
          reviewCase.proposerId,
          reviewCase.proposerRole,
          reviewCase.expiresAt,
          reviewCase.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT case_payload FROM decision_review_case WHERE project_id = $1 AND id = $2`,
        [projectId, reviewCase.id],
      );
      if (!stored.rows[0] || canonicalJson(stored.rows[0].case_payload) !== canonicalJson(reviewCase)) {
        throw new PersistenceConflictError(`DecisionReviewCase ${reviewCase.id} conflicts with an existing record`);
      }
      return this.getDecisionReviewCase(projectId, reviewCase.id);
    });
  }

  async getDecisionReviewCase(projectId, caseId) {
    requireId(projectId, "projectId");
    requireId(caseId, "caseId");
    const caseResult = await this.#database.query(
      `SELECT case_payload FROM decision_review_case WHERE project_id = $1 AND id = $2`,
      [projectId, caseId],
    );
    const reviewCase = caseResult.rows[0]?.case_payload;
    if (!reviewCase) return null;
    const eventResult = await this.#database.query(
      `SELECT event_payload
       FROM decision_review_event
       WHERE project_id = $1 AND case_id = $2
       ORDER BY append_sequence`,
      [projectId, caseId],
    );
    const decisionResult = await this.#database.query(
      `SELECT d.*
       FROM decision_review_materialization m
       JOIN decision_review_event re
         ON re.project_id = m.project_id AND re.case_id = m.case_id AND re.id = m.event_id
       JOIN human_decision d
         ON d.project_id = m.project_id AND d.id = m.decision_id
       WHERE m.project_id = $1 AND m.case_id = $2
       ORDER BY re.append_sequence`,
      [projectId, caseId],
    );
    const decisions = decisionResult.rows.map((row) => ({
      id: row.id,
      claimId: row.claim_id,
      claimVersion: row.claim_version,
      scopeId: row.scope_id,
      scopeVersion: row.scope_version,
      type: row.decision_type,
      content: row.content,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      evidenceRefs: row.evidence_refs,
      validUntil: isoOrNull(row.valid_until),
      createdAt: new Date(row.created_at).toISOString(),
    }));
    return deepFreeze({
      reviewCase,
      events: eventResult.rows.map((item) => item.event_payload),
      decisions,
      decision: decisions.at(-1) ?? null,
    });
  }

  async appendDecisionReviewEvent(projectId, { event, decision = null }) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO decision_review_event (
           project_id, case_id, id, action, actor_id, actor_role, rationale, event_payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (project_id, case_id, id) DO NOTHING`,
        [
          projectId,
          event.caseId,
          event.id,
          event.action,
          event.actorId,
          event.actorRole,
          event.rationale,
          JSON.stringify(event),
          event.createdAt,
        ],
      );
      const storedEvent = await this.#database.query(
        `SELECT event_payload
         FROM decision_review_event
         WHERE project_id = $1 AND case_id = $2 AND id = $3`,
        [projectId, event.caseId, event.id],
      );
      if (!storedEvent.rows[0] || canonicalJson(storedEvent.rows[0].event_payload) !== canonicalJson(event)) {
        throw new PersistenceConflictError(`DecisionReviewEvent ${event.id} conflicts with an existing record`);
      }
      if (decision) {
        await this.#database.query(
          `INSERT INTO human_decision (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             decision_type, content, actor_id, actor_role, evidence_refs, valid_until, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
           ON CONFLICT (project_id, id) DO NOTHING`,
          [
            projectId,
            decision.id,
            decision.claimId,
            decision.claimVersion,
            decision.scopeId,
            decision.scopeVersion,
            decision.type,
            decision.content,
            decision.actorId,
            decision.actorRole,
            JSON.stringify(decision.evidenceRefs),
            decision.validUntil,
            decision.createdAt,
          ],
        );
        const storedDecision = await this.#database.query(
          `SELECT claim_id, claim_version, scope_id, scope_version, decision_type,
                  content, actor_id, actor_role, evidence_refs, valid_until
           FROM human_decision WHERE project_id = $1 AND id = $2`,
          [projectId, decision.id],
        );
        const row = storedDecision.rows[0];
        if (
          !row ||
          row.claim_id !== decision.claimId ||
          row.claim_version !== decision.claimVersion ||
          row.scope_id !== decision.scopeId ||
          row.scope_version !== decision.scopeVersion ||
          row.decision_type !== decision.type ||
          row.actor_id !== decision.actorId ||
          row.actor_role !== decision.actorRole ||
          canonicalJson(row.evidence_refs) !== canonicalJson(decision.evidenceRefs)
        ) {
          throw new PersistenceConflictError(`Decision ${decision.id} conflicts with an existing record`);
        }
        await this.#database.query(
          `INSERT INTO decision_review_materialization (
             project_id, case_id, event_id, decision_id, created_at
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, case_id, event_id) DO NOTHING`,
          [projectId, event.caseId, event.id, decision.id, event.createdAt],
        );
        const materialized = await this.#database.query(
          `SELECT decision_id
           FROM decision_review_materialization
           WHERE project_id = $1 AND case_id = $2 AND event_id = $3`,
          [projectId, event.caseId, event.id],
        );
        if (materialized.rows[0]?.decision_id !== decision.id) {
          throw new PersistenceConflictError(`Decision materialization for event ${event.id} conflicts`);
        }
      }
      return this.getDecisionReviewCase(projectId, event.caseId);
    });
  }

  async getFeatureBaseline(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    const featureResult = await this.#database.query(
      `SELECT feature_id, version, name, business_domain, description, created_at
       FROM feature_version
       WHERE project_id = $1 AND feature_id = $2
       ORDER BY version DESC`,
      [projectId, featureId],
    );
    const featureRow = featureResult.rows[0];
    if (!featureRow) return null;

    const claimResult = await this.#database.query(
      `SELECT DISTINCT ON (c.id)
         c.id, c.version, c.feature_id, c.claim_type, c.statement, c.source_type,
         c.evidence_support, c.scope_id, c.scope_version, c.provenance, c.constraint_payload, c.created_at,
         s.scope, s.effective_from, s.effective_to, s.created_at AS scope_created_at
       FROM claim c
       JOIN claim_scope s
         ON s.project_id = c.project_id AND s.id = c.scope_id AND s.version = c.scope_version
       WHERE c.project_id = $1 AND c.feature_id = $2
       ORDER BY c.id, c.version DESC`,
      [projectId, featureId],
    );
    const decisionResult = await this.#database.query(
      `SELECT d.*
       FROM human_decision d
       JOIN claim c
         ON c.project_id = d.project_id AND c.id = d.claim_id AND c.version = d.claim_version
       WHERE d.project_id = $1 AND c.feature_id = $2
       ORDER BY d.claim_id, d.claim_version, d.append_sequence`,
      [projectId, featureId],
    );
    const chainResult = await this.#database.query(
      `SELECT * FROM trace_chain_current
       WHERE project_id = $1 AND feature_id = $2
       ORDER BY computed_at DESC`,
      [projectId, featureId],
    );
    const testSpecResult = await this.#database.query(
      `SELECT DISTINCT ON (ts.id)
         ts.id, ts.version, ts.name, ts.approved, ts.specification, ts.created_at
       FROM test_spec ts
       JOIN test_spec_claim tsc
         ON tsc.project_id = ts.project_id
        AND tsc.test_spec_id = ts.id
        AND tsc.test_spec_version = ts.version
       JOIN claim c
         ON c.project_id = tsc.project_id
        AND c.id = tsc.claim_id
        AND c.version = tsc.claim_version
       WHERE ts.project_id = $1 AND c.feature_id = $2
       ORDER BY ts.id, ts.version DESC`,
      [projectId, featureId],
    );
    const testExecutionResult = await this.#database.query(
      `SELECT DISTINCT ON (te.test_spec_id)
         te.id, te.test_spec_id, te.test_spec_version, te.snapshot_manifest_id,
         te.deployment_component_id, te.status, te.runner_id, te.runner_version,
         te.finished_at,
         (SELECT COUNT(*)::integer
          FROM evidence e
          WHERE e.project_id = te.project_id AND e.execution_id = te.id) AS evidence_count
       FROM test_execution te
       JOIN test_spec ts
         ON ts.project_id = te.project_id
        AND ts.id = te.test_spec_id
        AND ts.version = te.test_spec_version
       WHERE te.project_id = $1
         AND ts.version = (
           SELECT MAX(latest.version)
           FROM test_spec latest
           WHERE latest.project_id = ts.project_id AND latest.id = ts.id
         )
         AND EXISTS (
           SELECT 1
           FROM test_spec_claim tsc
           JOIN claim c
             ON c.project_id = tsc.project_id
            AND c.id = tsc.claim_id
            AND c.version = tsc.claim_version
           WHERE tsc.project_id = ts.project_id
             AND tsc.test_spec_id = ts.id
             AND tsc.test_spec_version = ts.version
             AND c.feature_id = $2
         )
       ORDER BY te.test_spec_id, te.finished_at DESC, te.id`,
      [projectId, featureId],
    );
    const mappingResult = await this.#database.query(
      `SELECT im.*
       FROM implementation_mapping im
       JOIN claim c
         ON c.project_id = im.project_id
        AND c.id = im.claim_id
        AND c.version = im.claim_version
       WHERE im.project_id = $1 AND c.feature_id = $2
       ORDER BY im.created_at, im.id`,
      [projectId, featureId],
    );
    const conformanceResult = await this.#database.query(
      `SELECT ic.*
       FROM implementation_conformance ic
       JOIN claim c
         ON c.project_id = ic.project_id
        AND c.id = ic.claim_id
        AND c.version = ic.claim_version
       WHERE ic.project_id = $1 AND c.feature_id = $2
       ORDER BY ic.computed_at, ic.id`,
      [projectId, featureId],
    );
    const candidateReviewResult = await this.#database.query(
      `SELECT review_payload
       FROM reverse_candidate_review
       WHERE project_id = $1 AND feature_id = $2
       ORDER BY reviewed_at, id`,
      [projectId, featureId],
    );

    const decisionsByClaim = new Map();
    for (const row of decisionResult.rows) {
      const decisionKey = `${row.claim_id}\u0000${row.claim_version}`;
      const history = decisionsByClaim.get(decisionKey) ?? [];
      history.push({
        id: row.id,
        claimId: row.claim_id,
        claimVersion: row.claim_version,
        scopeId: row.scope_id,
        scopeVersion: row.scope_version,
        type: row.decision_type,
        content: row.content,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        evidenceRefs: row.evidence_refs,
        validUntil: isoOrNull(row.valid_until),
        createdAt: new Date(row.created_at).toISOString(),
      });
      decisionsByClaim.set(decisionKey, history);
    }

    return deepFreeze({
      feature: {
        id: featureRow.feature_id,
        version: featureRow.version,
        name: featureRow.name,
        businessDomain: featureRow.business_domain,
        description: featureRow.description,
        createdAt: new Date(featureRow.created_at).toISOString(),
      },
      featureHistory: [...featureResult.rows].reverse().map((row) => ({
        id: row.feature_id,
        version: row.version,
        name: row.name,
        businessDomain: row.business_domain,
        description: row.description,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      processModel: await this.getLatestBusinessProcessModel(projectId, featureId),
      claims: claimResult.rows.map((row) => {
        const decisionHistory = decisionsByClaim.get(`${row.id}\u0000${row.version}`) ?? [];
        return {
          claim: {
            id: row.id,
            version: row.version,
            featureId: row.feature_id,
            type: row.claim_type,
            statement: row.statement,
            sourceType: row.source_type,
            evidenceSupport: row.evidence_support,
            constraint: row.constraint_payload,
            scopeId: row.scope_id,
            scopeVersion: row.scope_version,
            provenance: row.provenance,
            createdAt: new Date(row.created_at).toISOString(),
          },
          scope: {
            id: row.scope_id,
            version: row.scope_version,
            scope: row.scope,
            effectiveFrom: isoOrNull(row.effective_from),
            effectiveTo: isoOrNull(row.effective_to),
            createdAt: new Date(row.scope_created_at).toISOString(),
          },
          decisionHistory,
          latestDecision: decisionHistory.at(-1) ?? null,
        };
      }),
      testSpecs: testSpecResult.rows.map(testSpecFromRow),
      testExecutions: testExecutionResult.rows.map((row) => ({
        id: row.id,
        testSpecId: row.test_spec_id,
        testSpecVersion: row.test_spec_version,
        snapshotManifestId: row.snapshot_manifest_id,
        deploymentId: row.deployment_component_id,
        status: row.status,
        runner: row.runner_id ? { id: row.runner_id, version: row.runner_version } : null,
        finishedAt: new Date(row.finished_at).toISOString(),
        evidenceCount: row.evidence_count,
      })),
      traceChains: chainResult.rows.map((row) => ({
        id: row.chain_id,
        revision: Number(row.revision),
        claimId: row.claim_id,
        claimVersion: row.claim_version,
        complete: row.complete,
        dimensions: row.dimensions,
        computedAt: new Date(row.computed_at).toISOString(),
      })),
      implementationMappings: mappingResult.rows.map((row) => ({
        id: row.id,
        claimId: row.claim_id,
        claimVersion: row.claim_version,
        scopeId: row.scope_id,
        scopeVersion: row.scope_version,
        snapshotManifestId: row.snapshot_manifest_id,
        sourceComponentId: row.source_component_id,
        sourceRunId: row.source_run_id,
        sourceCandidateId: row.source_candidate_id,
        status: row.mapping_status,
        factRefs: row.fact_refs,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      conformances: conformanceResult.rows.map((row) => ({
        id: row.id,
        claimId: row.claim_id,
        claimVersion: row.claim_version,
        scopeId: row.scope_id,
        scopeVersion: row.scope_version,
        snapshotManifestId: row.snapshot_manifest_id,
        mappingId: row.mapping_id,
        status: row.status,
        evidenceRefs: row.evidence_refs,
        analysisMethod: row.analysis_method,
        computedAt: new Date(row.computed_at).toISOString(),
      })),
      candidateReviews: candidateReviewResult.rows.map((row) => row.review_payload),
    });
  }

  async listFeatureIds(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT DISTINCT feature_id
       FROM feature_version
       WHERE project_id = $1
       ORDER BY feature_id`,
      [projectId],
    );
    return deepFreeze(result.rows.map((row) => row.feature_id));
  }

  async appendFeatureAlias(projectId, alias) {
    requireId(projectId, "projectId");
    await this.#database.query(
      `INSERT INTO feature_alias (
         project_id, feature_id, feature_version, alias, alias_key, actor_id, actor_role, rationale, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (project_id, alias_key) DO NOTHING`,
      [projectId, alias.featureId, alias.featureVersion, alias.alias, alias.aliasKey,
        alias.actorId, alias.actorRole, alias.rationale, alias.createdAt],
    );
    const result = await this.#database.query(
      `SELECT feature_id, feature_version, alias, alias_key, actor_id, actor_role, rationale, created_at
       FROM feature_alias WHERE project_id = $1 AND alias_key = $2`,
      [projectId, alias.aliasKey],
    );
    const row = result.rows[0];
    const stored = row ? {
      featureId: row.feature_id,
      featureVersion: row.feature_version,
      alias: row.alias,
      aliasKey: row.alias_key,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      rationale: row.rationale,
      createdAt: new Date(row.created_at).toISOString(),
    } : null;
    if (!stored || canonicalJson(recordIdentity(stored)) !== canonicalJson(recordIdentity(alias))) {
      throw new PersistenceConflictError(`Feature alias ${alias.alias} is already assigned`);
    }
    return deepFreeze(stored);
  }

  async listFeatureAliases(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    const result = await this.#database.query(
      `SELECT feature_id, feature_version, alias, alias_key, actor_id, actor_role, rationale, created_at
       FROM feature_alias WHERE project_id = $1 AND feature_id = $2 ORDER BY alias_key`,
      [projectId, featureId],
    );
    return deepFreeze(result.rows.map((row) => ({
      featureId: row.feature_id,
      featureVersion: row.feature_version,
      alias: row.alias,
      aliasKey: row.alias_key,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      rationale: row.rationale,
      createdAt: new Date(row.created_at).toISOString(),
    })));
  }

  async appendFeatureLineage(projectId, lineage) {
    requireId(projectId, "projectId");
    await this.#database.query(
      `INSERT INTO feature_lineage (
         project_id, predecessor_id, successor_id, relation_type, decision_id, actor_id, actor_role, rationale, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (project_id, predecessor_id, successor_id, relation_type) DO NOTHING`,
      [projectId, lineage.predecessorFeatureId, lineage.successorFeatureId, lineage.relationType,
        lineage.id, lineage.actorId, lineage.actorRole, lineage.rationale, lineage.createdAt],
    );
    const result = await this.#database.query(
      `SELECT predecessor_id, successor_id, relation_type, decision_id, actor_id, actor_role, rationale, created_at
       FROM feature_lineage
       WHERE project_id = $1 AND predecessor_id = $2 AND successor_id = $3 AND relation_type = $4`,
      [projectId, lineage.predecessorFeatureId, lineage.successorFeatureId, lineage.relationType],
    );
    const row = result.rows[0];
    const stored = row ? {
      id: row.decision_id,
      predecessorFeatureId: row.predecessor_id,
      successorFeatureId: row.successor_id,
      relationType: row.relation_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      rationale: row.rationale,
      createdAt: new Date(row.created_at).toISOString(),
    } : null;
    if (!stored || canonicalJson(recordIdentity(stored)) !== canonicalJson(recordIdentity(lineage))) {
      throw new PersistenceConflictError(`Feature lineage ${lineage.id} conflicts with immutable history`);
    }
    return deepFreeze(stored);
  }

  async listFeatureLineages(projectId, featureId = null) {
    requireId(projectId, "projectId");
    if (featureId !== null) requireId(featureId, "featureId");
    const result = await this.#database.query(
      `SELECT predecessor_id, successor_id, relation_type, decision_id, actor_id, actor_role, rationale, created_at
       FROM feature_lineage
       WHERE project_id = $1 AND ($2::text IS NULL OR predecessor_id = $2 OR successor_id = $2)
       ORDER BY created_at, decision_id`,
      [projectId, featureId],
    );
    return deepFreeze(result.rows.map((row) => ({
      id: row.decision_id,
      predecessorFeatureId: row.predecessor_id,
      successorFeatureId: row.successor_id,
      relationType: row.relation_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      rationale: row.rationale,
      createdAt: new Date(row.created_at).toISOString(),
    })));
  }

  async appendTestSpec(projectId, testSpec) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      const featureResult = await this.#database.query(
        "SELECT 1 FROM feature WHERE project_id = $1 AND id = $2",
        [projectId, testSpec.featureId],
      );
      if (!featureResult.rows[0]) {
        throw new PersistenceConflictError(`Feature ${testSpec.featureId} does not exist in project ${projectId}`);
      }

      if (testSpec.approval) {
        const approverResult = await this.#database.query(
          `SELECT 1
           FROM principal actor
           JOIN project governed_project ON governed_project.tenant_id = actor.tenant_id
           WHERE actor.id = $1 AND governed_project.id = $2`,
          [testSpec.approval.actorId, projectId],
        );
        if (!approverResult.rows[0]) {
          throw new PersistenceConflictError("TestSpec approver must belong to the project tenant");
        }
      }

      for (const claimRef of testSpec.verifiesClaims) {
        const claimResult = await this.#database.query(
          `SELECT feature_id FROM claim
           WHERE project_id = $1 AND id = $2 AND version = $3`,
          [projectId, claimRef.id, claimRef.version],
        );
        if (claimResult.rows[0]?.feature_id !== testSpec.featureId) {
          throw new PersistenceConflictError(
            `Claim ${claimRef.id} version ${claimRef.version} does not belong to Feature ${testSpec.featureId}`,
          );
        }
      }

      await this.#database.query(
        `INSERT INTO test_spec (project_id, id, version, name, approved, specification, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (project_id, id, version) DO NOTHING`,
        [
          projectId,
          testSpec.id,
          testSpec.version,
          testSpec.name,
          testSpec.approved,
          JSON.stringify(testSpecPayload(testSpec)),
          testSpec.createdAt,
        ],
      );

      const stored = await this.getTestSpec(projectId, testSpec.id, testSpec.version);
      if (
        !stored ||
        canonicalJson(testSpecPayload(stored)) !== canonicalJson(testSpecPayload(testSpec)) ||
        stored.name !== testSpec.name ||
        stored.approved !== testSpec.approved
      ) {
        throw new PersistenceConflictError(
          `TestSpec ${testSpec.id} version ${testSpec.version} conflicts with an existing record`,
        );
      }

      for (const claimRef of testSpec.verifiesClaims) {
        await this.#database.query(
          `INSERT INTO test_spec_claim (
             project_id, test_spec_id, test_spec_version, claim_id, claim_version
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [projectId, testSpec.id, testSpec.version, claimRef.id, claimRef.version],
        );
      }
      return testSpec;
    });
  }

  async getTestSpec(projectId, testSpecId, version = null) {
    requireId(projectId, "projectId");
    requireId(testSpecId, "testSpecId");
    if (version !== null && (!Number.isSafeInteger(version) || version < 1)) {
      throw new TypeError("version must be a positive integer");
    }
    const parameters = version === null ? [projectId, testSpecId] : [projectId, testSpecId, version];
    const versionPredicate = version === null ? "" : "AND version = $3";
    const result = await this.#database.query(
      `SELECT id, version, name, approved, specification, created_at
       FROM test_spec
       WHERE project_id = $1 AND id = $2 ${versionPredicate}
       ORDER BY version DESC
       LIMIT 1`,
      parameters,
    );
    const row = result.rows[0];
    if (!row) return null;
    return deepFreeze(testSpecFromRow(row));
  }

  async appendExecutionEvidenceBundle(projectId, bundle) {
    requireId(projectId, "projectId");
    const { execution, evidence, attestation } = bundle;
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO test_execution (
           project_id, id, test_spec_id, test_spec_version, snapshot_manifest_id,
           deployment_component_id, status, started_at, finished_at, attempts,
           runner_id, runner_version, completion_reason, runner_attestation
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb
         )
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          execution.id,
          execution.testSpecId,
          execution.testSpecVersion,
          execution.snapshotManifestId,
          execution.deploymentId,
          execution.status,
          execution.startedAt,
          execution.finishedAt,
          JSON.stringify(execution.attempts),
          execution.runner.id,
          execution.runner.version,
          execution.completionReason,
          JSON.stringify(attestation),
        ],
      );

      const storedExecution = await this.#database.query(
        `SELECT * FROM test_execution WHERE project_id = $1 AND id = $2`,
        [projectId, execution.id],
      );
      const row = storedExecution.rows[0];
      if (
        !row ||
        canonicalJson(executionFromRow(row)) !== canonicalJson(execution) ||
        canonicalJson(row.runner_attestation) !== canonicalJson(attestation)
      ) {
        throw new PersistenceConflictError(`TestExecution ${execution.id} conflicts with an existing record`);
      }

      for (const item of evidence) {
        await this.#database.query(
          `INSERT INTO evidence (
             project_id, id, execution_id, evidence_type, integrity_status,
             freshness_status, content_hash, storage_uri, manifest, created_at
           ) VALUES ($1, $2, $3, $4, 'VERIFIED', $5, $6, $7, $8::jsonb, $9)
           ON CONFLICT (project_id, id) DO NOTHING`,
          [
            projectId,
            item.id,
            execution.id,
            item.type,
            item.freshness,
            item.contentHash,
            item.storageUri,
            JSON.stringify(item.manifest),
            item.createdAt,
          ],
        );
        const storedEvidence = await this.#database.query(
          `SELECT * FROM evidence WHERE project_id = $1 AND id = $2`,
          [projectId, item.id],
        );
        const evidenceRow = storedEvidence.rows[0];
        const expected = { ...item, integrity: "VERIFIED" };
        if (!evidenceRow || canonicalJson(evidenceFromRow(evidenceRow)) !== canonicalJson(expected)) {
          throw new PersistenceConflictError(`Evidence ${item.id} conflicts with an existing record`);
        }
      }

      return deepFreeze({
        executionId: execution.id,
        evidenceIds: evidence.map((item) => item.id),
      });
    });
  }

  async getExecutionEvidence(projectId, executionId) {
    requireId(projectId, "projectId");
    requireId(executionId, "executionId");
    const executionResult = await this.#database.query(
      `SELECT * FROM test_execution WHERE project_id = $1 AND id = $2`,
      [projectId, executionId],
    );
    const row = executionResult.rows[0];
    if (!row) return null;
    const evidenceResult = await this.#database.query(
      `SELECT * FROM evidence
       WHERE project_id = $1 AND execution_id = $2
       ORDER BY created_at, id`,
      [projectId, executionId],
    );
    return deepFreeze({
      execution: executionFromRow(row),
      evidence: evidenceResult.rows.map(evidenceFromRow),
      attestation: row.runner_attestation,
    });
  }

  async getEvidence(projectId, evidenceId) {
    requireId(projectId, "projectId");
    requireId(evidenceId, "evidenceId");
    const result = await this.#database.query(
      `SELECT * FROM evidence WHERE project_id = $1 AND id = $2`,
      [projectId, evidenceId],
    );
    return result.rows[0] ? deepFreeze(evidenceFromRow(result.rows[0])) : null;
  }

  async appendEvidenceRetentionPolicy(projectId, policy) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO evidence_retention_policy (
           project_id, id, version, policy_payload, actor_id, actor_role, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         ON CONFLICT (project_id, id, version) DO NOTHING`,
        [projectId, policy.id, policy.version, JSON.stringify(policy), policy.actorId, policy.actorRole, policy.createdAt],
      );
      const stored = await this.#database.query(
        `SELECT policy_payload
         FROM evidence_retention_policy
         WHERE project_id = $1 AND id = $2 AND version = $3`,
        [projectId, policy.id, policy.version],
      );
      if (!stored.rows[0] || canonicalJson(stored.rows[0].policy_payload) !== canonicalJson(policy)) {
        throw new PersistenceConflictError(`EvidenceRetentionPolicy ${policy.id}@${policy.version} conflicts`);
      }
      return policy;
    });
  }

  async getEvidenceRetentionPolicy(projectId, policyId, version = null) {
    requireId(projectId, "projectId");
    requireId(policyId, "policyId");
    const parameters = version === null ? [projectId, policyId] : [projectId, policyId, version];
    const versionFilter = version === null ? "" : "AND version = $3";
    const result = await this.#database.query(
      `SELECT policy_payload
       FROM evidence_retention_policy
       WHERE project_id = $1 AND id = $2 ${versionFilter}
       ORDER BY version DESC LIMIT 1`,
      parameters,
    );
    return result.rows[0]?.policy_payload ?? null;
  }

  async appendEvidenceLifecycleEvent(projectId, event) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO evidence_lifecycle_event (
           project_id, evidence_id, id, policy_id, policy_version, action,
           event_payload, actor_id, actor_role, occurred_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (project_id, evidence_id, id) DO NOTHING`,
        [
          projectId,
          event.evidenceId,
          event.id,
          event.policyId,
          event.policyVersion,
          event.action,
          JSON.stringify(event),
          event.actorId,
          event.actorRole,
          event.occurredAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT event_payload
         FROM evidence_lifecycle_event
         WHERE project_id = $1 AND evidence_id = $2 AND id = $3`,
        [projectId, event.evidenceId, event.id],
      );
      if (!stored.rows[0] || canonicalJson(stored.rows[0].event_payload) !== canonicalJson(event)) {
        throw new PersistenceConflictError(`EvidenceLifecycleEvent ${event.id} conflicts`);
      }
      return event;
    });
  }

  async listEvidenceLifecycleEvents(projectId, evidenceId) {
    requireId(projectId, "projectId");
    requireId(evidenceId, "evidenceId");
    const result = await this.#database.query(
      `SELECT event_payload
       FROM evidence_lifecycle_event
       WHERE project_id = $1 AND evidence_id = $2
       ORDER BY append_sequence`,
      [projectId, evidenceId],
    );
    return deepFreeze(result.rows.map((row) => row.event_payload));
  }

  async appendFactBundle(projectId, bundle) {
    requireId(projectId, "projectId");
    requireId(bundle?.id, "bundle.id");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO fact_bundle (
           project_id, id, snapshot_manifest_id, source_component_id, source_digest, extractor_id,
           extractor_version, observed_at, complete, diagnostics, scanner_attestation
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          bundle.id,
          bundle.snapshotManifestId,
          bundle.sourceComponentId,
          bundle.sourceDigest,
          bundle.extractor.id,
          bundle.extractor.version,
          bundle.observedAt,
          bundle.complete,
          JSON.stringify(bundle.diagnostics),
          JSON.stringify(bundle.attestation),
        ],
      );
      const storedBundle = await this.#database.query(
        `SELECT * FROM fact_bundle WHERE project_id = $1 AND id = $2`,
        [projectId, bundle.id],
      );
      const row = storedBundle.rows[0];
      if (
        !row ||
        row.snapshot_manifest_id !== bundle.snapshotManifestId ||
        row.source_component_id !== bundle.sourceComponentId ||
        row.source_digest !== bundle.sourceDigest ||
        row.extractor_id !== bundle.extractor.id ||
        row.extractor_version !== bundle.extractor.version ||
        new Date(row.observed_at).toISOString() !== bundle.observedAt ||
        row.complete !== bundle.complete ||
        canonicalJson(row.diagnostics) !== canonicalJson(bundle.diagnostics) ||
        canonicalJson(row.scanner_attestation) !== canonicalJson(bundle.attestation)
      ) {
        throw new PersistenceConflictError(`FactBundle ${bundle.id} conflicts with an existing immutable record`);
      }

      for (const node of bundle.nodes) {
        await this.#database.query(
          `INSERT INTO fact_node (
             project_id, bundle_id, fact_id, node_id, snapshot_manifest_id, node_type,
             natural_key, name, source_artifact, start_line, end_line, content_hash, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
           ON CONFLICT (project_id, bundle_id, fact_id) DO NOTHING`,
          [
            projectId,
            bundle.id,
            node.factId,
            node.id,
            node.snapshotManifestId,
            node.type,
            node.naturalKey,
            node.name,
            node.source.artifact,
            node.source.startLine,
            node.source.endLine,
            node.source.contentHash,
            JSON.stringify(node),
          ],
        );
        const storedNode = await this.#database.query(
          `SELECT payload FROM fact_node
           WHERE project_id = $1 AND bundle_id = $2 AND fact_id = $3`,
          [projectId, bundle.id, node.factId],
        );
        if (!storedNode.rows[0] || canonicalJson(storedNode.rows[0].payload) !== canonicalJson(node)) {
          throw new PersistenceConflictError(`Fact ${node.factId} conflicts with an existing immutable record`);
        }
      }

      for (const edge of bundle.edges) {
        await this.#database.query(
          `INSERT INTO fact_edge (
             project_id, bundle_id, id, snapshot_manifest_id, subject_node_id, predicate,
             object_node_id, source_artifact, start_line, end_line, content_hash, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
           ON CONFLICT (project_id, bundle_id, id) DO NOTHING`,
          [
            projectId,
            bundle.id,
            edge.id,
            edge.snapshotManifestId,
            edge.subjectId,
            edge.predicate,
            edge.objectId,
            edge.source.artifact,
            edge.source.startLine,
            edge.source.endLine,
            edge.source.contentHash,
            JSON.stringify(edge),
          ],
        );
        const storedEdge = await this.#database.query(
          `SELECT payload FROM fact_edge
           WHERE project_id = $1 AND bundle_id = $2 AND id = $3`,
          [projectId, bundle.id, edge.id],
        );
        if (!storedEdge.rows[0] || canonicalJson(storedEdge.rows[0].payload) !== canonicalJson(edge)) {
          throw new PersistenceConflictError(`FactEdge ${edge.id} conflicts with an existing immutable record`);
        }
      }

      return deepFreeze({
        bundleId: bundle.id,
        snapshotManifestId: bundle.snapshotManifestId,
        sourceComponentId: bundle.sourceComponentId,
        nodeCount: bundle.nodes.length,
        edgeCount: bundle.edges.length,
        complete: bundle.complete,
      });
    });
  }

  async queryFacts(projectId, filters = {}) {
    requireId(projectId, "projectId");
    const limit = filters.limit ?? 100;
    const bundleParameters = [projectId];
    let bundleSnapshotPredicate = "";
    if (filters.snapshotManifestId) {
      bundleParameters.push(filters.snapshotManifestId);
      bundleSnapshotPredicate = `AND snapshot_manifest_id = $${bundleParameters.length}`;
    }
    const bundleResult = await this.#database.query(
      `SELECT DISTINCT ON (snapshot_manifest_id, source_component_id, extractor_id) * FROM fact_bundle
       WHERE project_id = $1 ${bundleSnapshotPredicate}
       ORDER BY snapshot_manifest_id, source_component_id, extractor_id, observed_at DESC, id DESC`,
      bundleParameters,
    );

    const currentBundleIds = bundleResult.rows.map((row) => row.id);
    if (currentBundleIds.length === 0) {
      return deepFreeze({
        bundles: [],
        matchedNodeIds: [],
        nodes: [],
        edges: [],
        truncated: false,
        edgesTruncated: false,
      });
    }

    const nodeParameters = [projectId, currentBundleIds];
    const nodePredicates = ["project_id = $1", "bundle_id = ANY($2::text[])"];
    if (filters.snapshotManifestId) {
      nodeParameters.push(filters.snapshotManifestId);
      nodePredicates.push(`snapshot_manifest_id = $${nodeParameters.length}`);
    }
    if (filters.types?.length) {
      nodeParameters.push(filters.types);
      nodePredicates.push(`node_type = ANY($${nodeParameters.length}::text[])`);
    }
    if (filters.query) {
      nodeParameters.push(`%${filters.query.toLowerCase()}%`);
      nodePredicates.push(
        `(lower(name) LIKE $${nodeParameters.length} OR lower(natural_key) LIKE $${nodeParameters.length} OR lower(source_artifact) LIKE $${nodeParameters.length})`,
      );
    }
    nodeParameters.push(limit + 1);
    const nodeResult = await this.#database.query(
      `SELECT bundle_id, node_id, payload FROM fact_node
       WHERE ${nodePredicates.join(" AND ")}
       ORDER BY natural_key, bundle_id
       LIMIT $${nodeParameters.length}`,
      nodeParameters,
    );
    const truncated = nodeResult.rows.length > limit;
    const matchedRows = nodeResult.rows.slice(0, limit);
    if (matchedRows.length === 0) {
      return deepFreeze({
        bundles: bundleResult.rows.map((bundleRow) => ({
          id: bundleRow.id,
          snapshotManifestId: bundleRow.snapshot_manifest_id,
          sourceComponentId: bundleRow.source_component_id,
          sourceDigest: bundleRow.source_digest,
          extractor: { id: bundleRow.extractor_id, version: bundleRow.extractor_version },
          observedAt: new Date(bundleRow.observed_at).toISOString(),
          complete: bundleRow.complete,
          diagnostics: bundleRow.diagnostics,
          attestation: bundleRow.scanner_attestation,
        })),
        matchedNodeIds: [],
        nodes: [],
        edges: [],
        truncated: false,
        edgesTruncated: false,
      });
    }

    const bundleIds = [...new Set(matchedRows.map((row) => row.bundle_id))];
    const nodeIds = [...new Set(matchedRows.map((row) => row.node_id))];
    const edgeParameters = [projectId, bundleIds, nodeIds];
    const edgePredicates = [
      "project_id = $1",
      "bundle_id = ANY($2::text[])",
      "(subject_node_id = ANY($3::text[]) OR object_node_id = ANY($3::text[]))",
    ];
    if (filters.predicates?.length) {
      edgeParameters.push(filters.predicates);
      edgePredicates.push(`predicate = ANY($${edgeParameters.length}::text[])`);
    }
    const edgeLimit = Math.min(limit * 8, 4_000);
    edgeParameters.push(edgeLimit + 1);
    const edgeResult = await this.#database.query(
      `SELECT bundle_id, subject_node_id, object_node_id, payload FROM fact_edge
       WHERE ${edgePredicates.join(" AND ")}
       ORDER BY bundle_id, predicate, id
       LIMIT $${edgeParameters.length}`,
      edgeParameters,
    );
    const edgesTruncated = edgeResult.rows.length > edgeLimit;
    const edgeRows = edgeResult.rows.slice(0, edgeLimit);
    const graphNodeIds = [...new Set([
      ...nodeIds,
      ...edgeRows.flatMap((row) => [row.subject_node_id, row.object_node_id]),
    ])];
    const graphNodeResult = await this.#database.query(
      `SELECT bundle_id, node_id, payload FROM fact_node
       WHERE project_id = $1
         AND bundle_id = ANY($2::text[])
         AND node_id = ANY($3::text[])
       ORDER BY natural_key, bundle_id`,
      [projectId, bundleIds, graphNodeIds],
    );

    return deepFreeze({
      bundles: bundleResult.rows.map((bundleRow) => ({
        id: bundleRow.id,
        snapshotManifestId: bundleRow.snapshot_manifest_id,
        sourceComponentId: bundleRow.source_component_id,
        sourceDigest: bundleRow.source_digest,
        extractor: { id: bundleRow.extractor_id, version: bundleRow.extractor_version },
        observedAt: new Date(bundleRow.observed_at).toISOString(),
        complete: bundleRow.complete,
        diagnostics: bundleRow.diagnostics,
        attestation: bundleRow.scanner_attestation,
      })),
      matchedNodeIds: matchedRows.map((row) => row.node_id),
      nodes: graphNodeResult.rows.map((nodeRow) => ({ ...nodeRow.payload, bundleId: nodeRow.bundle_id })),
      edges: edgeRows.map((edgeRow) => ({ ...edgeRow.payload, bundleId: edgeRow.bundle_id })),
      truncated,
      edgesTruncated,
    });
  }

  async getFactBundles(projectId, bundleIds) {
    requireId(projectId, "projectId");
    if (!Array.isArray(bundleIds) || bundleIds.length === 0 || new Set(bundleIds).size !== bundleIds.length) {
      throw new TypeError("bundleIds must be a non-empty array without duplicates");
    }
    bundleIds.forEach((bundleId) => requireId(bundleId, "bundleId"));
    const [bundleResult, nodeResult, edgeResult] = await Promise.all([
      this.#database.query(
        `SELECT * FROM fact_bundle WHERE project_id = $1 AND id = ANY($2::text[])`,
        [projectId, bundleIds],
      ),
      this.#database.query(
        `SELECT bundle_id, payload FROM fact_node
         WHERE project_id = $1 AND bundle_id = ANY($2::text[])
         ORDER BY bundle_id, fact_id`,
        [projectId, bundleIds],
      ),
      this.#database.query(
        `SELECT bundle_id, payload FROM fact_edge
         WHERE project_id = $1 AND bundle_id = ANY($2::text[])
         ORDER BY bundle_id, id`,
        [projectId, bundleIds],
      ),
    ]);
    if (bundleResult.rows.length !== bundleIds.length) return null;
    const nodesByBundle = new Map();
    for (const row of nodeResult.rows) {
      const nodes = nodesByBundle.get(row.bundle_id) ?? [];
      nodes.push(row.payload);
      nodesByBundle.set(row.bundle_id, nodes);
    }
    const edgesByBundle = new Map();
    for (const row of edgeResult.rows) {
      const edges = edgesByBundle.get(row.bundle_id) ?? [];
      edges.push(row.payload);
      edgesByBundle.set(row.bundle_id, edges);
    }
    const byId = new Map(bundleResult.rows.map((row) => [row.id, row]));
    return deepFreeze(bundleIds.map((bundleId) => {
      const row = byId.get(bundleId);
      return {
        id: row.id,
        projectId,
        snapshotManifestId: row.snapshot_manifest_id,
        sourceComponentId: row.source_component_id,
        sourceDigest: row.source_digest,
        extractor: { id: row.extractor_id, version: row.extractor_version },
        observedAt: new Date(row.observed_at).toISOString(),
        complete: row.complete,
        diagnostics: row.diagnostics,
        nodes: nodesByBundle.get(bundleId) ?? [],
        edges: edgesByBundle.get(bundleId) ?? [],
        attestation: row.scanner_attestation,
      };
    }));
  }

  async getFactGraphByReferences(projectId, snapshotManifestId, factRefs) {
    requireId(projectId, "projectId");
    requireId(snapshotManifestId, "snapshotManifestId");
    if (!Array.isArray(factRefs)) throw new TypeError("factRefs must be an array");
    if (factRefs.length === 0) return deepFreeze({ nodes: [], edges: [], missingFactRefs: [] });
    const requested = [...new Set(factRefs.map((factId, index) => requireId(factId, `factRefs[${index}]`)))];
    const nodeResult = await this.#database.query(
      `SELECT bundle_id, fact_id, node_id, payload
       FROM fact_node
       WHERE project_id = $1 AND snapshot_manifest_id = $2 AND fact_id = ANY($3::text[])
       ORDER BY bundle_id, fact_id`,
      [projectId, snapshotManifestId, requested],
    );
    const edgeResult = await this.#database.query(
      `SELECT bundle_id, id, subject_node_id, object_node_id, payload
       FROM fact_edge
       WHERE project_id = $1 AND snapshot_manifest_id = $2 AND id = ANY($3::text[])
       ORDER BY bundle_id, id`,
      [projectId, snapshotManifestId, requested],
    );
    const endpointNodeIds = [...new Set(edgeResult.rows.flatMap((edge) => [edge.subject_node_id, edge.object_node_id]))];
    const bundleIds = [...new Set(edgeResult.rows.map((edge) => edge.bundle_id))];
    const endpointResult = endpointNodeIds.length === 0
      ? { rows: [] }
      : await this.#database.query(
          `SELECT bundle_id, fact_id, node_id, payload
           FROM fact_node
           WHERE project_id = $1
             AND snapshot_manifest_id = $2
             AND bundle_id = ANY($3::text[])
             AND node_id = ANY($4::text[])
           ORDER BY bundle_id, fact_id`,
          [projectId, snapshotManifestId, bundleIds, endpointNodeIds],
        );
    const nodes = [...new Map(
      [...nodeResult.rows, ...endpointResult.rows].map((node) => [
        `${node.bundle_id}\u0000${node.node_id}`,
        { ...node.payload, bundleId: node.bundle_id },
      ]),
    ).values()];
    const edges = edgeResult.rows.map((edge) => ({ ...edge.payload, bundleId: edge.bundle_id }));
    const found = new Set([...nodeResult.rows.map((node) => node.fact_id), ...edgeResult.rows.map((edge) => edge.id)]);
    return deepFreeze({
      nodes,
      edges,
      missingFactRefs: requested.filter((factId) => !found.has(factId)),
    });
  }

  async getSnapshotFactGraph(projectId, snapshotManifestId, maxNodes = 100_000) {
    requireId(projectId, "projectId");
    requireId(snapshotManifestId, "snapshotManifestId");
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1_000_000) {
      throw new TypeError("maxNodes must be an integer between 1 and 1000000");
    }
    const bundleResult = await this.#database.query(
      `SELECT DISTINCT ON (source_component_id, extractor_id) id, complete
       FROM fact_bundle
       WHERE project_id = $1 AND snapshot_manifest_id = $2
       ORDER BY source_component_id, extractor_id, observed_at DESC, id DESC`,
      [projectId, snapshotManifestId],
    );
    const bundleIds = bundleResult.rows.map((row) => row.id);
    if (bundleIds.length === 0) {
      return deepFreeze({ nodes: [], edges: [], complete: false, bundleIds: [] });
    }
    const nodeResult = await this.#database.query(
      `SELECT bundle_id, payload
       FROM fact_node
       WHERE project_id = $1 AND bundle_id = ANY($2::text[])
       ORDER BY bundle_id, natural_key
       LIMIT $3`,
      [projectId, bundleIds, maxNodes + 1],
    );
    if (nodeResult.rows.length > maxNodes) throw new RangeError("Snapshot Fact graph exceeds maxNodes");
    const edgeResult = await this.#database.query(
      `SELECT bundle_id, payload
       FROM fact_edge
       WHERE project_id = $1 AND bundle_id = ANY($2::text[])
       ORDER BY bundle_id, id`,
      [projectId, bundleIds],
    );
    return deepFreeze({
      nodes: nodeResult.rows.map((row) => ({ ...row.payload, bundleId: row.bundle_id })),
      edges: edgeResult.rows.map((row) => ({ ...row.payload, bundleId: row.bundle_id })),
      complete: bundleResult.rows.every((row) => row.complete),
      bundleIds,
    });
  }

  async listImplementationMappings(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT im.*, c.feature_id
       FROM implementation_mapping im
       JOIN claim c
         ON c.project_id = im.project_id
        AND c.id = im.claim_id
        AND c.version = im.claim_version
       WHERE im.project_id = $1
       ORDER BY im.created_at, im.id`,
      [projectId],
    );
    return deepFreeze(result.rows.map((row) => ({
      id: row.id,
      featureId: row.feature_id,
      claimId: row.claim_id,
      claimVersion: row.claim_version,
      scopeId: row.scope_id,
      scopeVersion: row.scope_version,
      snapshotManifestId: row.snapshot_manifest_id,
      sourceComponentId: row.source_component_id,
      sourceRunId: row.source_run_id,
      sourceCandidateId: row.source_candidate_id,
      status: row.mapping_status,
      factRefs: row.fact_refs,
      createdAt: new Date(row.created_at).toISOString(),
    })));
  }

  async appendImplementationAnalysis(projectId, analysisPackage) {
    requireId(projectId, "projectId");
    const { implementationMapping, conformance } = analysisPackage;
    return this.#transaction(async () => {
      await this.#database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${projectId}:implementation-analysis:${implementationMapping.id}`,
      ]);
      const existing = await this.#database.query(
        `SELECT im.*, ic.id AS conformance_id, ic.status AS conformance_status,
                ic.evidence_refs, ic.analysis_method, ic.computed_at
         FROM implementation_mapping im
         LEFT JOIN implementation_conformance ic
           ON ic.project_id = im.project_id AND ic.mapping_id = im.id
         WHERE im.project_id = $1 AND im.id = $2`,
        [projectId, implementationMapping.id],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        const storedMapping = {
          id: row.id,
          claimId: row.claim_id,
          claimVersion: row.claim_version,
          scopeId: row.scope_id,
          scopeVersion: row.scope_version,
          snapshotManifestId: row.snapshot_manifest_id,
          sourceComponentId: row.source_component_id,
          sourceRunId: row.source_run_id,
          sourceCandidateId: row.source_candidate_id,
          status: row.mapping_status,
          factRefs: row.fact_refs,
          createdAt: new Date(row.created_at).toISOString(),
        };
        const storedConformance = row.conformance_id ? {
          id: row.conformance_id,
          claimId: row.claim_id,
          claimVersion: row.claim_version,
          scopeId: row.scope_id,
          scopeVersion: row.scope_version,
          snapshotManifestId: row.snapshot_manifest_id,
          mappingId: row.id,
          status: row.conformance_status,
          evidenceRefs: row.evidence_refs,
          analysisMethod: row.analysis_method,
          computedAt: new Date(row.computed_at).toISOString(),
        } : null;
        if (
          storedConformance &&
          canonicalJson(storedMapping) === canonicalJson(implementationMapping) &&
          canonicalJson(storedConformance) === canonicalJson(conformance)
        ) {
          return deepFreeze({ implementationMapping: storedMapping, conformance: storedConformance });
        }
        throw new PersistenceConflictError(
          `Implementation analysis ${implementationMapping.id} conflicts with an existing record`,
        );
      }

      const runResult = await this.#database.query(
        `SELECT run_payload
         FROM reverse_run
         WHERE project_id = $1 AND id = $2`,
        [projectId, implementationMapping.sourceRunId],
      );
      const run = runResult.rows[0]?.run_payload;
      if (
        !run ||
        run.snapshotManifestId !== implementationMapping.snapshotManifestId ||
        run.sourceComponentId !== implementationMapping.sourceComponentId ||
        !run.mergedOutput?.candidateClaims?.some((item) => item.id === implementationMapping.sourceCandidateId)
      ) {
        throw new PersistenceConflictError(
          "Implementation analysis must reference a candidate from the target Snapshot ReverseRun",
        );
      }

      await this.#database.query(
        `INSERT INTO implementation_mapping (
           project_id, id, claim_id, claim_version, scope_id, scope_version,
           snapshot_manifest_id, source_component_id, source_run_id, source_candidate_id,
           mapping_status, fact_refs, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
        [
          projectId,
          implementationMapping.id,
          implementationMapping.claimId,
          implementationMapping.claimVersion,
          implementationMapping.scopeId,
          implementationMapping.scopeVersion,
          implementationMapping.snapshotManifestId,
          implementationMapping.sourceComponentId,
          implementationMapping.sourceRunId,
          implementationMapping.sourceCandidateId,
          implementationMapping.status,
          JSON.stringify(implementationMapping.factRefs),
          implementationMapping.createdAt,
        ],
      );
      await this.#database.query(
        `INSERT INTO implementation_conformance (
           project_id, id, claim_id, claim_version, scope_id, scope_version,
           snapshot_manifest_id, status, evidence_refs, analysis_method, computed_at, mapping_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
        [
          projectId,
          conformance.id,
          conformance.claimId,
          conformance.claimVersion,
          conformance.scopeId,
          conformance.scopeVersion,
          conformance.snapshotManifestId,
          conformance.status,
          JSON.stringify(conformance.evidenceRefs),
          JSON.stringify(conformance.analysisMethod),
          conformance.computedAt,
          conformance.mappingId,
        ],
      );
      return deepFreeze(structuredClone({ implementationMapping, conformance }));
    });
  }

  async appendReverseSkillRegistration(registration) {
    const manifest = registration.manifest;
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO reverse_skill_registration (
           registration_id, skill_id, skill_version, name, publisher, artifact_digest,
           supply_status, manifest, publisher_attestation, registered_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
         ON CONFLICT (registration_id) DO NOTHING`,
        [
          registration.id,
          manifest.metadata.id,
          manifest.metadata.version,
          manifest.metadata.name,
          manifest.metadata.publisher,
          manifest.metadata.artifactDigest,
          registration.status,
          JSON.stringify(manifest),
          JSON.stringify(registration.attestation),
          registration.registeredAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT * FROM reverse_skill_registration WHERE registration_id = $1`,
        [registration.id],
      );
      const row = stored.rows[0];
      if (!row || canonicalJson(reverseSkillRegistrationFromRow(row)) !== canonicalJson(registration)) {
        throw new PersistenceConflictError(`ReverseSkill registration ${registration.id} conflicts with an existing record`);
      }
      return registration;
    });
  }

  async listReverseSkills() {
    const result = await this.#database.query(
      `SELECT DISTINCT ON (skill_id, skill_version) *
       FROM reverse_skill_registration
       ORDER BY skill_id, skill_version, event_sequence DESC`,
    );
    return deepFreeze(result.rows.map(reverseSkillRegistrationFromRow));
  }

  async getReverseSkillRegistration(skillId, version = null) {
    requireId(skillId, "skillId");
    const parameters = version === null ? [skillId] : [skillId, version];
    const versionPredicate = version === null ? "" : "AND skill_version = $2";
    const result = await this.#database.query(
      `SELECT * FROM reverse_skill_registration
       WHERE skill_id = $1 ${versionPredicate}
       ORDER BY event_sequence DESC
       LIMIT 1`,
      parameters,
    );
    return result.rows[0] ? deepFreeze(reverseSkillRegistrationFromRow(result.rows[0])) : null;
  }

  async appendReverseRun(projectId, run) {
    requireId(projectId, "projectId");
    requireId(run?.id, "run.id");
    return this.#transaction(async () => {
      const createdAt = run.statusHistory[0].occurredAt;
      const finishedAt = run.statusHistory.at(-1).occurredAt;
      await this.#database.query(
        `INSERT INTO reverse_run (
           project_id, id, snapshot_manifest_id, source_component_id, input_digest,
           status, input_package, run_payload, created_at, finished_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          run.id,
          run.snapshotManifestId,
          run.sourceComponentId,
          run.inputPackage.digest,
          run.status,
          JSON.stringify(run.inputPackage),
          JSON.stringify(run),
          createdAt,
          finishedAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT run_payload FROM reverse_run WHERE project_id = $1 AND id = $2`,
        [projectId, run.id],
      );
      if (!stored.rows[0] || canonicalJson(stored.rows[0].run_payload) !== canonicalJson(run)) {
        throw new PersistenceConflictError(`ReverseRun ${run.id} conflicts with an existing immutable record`);
      }

      for (const item of run.statusHistory) {
        await this.#database.query(
          `INSERT INTO reverse_run_event (project_id, run_id, sequence, status, details, occurred_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (project_id, run_id, sequence) DO NOTHING`,
          [projectId, run.id, item.sequence, item.status, JSON.stringify(item.details), item.occurredAt],
        );
      }
      for (const skillRun of run.skillRuns) {
        await this.#database.query(
          `INSERT INTO reverse_skill_execution (
             project_id, run_id, skill_id, skill_version, registration_id, status,
             observe_only, attempts, raw_output, normalized_output
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
           ON CONFLICT (project_id, run_id, skill_id, skill_version) DO NOTHING`,
          [
            projectId,
            run.id,
            skillRun.skillId,
            skillRun.skillVersion,
            skillRun.registrationId,
            skillRun.status,
            skillRun.observeOnly,
            JSON.stringify(skillRun.attempts),
            skillRun.rawOutput === null ? null : JSON.stringify(skillRun.rawOutput),
            skillRun.normalizedOutput === null ? null : JSON.stringify(skillRun.normalizedOutput),
          ],
        );
      }
      for (const conflict of run.mergedOutput?.conflicts ?? []) {
        await this.#database.query(
          `INSERT INTO reverse_conflict (
             project_id, run_id, id, conflict_type, status, candidate_ids, reason, evidence, detected_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
           ON CONFLICT (project_id, run_id, id) DO NOTHING`,
          [
            projectId,
            run.id,
            conflict.id,
            conflict.type,
            conflict.status,
            JSON.stringify(conflict.candidateIds),
            conflict.reason,
            JSON.stringify(conflict.evidence),
            conflict.detectedAt,
          ],
        );
      }
      for (const question of run.mergedOutput?.openQuestions ?? []) {
        await this.#database.query(
          `INSERT INTO reverse_open_question (project_id, run_id, id, question, evidence, sources)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
           ON CONFLICT (project_id, run_id, id) DO NOTHING`,
          [projectId, run.id, question.id, question.question, JSON.stringify(question.evidence), JSON.stringify(question.sources)],
        );
      }
      return deepFreeze({ runId: run.id, status: run.status });
    });
  }

  async getReverseRun(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const result = await this.#database.query(
      `SELECT run_payload FROM reverse_run WHERE project_id = $1 AND id = $2`,
      [projectId, runId],
    );
    return result.rows[0] ? deepFreeze(result.rows[0].run_payload) : null;
  }

  async appendReverseRunJob(projectId, job, event) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO reverse_run_job (project_id, id, request_payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [projectId, job.id, JSON.stringify(job.request), job.createdAt],
      );
      const stored = await this.#database.query(
        `SELECT request_payload, created_at FROM reverse_run_job WHERE project_id = $1 AND id = $2`,
        [projectId, job.id],
      );
      if (
        !stored.rows[0] ||
        canonicalJson(stored.rows[0].request_payload) !== canonicalJson(job.request) ||
        new Date(stored.rows[0].created_at).toISOString() !== job.createdAt
      ) {
        throw new PersistenceConflictError(`ReverseRunJob ${job.id} conflicts with an existing record`);
      }
      await this.#appendReverseRunJobEvent(event, projectId);
      return this.getReverseRunJob(projectId, job.id);
    });
  }

  async #appendReverseRunJobEvent(event, projectId) {
    await this.#database.query(
      `INSERT INTO reverse_run_job_event (
         project_id, job_id, id, status, details, occurred_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (project_id, job_id, id) DO NOTHING`,
      [projectId, event.jobId, event.id, event.status, JSON.stringify(event.details), event.occurredAt],
    );
    const stored = await this.#database.query(
      `SELECT status, details, occurred_at
       FROM reverse_run_job_event
       WHERE project_id = $1 AND job_id = $2 AND id = $3`,
      [projectId, event.jobId, event.id],
    );
    const row = stored.rows[0];
    if (
      !row ||
      row.status !== event.status ||
      canonicalJson(row.details) !== canonicalJson(event.details) ||
      new Date(row.occurred_at).toISOString() !== event.occurredAt
    ) {
      throw new PersistenceConflictError(`ReverseRunJobEvent ${event.id} conflicts with an existing record`);
    }
  }

  async appendReverseRunJobEvent(projectId, event) {
    requireId(projectId, "projectId");
    return this.#transaction(async () => {
      await this.#appendReverseRunJobEvent(event, projectId);
      return this.getReverseRunJob(projectId, event.jobId);
    });
  }

  async getReverseRunJob(projectId, jobId) {
    requireId(projectId, "projectId");
    requireId(jobId, "jobId");
    const result = await this.#database.query(
      `SELECT request_payload, created_at
       FROM reverse_run_job WHERE project_id = $1 AND id = $2`,
      [projectId, jobId],
    );
    if (!result.rows[0]) return null;
    const events = await this.#database.query(
      `SELECT id, status, details, occurred_at
       FROM reverse_run_job_event
       WHERE project_id = $1 AND job_id = $2
       ORDER BY append_sequence`,
      [projectId, jobId],
    );
    return deepFreeze({
      job: {
        id: jobId,
        projectId,
        request: result.rows[0].request_payload,
        createdAt: new Date(result.rows[0].created_at).toISOString(),
      },
      events: events.rows.map((row) => ({
        id: row.id,
        jobId,
        status: row.status,
        details: row.details,
        occurredAt: new Date(row.occurred_at).toISOString(),
      })),
    });
  }

  async appendReverseCandidateReview(projectId, reviewPackage) {
    requireId(projectId, "projectId");
    const { review, feature, scope, claim, decision, implementationMapping, conformance } = reviewPackage;
    requireId(review?.id, "review.id");
    return this.#transaction(async () => {
      const existing = await this.#database.query(
        `SELECT review_payload
         FROM reverse_candidate_review
         WHERE project_id = $1 AND run_id = $2 AND candidate_id = $3`,
        [projectId, review.runId, review.candidateId],
      );
      if (existing.rows[0]) {
        if (canonicalJson(existing.rows[0].review_payload) !== canonicalJson(reviewPackage)) {
          throw new PersistenceConflictError(`Candidate ${review.candidateId} already has a different immutable review`);
        }
        return deepFreeze(existing.rows[0].review_payload);
      }

      if (review.baselineRefs !== null) {
        if (feature) {
          await this.#database.query(
            `INSERT INTO feature (project_id, id) VALUES ($1, $2)`,
            [projectId, feature.id],
          );
          await this.#database.query(
            `INSERT INTO feature_version (
               project_id, feature_id, version, name, business_domain, description, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              projectId,
              feature.id,
              feature.version,
              feature.name,
              feature.businessDomain,
              feature.description,
              feature.createdAt,
            ],
          );
        } else {
          const featureExists = await this.#database.query(
            `SELECT 1 FROM feature WHERE project_id = $1 AND id = $2`,
            [projectId, claim.featureId],
          );
          if (!featureExists.rows[0]) throw new PersistenceConflictError(`Feature ${claim.featureId} does not exist`);
        }
        await this.#database.query(
          `INSERT INTO claim_scope (
             project_id, id, version, scope, effective_from, effective_to, created_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            projectId,
            scope.id,
            scope.version,
            JSON.stringify(scope.scope),
            scope.effectiveFrom,
            scope.effectiveTo,
            scope.createdAt,
          ],
        );
        await this.#database.query(
          `INSERT INTO claim (
             project_id, id, version, feature_id, claim_type, statement, source_type,
             evidence_support, scope_id, scope_version, provenance, constraint_payload, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
          [
            projectId,
            claim.id,
            claim.version,
            claim.featureId,
            claim.type,
            claim.statement,
            claim.sourceType,
            claim.evidenceSupport,
            claim.scopeId,
            claim.scopeVersion,
            JSON.stringify(claim.provenance),
            JSON.stringify(claim.constraint),
            claim.createdAt,
          ],
        );
        await this.#database.query(
          `INSERT INTO human_decision (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             decision_type, content, actor_id, actor_role, evidence_refs, valid_until, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
          [
            projectId,
            decision.id,
            decision.claimId,
            decision.claimVersion,
            decision.scopeId,
            decision.scopeVersion,
            decision.type,
            decision.content,
            decision.actorId,
            decision.actorRole,
            JSON.stringify(decision.evidenceRefs),
            decision.validUntil,
            decision.createdAt,
          ],
        );
        await this.#database.query(
          `INSERT INTO implementation_mapping (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             snapshot_manifest_id, source_component_id, source_run_id, source_candidate_id,
             mapping_status, fact_refs, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
          [
            projectId,
            implementationMapping.id,
            implementationMapping.claimId,
            implementationMapping.claimVersion,
            implementationMapping.scopeId,
            implementationMapping.scopeVersion,
            implementationMapping.snapshotManifestId,
            implementationMapping.sourceComponentId,
            implementationMapping.sourceRunId,
            implementationMapping.sourceCandidateId,
            implementationMapping.status,
            JSON.stringify(implementationMapping.factRefs),
            implementationMapping.createdAt,
          ],
        );
        await this.#database.query(
          `INSERT INTO implementation_conformance (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             snapshot_manifest_id, status, evidence_refs, analysis_method, computed_at, mapping_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
          [
            projectId,
            conformance.id,
            conformance.claimId,
            conformance.claimVersion,
            conformance.scopeId,
            conformance.scopeVersion,
            conformance.snapshotManifestId,
            conformance.status,
            JSON.stringify(conformance.evidenceRefs),
            JSON.stringify(conformance.analysisMethod),
            conformance.computedAt,
            conformance.mappingId,
          ],
        );
      }

      await this.#database.query(
        `INSERT INTO reverse_candidate_review (
           project_id, id, request_fingerprint, run_id, candidate_id, candidate_type, outcome,
           rationale, actor_id, actor_role, acknowledged_conflict_ids,
           feature_id, claim_id, claim_version, decision_id,
           implementation_mapping_id, conformance_id, review_payload, reviewed_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
           $12, $13, $14, $15, $16, $17, $18::jsonb, $19
         )`,
        [
          projectId,
          review.id,
          review.requestFingerprint,
          review.runId,
          review.candidateId,
          review.candidateType,
          review.outcome,
          review.rationale,
          review.actorId,
          review.actorRole,
          JSON.stringify(review.acknowledgedConflictIds),
          review.baselineRefs?.featureId ?? null,
          review.baselineRefs?.claimId ?? null,
          review.baselineRefs?.claimVersion ?? null,
          review.baselineRefs?.decisionId ?? null,
          review.baselineRefs?.implementationMappingId ?? null,
          review.baselineRefs?.conformanceId ?? null,
          JSON.stringify(reviewPackage),
          review.reviewedAt,
        ],
      );
      return deepFreeze(structuredClone(reviewPackage));
    });
  }

  async getReverseCandidateReview(projectId, runId, candidateId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    requireId(candidateId, "candidateId");
    const result = await this.#database.query(
      `SELECT review_payload
       FROM reverse_candidate_review
       WHERE project_id = $1 AND run_id = $2 AND candidate_id = $3`,
      [projectId, runId, candidateId],
    );
    return result.rows[0] ? deepFreeze(result.rows[0].review_payload) : null;
  }

  async listReverseCandidateReviews(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const result = await this.#database.query(
      `SELECT review_payload
       FROM reverse_candidate_review
       WHERE project_id = $1 AND run_id = $2
       ORDER BY reviewed_at, id`,
      [projectId, runId],
    );
    return deepFreeze(result.rows.map((row) => row.review_payload));
  }

  async appendChangeImpact(projectId, changeImpact) {
    requireId(projectId, "projectId");
    const changeSet = changeImpact?.changeSet;
    const impact = changeImpact?.impact;
    requireId(changeSet?.id, "changeImpact.changeSet.id");
    requireId(impact?.id, "changeImpact.impact.id");
    if (impact.changeSetId !== changeSet.id) {
      throw new TypeError("changeImpact.impact.changeSetId must match changeImpact.changeSet.id");
    }

    return this.#transaction(async () => {
      await this.#database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${projectId}:change-set:${changeSet.id}`,
      ]);
      const existing = await this.#database.query(
        `SELECT ia.change_impact_payload
         FROM change_set cs
         JOIN impact_assessment ia
           ON ia.project_id = cs.project_id
          AND ia.change_set_id = cs.id
         WHERE cs.project_id = $1 AND cs.id = $2`,
        [projectId, changeSet.id],
      );
      if (existing.rows[0]) {
        const stored = existing.rows[0].change_impact_payload;
        if (canonicalJson(stored) !== canonicalJson(changeImpact)) {
          throw new PersistenceConflictError(
            `ChangeSet ${changeSet.id} conflicts with an existing immutable record`,
          );
        }
        return deepFreeze(stored);
      }

      for (const item of changeImpact.continuities ?? []) {
        const { implementationMapping, conformance } = item;
        await this.#database.query(
          `INSERT INTO implementation_mapping (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             snapshot_manifest_id, source_component_id, source_run_id, source_candidate_id,
             mapping_status, fact_refs, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
          [
            projectId,
            implementationMapping.id,
            implementationMapping.claimId,
            implementationMapping.claimVersion,
            implementationMapping.scopeId,
            implementationMapping.scopeVersion,
            implementationMapping.snapshotManifestId,
            implementationMapping.sourceComponentId,
            implementationMapping.sourceRunId,
            implementationMapping.sourceCandidateId,
            implementationMapping.status,
            JSON.stringify(implementationMapping.factRefs),
            implementationMapping.createdAt,
          ],
        );
        await this.#database.query(
          `INSERT INTO implementation_conformance (
             project_id, id, claim_id, claim_version, scope_id, scope_version,
             snapshot_manifest_id, status, evidence_refs, analysis_method, computed_at, mapping_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
          [
            projectId,
            conformance.id,
            conformance.claimId,
            conformance.claimVersion,
            conformance.scopeId,
            conformance.scopeVersion,
            conformance.snapshotManifestId,
            conformance.status,
            JSON.stringify(conformance.evidenceRefs),
            JSON.stringify(conformance.analysisMethod),
            conformance.computedAt,
            conformance.mappingId,
          ],
        );
      }

      await this.#database.query(
        `INSERT INTO change_set (
           project_id, id, from_snapshot_manifest_id, to_snapshot_manifest_id,
           complete, warnings, changes, change_set_payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
        [
          projectId,
          changeSet.id,
          changeSet.fromSnapshotManifestId,
          changeSet.toSnapshotManifestId,
          changeSet.complete,
          JSON.stringify(changeSet.warnings),
          JSON.stringify(changeSet.changes),
          JSON.stringify(changeSet),
          changeSet.createdAt,
        ],
      );
      await this.#database.query(
        `INSERT INTO impact_assessment (
           project_id, id, change_set_id, impact_payload, change_impact_payload, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [
          projectId,
          impact.id,
          impact.changeSetId,
          JSON.stringify(impact),
          JSON.stringify(changeImpact),
          impact.createdAt,
        ],
      );
      for (const invalidation of impact.invalidations) {
        await this.#database.query(
          `INSERT INTO trace_invalidation_event (
             project_id, id, change_set_id, feature_id, claim_id, claim_version, scope_id, scope_version,
             mapping_id, test_spec_ids, change_ids, invalidated_layers,
             preserved_layers, recommended_actions, reason, occurred_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
             $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
           )`,
          [
            projectId,
            invalidation.id,
            changeSet.id,
            invalidation.featureId,
            invalidation.claimId,
            invalidation.claimVersion,
            invalidation.scopeId,
            invalidation.scopeVersion,
            invalidation.mappingId,
            JSON.stringify(invalidation.testSpecIds),
            JSON.stringify(invalidation.changeIds),
            JSON.stringify(invalidation.layers),
            JSON.stringify(invalidation.preserves),
            JSON.stringify(invalidation.recommendedActions),
            invalidation.reason,
            impact.createdAt,
          ],
        );
      }
      for (const item of changeImpact.continuities ?? []) {
        const continuity = item.continuity;
        await this.#database.query(
          `INSERT INTO implementation_continuity_event (
             project_id, id, change_set_id, feature_id, claim_id, claim_version,
             scope_id, scope_version, from_snapshot_manifest_id, to_snapshot_manifest_id,
             from_mapping_id, to_mapping_id, from_conformance_id, to_conformance_id,
             fact_ref_rebindings, reason, occurred_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15::jsonb, $16, $17
           )`,
          [
            projectId,
            continuity.id,
            changeSet.id,
            continuity.featureId,
            continuity.claimId,
            continuity.claimVersion,
            continuity.scopeId,
            continuity.scopeVersion,
            continuity.fromSnapshotManifestId,
            continuity.toSnapshotManifestId,
            continuity.fromMappingId,
            continuity.toMappingId,
            continuity.fromConformanceId,
            continuity.toConformanceId,
            JSON.stringify(continuity.factRefRebindings),
            continuity.reason,
            impact.createdAt,
          ],
        );
      }
      return deepFreeze(structuredClone(changeImpact));
    });
  }

  async getChangeImpact(projectId, changeSetId) {
    requireId(projectId, "projectId");
    requireId(changeSetId, "changeSetId");
    const result = await this.#database.query(
      `SELECT ia.change_impact_payload
       FROM change_set cs
       JOIN impact_assessment ia
         ON ia.project_id = cs.project_id
        AND ia.change_set_id = cs.id
       WHERE cs.project_id = $1 AND cs.id = $2`,
      [projectId, changeSetId],
    );
    if (!result.rows[0]) return null;
    return deepFreeze(result.rows[0].change_impact_payload);
  }

  async saveAnalysisCheckpoint(projectId, checkpoint) {
    requireId(projectId, "projectId");
    requireId(checkpoint?.run?.id, "checkpoint.run.id");
    await this.#database.query(
      `INSERT INTO analysis_run_checkpoint (
         project_id, id, snapshot_manifest_id, status, request_payload, checkpoint_payload, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (project_id, id) DO UPDATE SET
         status = EXCLUDED.status,
         checkpoint_payload = EXCLUDED.checkpoint_payload,
         updated_at = EXCLUDED.updated_at`,
      [
        projectId,
        checkpoint.run.id,
        checkpoint.run.snapshotManifestId,
        checkpoint.run.status,
        JSON.stringify(checkpoint.request),
        JSON.stringify(checkpoint),
        checkpoint.run.updatedAt,
      ],
    );
    return this.getAnalysisCheckpoint(projectId, checkpoint.run.id);
  }

  async getAnalysisCheckpoint(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const result = await this.#database.query(
      `SELECT checkpoint_payload FROM analysis_run_checkpoint WHERE project_id = $1 AND id = $2`,
      [projectId, runId],
    );
    return result.rows[0] ? deepFreeze(result.rows[0].checkpoint_payload) : null;
  }

  async appendAnalysisResult(projectId, result) {
    requireId(projectId, "projectId");
    requireId(result?.id, "analysisResult.id");
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO analysis_result (
           project_id, id, snapshot_manifest_id, baseline_run_id, status, result_payload, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (project_id, id) DO NOTHING`,
        [
          projectId,
          result.id,
          result.snapshotManifestId,
          result.baselineRunId,
          result.status,
          JSON.stringify(result),
          result.completedAt,
        ],
      );
      const stored = await this.getAnalysisResult(projectId, result.id);
      if (!stored || canonicalJson(stored) !== canonicalJson(result)) {
        throw new PersistenceConflictError(`Analysis result ${result.id} conflicts with an existing immutable result`);
      }
      return stored;
    });
  }

  async getAnalysisResult(projectId, runId) {
    requireId(projectId, "projectId");
    requireId(runId, "runId");
    const result = await this.#database.query(
      `SELECT result_payload FROM analysis_result WHERE project_id = $1 AND id = $2`,
      [projectId, runId],
    );
    return result.rows[0] ? deepFreeze(result.rows[0].result_payload) : null;
  }

  async listAnalysisResults(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT result_payload FROM analysis_result WHERE project_id = $1 ORDER BY completed_at DESC, id`,
      [projectId],
    );
    return deepFreeze(result.rows.map((row) => row.result_payload));
  }

  async getLatestAnalysisResult(projectId) {
    return (await this.listAnalysisResults(projectId))[0] ?? null;
  }

  async appendUnderstandingRecord(projectId, recordType, record) {
    requireId(projectId, "projectId");
    requireId(recordType, "recordType");
    requireId(record?.id, "record.id");
    const createdAt = record.createdAt ?? record.completedAt ?? record.decidedAt
      ?? record.producedAt ?? record.requestedAt ?? record.updatedAt ?? new Date().toISOString();
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO understanding_record (
           project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (project_id, record_type, id) DO NOTHING`,
        [
          projectId,
          recordType,
          record.id,
          record.snapshotManifestId ?? null,
          record.analysisRunId ?? null,
          record.status ?? null,
          JSON.stringify(record),
          createdAt,
        ],
      );
      const stored = await this.getUnderstandingRecord(projectId, recordType, record.id);
      if (!stored || canonicalJson(stored) !== canonicalJson(record)) {
        throw new PersistenceConflictError(`${recordType} ${record.id} conflicts with an existing immutable record`);
      }
      return stored;
    });
  }

  async appendUnderstandingRecordWithCas(projectId, recordType, record, { headKey = recordType, expectedVersion }) {
    requireId(projectId, "projectId");
    requireId(recordType, "recordType");
    requireId(headKey, "headKey");
    requireId(record?.id, "record.id");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
    const createdAt = record.createdAt ?? new Date().toISOString();
    return this.#transaction(async () => {
      await this.#database.query(
        `INSERT INTO workspace_capability_head (project_id, head_key, version, record_id)
         VALUES ($1, $2, 0, NULL) ON CONFLICT (project_id, head_key) DO NOTHING`,
        [projectId, headKey],
      );
      const advanced = await this.#database.query(
        `UPDATE workspace_capability_head SET version = version + 1, record_id = $4
         WHERE project_id = $1 AND head_key = $2 AND version = $3 RETURNING version`,
        [projectId, headKey, expectedVersion, record.id],
      );
      if (advanced.rows.length !== 1) {
        const current = await this.#database.query(
          `SELECT version FROM workspace_capability_head WHERE project_id = $1 AND head_key = $2`,
          [projectId, headKey],
        );
        throw new PersistenceConflictError(`${headKey} version conflict: expected ${expectedVersion}, current ${current.rows[0]?.version ?? 0}`);
      }
      await this.#database.query(
        `INSERT INTO understanding_record (
           project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [projectId, recordType, record.id, record.snapshotManifestId ?? null, record.analysisRunId ?? null, record.status ?? null, JSON.stringify(record), createdAt],
      );
      return deepFreeze(structuredClone(record));
    });
  }

  async appendWorkspaceAnalysisJobCheckpoint(projectId, checkpoint) {
    requireId(projectId, "projectId");
    requireId(checkpoint?.jobId, "checkpoint.jobId");
    return this.#transaction(async () => {
      await this.#database.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${projectId}:${checkpoint.jobId}`],
      );
      const existing = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'WORKSPACE_ANALYSIS_JOB'
           AND record_payload->>'jobId' = $2`,
        [projectId, checkpoint.jobId],
      );
      const records = existing.rows.map(({ record_payload: record }) => record);
      const terminal = records
        .filter(({ state }) => ["CANCELLED", "FAILED", "COMPLETED"].includes(state.status))
        .sort((left, right) => left.checkpointSequence - right.checkpointSequence)[0];
      if (terminal) return deepFreeze(terminal);
      const currentSequence = Math.max(0, ...records.map(({ checkpointSequence }) => checkpointSequence));
      if (checkpoint.checkpointSequence !== currentSequence + 1 && checkpoint.state.status !== "CANCELLED") {
        return deepFreeze(records.sort((left, right) => right.checkpointSequence - left.checkpointSequence)[0]);
      }
      const sequence = currentSequence + 1;
      const normalized = {
        ...structuredClone(checkpoint),
        id: contentId("WORKSPACE-ANALYSIS-JOB-CHECKPOINT", {
          jobId: checkpoint.jobId,
          checkpointSequence: sequence,
          status: checkpoint.state.status,
          phase: checkpoint.state.phase,
          completedPhases: checkpoint.state.completedPhases,
          outputs: checkpoint.state.outputs,
        }),
        checkpointSequence: sequence,
      };
      const createdAt = normalized.createdAt ?? normalized.state.updatedAt;
      await this.#database.query(
        `INSERT INTO understanding_record (
           project_id, record_type, id, snapshot_manifest_id, analysis_run_id, status, record_payload, created_at
         ) VALUES ($1, 'WORKSPACE_ANALYSIS_JOB', $2, $3, $4, $5, $6::jsonb, $7)`,
        [projectId, normalized.id, normalized.snapshotManifestId, normalized.analysisRunId,
          normalized.state.status, JSON.stringify(normalized), createdAt],
      );
      return deepFreeze(normalized);
    });
  }

  async getUnderstandingRecord(projectId, recordType, recordId) {
    requireId(projectId, "projectId");
    requireId(recordType, "recordType");
    requireId(recordId, "recordId");
    const result = await this.#database.query(
      `SELECT record_payload FROM understanding_record
       WHERE project_id = $1 AND record_type = $2 AND id = $3`,
      [projectId, recordType, recordId],
    );
    return result.rows[0] ? deepFreeze(result.rows[0].record_payload) : null;
  }

  async listUnderstandingRecords(projectId, recordType) {
    requireId(projectId, "projectId");
    requireId(recordType, "recordType");
    const result = await this.#database.query(
      `SELECT record_payload FROM understanding_record
       WHERE project_id = $1 AND record_type = $2
       ORDER BY created_at DESC, id`,
      [projectId, recordType],
    );
    return deepFreeze(result.rows.map((row) => row.record_payload));
  }

  async consumeSourceSliceWorkerCredential(projectId, consumption) {
    requireId(projectId, "projectId");
    requireId(consumption?.credentialId, "consumption.credentialId");
    const result = await this.#database.query(
      `INSERT INTO source_slice_worker_credential_use (
         project_id, credential_id, analysis_run_id, work_unit_id, route_decision_id, consumed_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, credential_id) DO NOTHING
       RETURNING credential_id`,
      [
        projectId,
        consumption.credentialId,
        consumption.analysisRunId,
        consumption.workUnitId,
        consumption.routeDecisionId,
        consumption.consumedAt,
      ],
    );
    if (result.rows.length === 0) {
      throw new PersistenceConflictError("SourceSlice worker credential has already been consumed");
    }
    return deepFreeze(structuredClone(consumption));
  }

  async getCurrentGraphHead(projectId) {
    requireId(projectId, "projectId");
    const result = await this.#database.query(
      `SELECT project_id, graph_revision_id, version, updated_at
       FROM current_graph_head WHERE project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? deepFreeze({
      projectId: row.project_id,
      graphRevisionId: row.graph_revision_id,
      version: Number(row.version),
      updatedAt: new Date(row.updated_at).toISOString(),
    }) : null;
  }

  async publishGraphRevision(projectId, revisionId, expectedHeadVersion = 0) {
    requireId(projectId, "projectId");
    requireId(revisionId, "revisionId");
    if (!Number.isSafeInteger(expectedHeadVersion) || expectedHeadVersion < 0) {
      throw new TypeError("expectedHeadVersion must be a non-negative integer");
    }
    return this.#transaction(async () => {
      const headResult = await this.#database.query(
        `SELECT graph_revision_id, version FROM current_graph_head
         WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      );
      const current = headResult.rows[0] ?? null;
      const currentVersion = current ? Number(current.version) : 0;
      if (currentVersion !== expectedHeadVersion) {
        throw new PersistenceConflictError(
          `CurrentGraphHead version ${currentVersion} does not match ${expectedHeadVersion}`,
        );
      }
      const revisionResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'GRAPH_REVISION' AND id = $2 FOR UPDATE`,
        [projectId, revisionId],
      );
      const revision = revisionResult.rows[0]?.record_payload;
      if (!revision) throw new PersistenceConflictError(`GraphRevision ${revisionId} does not exist`);
      if (revision.status !== "EVALUATING") throw new PersistenceConflictError("GraphRevision must be EVALUATING");
      if (revision.reanalysisOfGraphRevisionId !== undefined) {
        throw new PersistenceConflictError("Historical reanalysis GraphRevision must use historical publication");
      }
      const evaluationResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'EVALUATION_RUN' AND id = $2`,
        [projectId, revision.evaluationRunId],
      );
      try {
        assertEvaluationPublicationReady(evaluationResult.rows[0]?.record_payload);
      } catch (error) {
        throw new PersistenceConflictError(error.message, { cause: error });
      }
      const graphArtifactResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'GRAPH_ARTIFACT' AND id = $2`,
        [projectId, revision.graphArtifactId],
      );
      const graphArtifact = graphArtifactResult.rows[0]?.record_payload;
      if (!graphArtifact || graphArtifact.graphArtifactDigest !== revision.graphArtifactDigest
        || graphArtifact.projectId !== projectId
        || graphArtifact.snapshotManifestId !== revision.snapshotManifestId
        || graphArtifact.analysisRunId !== revision.analysisRunId) {
        throw new PersistenceConflictError("GraphRevision immutable graph artifact is missing or mismatched");
      }
      if (!current && revision.mode !== "FULL") {
        throw new PersistenceConflictError("The first published GraphRevision must be FULL");
      }
      if (current && revision.mode === "INCREMENTAL" && revision.baseRevisionId !== current.graph_revision_id) {
        throw new PersistenceConflictError("Incremental GraphRevision must use the current head as its base");
      }
      const publishedAt = new Date().toISOString();
      const published = { ...revision, status: "PUBLISHED", publishedAt };
      await this.#database.query(
        `UPDATE understanding_record
         SET status = 'PUBLISHED', record_payload = $3::jsonb
         WHERE project_id = $1 AND record_type = 'GRAPH_REVISION' AND id = $2`,
        [projectId, revisionId, JSON.stringify(published)],
      );
      await this.#database.query(
        `INSERT INTO current_graph_head (project_id, graph_revision_id, version, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id) DO UPDATE SET
           graph_revision_id = EXCLUDED.graph_revision_id,
           version = EXCLUDED.version,
           updated_at = EXCLUDED.updated_at`,
        [projectId, revisionId, currentVersion + 1, publishedAt],
      );
      await this.#database.query(
        `INSERT INTO current_graph_head_event (project_id, version, graph_revision_id, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [projectId, currentVersion + 1, revisionId, publishedAt],
      );
      return this.getCurrentGraphHead(projectId);
    });
  }

  async publishHistoricalGraphRevision(projectId, revisionId, sourceRevisionId) {
    requireId(projectId, "projectId");
    requireId(revisionId, "revisionId");
    requireId(sourceRevisionId, "sourceRevisionId");
    return this.#transaction(async () => {
      const revisionResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'GRAPH_REVISION' AND id = $2 FOR UPDATE`,
        [projectId, revisionId],
      );
      const sourceRevisionResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'GRAPH_REVISION' AND id = $2 FOR UPDATE`,
        [projectId, sourceRevisionId],
      );
      const revision = revisionResult.rows[0]?.record_payload;
      const sourceRevision = sourceRevisionResult.rows[0]?.record_payload;
      if (!revision || revision.status !== "EVALUATING") {
        throw new PersistenceConflictError("Historical reanalysis GraphRevision must be EVALUATING");
      }
      if (!sourceRevision || sourceRevision.status !== "PUBLISHED") {
        throw new PersistenceConflictError(`Published source GraphRevision ${sourceRevisionId} does not exist`);
      }
      if (revision.reanalysisOfGraphRevisionId !== sourceRevisionId
        || revision.snapshotManifestId !== sourceRevision.snapshotManifestId
        || revision.mode !== "FULL"
        || revision.baseRevisionId !== null) {
        throw new PersistenceConflictError("Historical reanalysis must be FULL and bound to its source Revision Snapshot");
      }
      const evaluationResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'EVALUATION_RUN' AND id = $2`,
        [projectId, revision.evaluationRunId],
      );
      try {
        assertEvaluationPublicationReady(evaluationResult.rows[0]?.record_payload);
      } catch (error) {
        throw new PersistenceConflictError(error.message, { cause: error });
      }
      const graphArtifactResult = await this.#database.query(
        `SELECT record_payload FROM understanding_record
         WHERE project_id = $1 AND record_type = 'GRAPH_ARTIFACT' AND id = $2`,
        [projectId, revision.graphArtifactId],
      );
      const graphArtifact = graphArtifactResult.rows[0]?.record_payload;
      if (!graphArtifact || graphArtifact.graphArtifactDigest !== revision.graphArtifactDigest
        || graphArtifact.projectId !== projectId
        || graphArtifact.snapshotManifestId !== revision.snapshotManifestId
        || graphArtifact.analysisRunId !== revision.analysisRunId) {
        throw new PersistenceConflictError("Historical reanalysis graph artifact is missing or mismatched");
      }
      const published = {
        ...revision,
        status: "PUBLISHED",
        publishedAt: new Date().toISOString(),
      };
      await this.#database.query(
        `UPDATE understanding_record
         SET status = 'PUBLISHED', record_payload = $3::jsonb
         WHERE project_id = $1 AND record_type = 'GRAPH_REVISION' AND id = $2`,
        [projectId, revisionId, JSON.stringify(published)],
      );
      return deepFreeze(published);
    });
  }
}
