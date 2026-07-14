import { createHash } from "node:crypto";

import { canonicalJson, deepFreeze } from "../../domain/index.js";
import { TraceabilityStore } from "../traceability-store.js";

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
      throw error;
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
          throw new Error(`Snapshot component ${component.id} conflicts with an existing immutable record`);
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
        throw new Error(`Snapshot manifest ${manifest.id} conflicts with an existing immutable record`);
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
}
