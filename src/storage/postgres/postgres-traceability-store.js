import { createHash } from "node:crypto";

import { canonicalJson, deepFreeze } from "../../domain/index.js";
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
           dimensions, stages, complete, computed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)`,
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
           evidence_support, scope_id, scope_version, provenance, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
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
          claim.createdAt,
        ],
      );
      const stored = await this.#database.query(
        `SELECT feature_id, claim_type, statement, source_type, evidence_support,
                scope_id, scope_version, provenance
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
        canonicalJson(row.provenance) !== canonicalJson(claim.provenance)
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

  async getFeatureBaseline(projectId, featureId) {
    requireId(projectId, "projectId");
    requireId(featureId, "featureId");
    const featureResult = await this.#database.query(
      `SELECT feature_id, version, name, business_domain, description, created_at
       FROM feature_version
       WHERE project_id = $1 AND feature_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [projectId, featureId],
    );
    const featureRow = featureResult.rows[0];
    if (!featureRow) return null;

    const claimResult = await this.#database.query(
      `SELECT DISTINCT ON (c.id)
         c.id, c.version, c.feature_id, c.claim_type, c.statement, c.source_type,
         c.evidence_support, c.scope_id, c.scope_version, c.provenance, c.created_at,
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
      traceChains: chainResult.rows.map((row) => ({
        id: row.chain_id,
        revision: Number(row.revision),
        claimId: row.claim_id,
        claimVersion: row.claim_version,
        complete: row.complete,
        dimensions: row.dimensions,
        computedAt: new Date(row.computed_at).toISOString(),
      })),
    });
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
}
