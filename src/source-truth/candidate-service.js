import { canonicalEncode, orderedArrayDigest, structureDigest } from "./identity.js";
import { requireValue } from "./errors.js";

function gapsFor(sourceId, entry, disposition) {
  const gaps = disposition.gaps.map((input) => {
    requireValue(input.severity === "NON_BLOCKING" && ["GIT_LFS_EXTERNAL", "GIT_SUBMODULE_EXTERNAL"].includes(input.ruleCode),
      "SOURCE_BLOCKING_GAP", "存在阻断条件或非平台授权的 Gap 规则，不能接受后继续");
    const evidence = { sourceId, pathBytes: entry.pathBytes, ruleCode: input.ruleCode, severity: "NON_BLOCKING",
      ruleVersion: input.ruleVersion, affectedScope: input.affectedScope, externalReference: input.externalReference ?? null };
    requireValue(input.ruleVersion === "v1" && evidence.affectedScope !== undefined, "SOURCE_BLOCKING_GAP", "Gap 规则版本或范围不明确");
    return { gapKey: structureDigest("gaps", evidence), ...evidence };
  }).sort((a, b) => a.ruleCode.localeCompare(b.ruleCode, "en"));
  requireValue(new Set(gaps.map((gap) => gap.gapKey)).size === gaps.length, "SOURCE_BLOCKING_GAP", "同一条目含重复 Gap");
  return gaps;
}

export class SourceCandidateService {
  constructor(repository, materials, blobs) { Object.assign(this, { repository, materials, blobs }); }

  async *rows(context) {
    let after = null;
    do {
      const page = await this.materials.entries(context, { after, limit: 500 });
      for (const row of page.items) yield row;
      after = page.nextCursor;
    } while (after);
  }

  async *coverage(context, { verify = false, scope } = {}) {
    let count = 0;
    for await (const { entry, disposition } of this.rows(context)) {
      requireValue(disposition, "SOURCE_INVENTORY_INCOMPLETE", "清单仍有未验证条目，不能准备冻结包");
      const gaps = gapsFor(context.sourceId, entry, disposition);
      if (verify && disposition.digest) requireValue(await this.blobs.verifyBlob(scope, { digest: disposition.digest, sizeBytes: disposition.sizeBytes }),
        "SOURCE_CONTENT_MISSING", "已引用内容缺失，不能以旧校验记录继续冻结");
      if (verify && ++count % 100 === 0) await this.repository.heartbeat(context);
      yield { sourceId: context.sourceId, pathBytes: entry.pathBytes, disposition: disposition.disposition,
        reasonCode: disposition.reasonCode, contentDigest: disposition.digest, sizeBytes: disposition.sizeBytes, gaps };
    }
  }

  async component(context, source, run, scope) {
    requireValue(source.enumeration_closed && source.manifest_id, "SOURCE_INVENTORY_INCOMPLETE", "来源清单尚未闭合");
    const counts = await this.materials.summary(context);
    requireValue(counts.pendingCount === "0", "SOURCE_INVENTORY_INCOMPLETE", "清单仍有未验证条目");
    const manifestId = await orderedArrayDigest("manifest", { kind: source.kind }, "entries", this.materials.entryStream(context));
    requireValue(manifestId === source.manifest_id, "SOURCE_MANIFEST_CORRUPT", "清单摘要与冻结记录不符");
    const coverageId = await orderedArrayDigest("coverage", {}, "entries", this.coverage(context, { verify: true, scope }));
    const payload = { workspaceId: context.workspaceId, sourceId: context.sourceId, kind: source.kind,
      nativeIdentity: source.kind === "GIT" ? source.source.nativeIdentity : { manifestId },
      scope: source.source.scope, manifestId, coverageId, policyRevisionId: run.policyRevisionId };
    const id = structureDigest("component", payload);
    const existing = await this.repository.database.query("SELECT * FROM source_truth_component WHERE workspace_id=$1 AND id=$2", [context.workspaceId, id]);
    if (existing.rows[0]) return { id, ...existing.rows[0].payload, ...existing.rows[0].counts };
    let gapCount = 0n;
    let batch = [];
    const save = async () => {
      if (!batch.length) return;
      await this.repository.withLease(context, async (tx) => {
        await tx.query(`INSERT INTO source_truth_component_gap (workspace_id,component_id,gap_key,evidence)
          SELECT $1,$2,r->>'gapKey',r FROM jsonb_array_elements($3::jsonb) r ON CONFLICT DO NOTHING`, [context.workspaceId, id, JSON.stringify(batch)]);
      });
      batch = [];
    };
    for await (const row of this.coverage(context)) {
      for (const gap of row.gaps) { batch.push(gap); gapCount++; }
      if (batch.length >= 500) await save();
    }
    await save();
    const finalCounts = { fileCount: counts.fileCount, directoryCount: counts.directoryCount, knownBytes: counts.knownBytes, gapCount: String(gapCount) };
    await this.repository.withLease(context, async (tx) => {
      await tx.query(`INSERT INTO source_truth_component (workspace_id,id,run_id,source_id,payload,counts)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [context.workspaceId, id, context.runId, context.sourceId, JSON.stringify(payload), JSON.stringify(finalCounts)]);
    });
    return { id, ...payload, ...finalCounts };
  }

  async componentRows(workspaceId, componentId) {
    const { rows } = await this.repository.database.query("SELECT run_id,source_id FROM source_truth_component WHERE workspace_id=$1 AND id=$2", [workspaceId, componentId]);
    requireValue(rows[0], "SOURCE_CONTENT_MISSING", "组件完成记录缺失");
    return { workspaceId, runId: rows[0].run_id, sourceId: rows[0].source_id };
  }

  async *inventory(workspaceId, components) {
    for (const component of [...components].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const context = await this.componentRows(workspaceId, component.id);
      for await (const { entry, disposition } of this.rows(context)) {
        yield { componentId: component.id, manifestId: component.manifestId, pathBytes: entry.pathBytes,
          entry, disposition: disposition.disposition, reasonCode: disposition.reasonCode, contentDigest: disposition.digest, sizeBytes: disposition.sizeBytes };
      }
    }
  }

  async *gaps(workspaceId, componentIds) {
    let after = "";
    while (true) {
      const { rows } = await this.repository.database.query(`SELECT gap_key,evidence FROM source_truth_component_gap
        WHERE workspace_id=$1 AND component_id=ANY($2::text[]) AND gap_key>$3 ORDER BY gap_key LIMIT 500`, [workspaceId, componentIds, after]);
      for (const row of rows) yield row.evidence;
      if (rows.length < 500) return;
      after = rows.at(-1).gap_key;
    }
  }

  async prepare(context) {
    const { run, scope } = await this.repository.withLease(context, async (tx, run) => {
      requireValue(["RECONCILING", "REVIEW_REQUIRED"].includes(run.status), "SOURCE_INVALID_TRANSITION", "请先完成材料采集与对账");
      const access = await tx.query("SELECT tenant_id FROM source_truth_workspace WHERE workspace_id=$1", [context.workspaceId]);
      return { run, scope: { workspaceId: context.workspaceId, tenantId: access.rows[0].tenant_id } };
    });
    const sources = await this.repository.database.query("SELECT * FROM source_truth_run_source WHERE workspace_id=$1 AND run_id=$2 ORDER BY CASE kind WHEN 'GIT' THEN 0 ELSE 1 END", [context.workspaceId, context.runId]);
    requireValue(sources.rows.length > 0 && sources.rows.length === run.input.sources.length, "SOURCE_INVENTORY_INCOMPLETE", "有来源尚未建立完整清单");
    const components = [];
    for (const source of sources.rows) components.push(await this.component({ ...context, sourceId: source.source_id }, source, run, scope));
    const inventoryId = await orderedArrayDigest("inventory", {}, "entries", this.inventory(context.workspaceId, components));
    const gapSetId = await orderedArrayDigest("gaps", {}, "entries", this.gaps(context.workspaceId, components.map((component) => component.id)));
    const payload = { workspaceId: context.workspaceId, policyRevisionId: run.policyRevisionId,
      components: components.map(({ id, sourceId, kind }) => ({ id, sourceId, kind })), inventoryId, gapSetId };
    const counts = Object.fromEntries(["fileCount", "directoryCount", "knownBytes", "gapCount"].map((key) => [key, String(components.reduce((sum, component) => sum + BigInt(component[key]), 0n))]));
    const id = structureDigest("bundle", payload);
    await this.repository.withLease(context, async (tx) => {
      await tx.query(`INSERT INTO source_truth_prepared_bundle (workspace_id,run_id,id,payload,counts) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING`, [context.workspaceId, context.runId, id, JSON.stringify(payload), JSON.stringify(counts)]);
      const stored = await tx.query("SELECT id,payload FROM source_truth_prepared_bundle WHERE workspace_id=$1 AND run_id=$2", [context.workspaceId, context.runId]);
      requireValue(stored.rows[0].id === id && canonicalEncode(stored.rows[0].payload) === canonicalEncode(payload), "SOURCE_CANDIDATE_CONFLICT", "任务已有不同的冻结候选");
    });
    return { id, ...payload, ...counts };
  }
}
