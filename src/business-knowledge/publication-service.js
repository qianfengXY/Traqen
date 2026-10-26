import { createHash, randomUUID } from "node:crypto";
import { canonicalEncode, structureDigest } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";
import { PublicationAuthority, publicationDigest as digest } from "./publication-authority.js";
import { resolveF003ImplementationVersion } from "./implementation-version.js";
import { assessGraphQuality, inventoryEntryIdentity, comparisonContractDigest } from "./quality-contract-adapter.js";
import {readCheckpointDocument} from './checkpoint-storage.js';
import {intactBusinessGraph as intactGraph} from './semantic-graph.js';

const key = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const headView = row => row ? { projectId: row.project_id, graphRevisionId: row.graph_revision_id, version: Number(row.version), updatedAt: new Date(row.updated_at).toISOString() } : null;
function qualityAssessment(record, graph, policy) {
  const report = record.document.payload.quality, missing = [];
  if (!report || report.measurementKind !== "INDEPENDENT_REVIEW" || !/^[a-f0-9]{64}$/.test(report.truthSetDigest ?? "")
    || !Array.isArray(report.measurementRefs) || !report.measurementRefs.length
    || !report.equivalence || report.equivalence.kind !== "MEASURED_REPLAY_AND_INCREMENTAL") return [{ code: "F003_QUALITY_REPORT_INCOMPLETE" }];
  for (const [dimension, minimum] of Object.entries(policy.minimumDenominators)) {
    const n = report.denominators?.[dimension];
    if (!Number.isSafeInteger(n) || n < minimum) missing.push({ code: "F003_QUALITY_DENOMINATOR", dimension, actual: n ?? null, minimum });
  }
  for (const [dimension, threshold] of Object.entries(policy.thresholds)) {
    const n = report.metrics?.[dimension];
    if (!Number.isFinite(n) || n < 0 || n > 1 || (dimension === "forbiddenRelationshipViolations" ? n > threshold : n < threshold))
      missing.push({ code: "F003_QUALITY_THRESHOLD", dimension, actual: Number.isFinite(n) ? n : null, threshold });
  }
  if (report.denominators?.candidateSample > graph.candidates.length || report.denominators?.inventory !== graph.coverage.length)
    missing.push({ code: "F003_QUALITY_OUTPUT_MISMATCH" });
  return missing;
}

export class F003PublicationService {
  constructor({ sources, sourceReader = null, authority = new PublicationAuthority(), backup = null, implementationResolver = resolveF003ImplementationVersion }) {
    Object.assign(this, { sources, sourceReader, authority, backup, implementationResolver });
    // Only an explicit, validated deployment selection reaches this branch.
    // Default null remains blocked; signed reports and HTTP cannot choose rules.
    this.qualityPolicy = authority.qualityPolicy ?? null;
  }
  async #with(actor, workspaceId, maintain, work) {
    return this.sources.withWorkspace(actor, workspaceId, maintain, async (tx, access) => {
      requireF003(access.restoreReady, "F003_RESTORE_UNVERIFIED", "配套恢复尚未核验，不能访问发布链路");
      requireF003(!maintain || !access.backupBarrier, "F003_BACKUP_BARRIER", "备份围栏期间暂缓发布写入");
      return work(tx, access);
    });
  }
  async #sourceManifest(tx, workspaceId, sourceInput, scope) {
    const ids=scope?.componentIds??[],components=(sourceInput.components??[])
      .filter(c=>ids.includes(c.componentSnapshotId))
      .map(({componentSnapshotId,kind,manifestId,nativeIdentity})=>({componentSnapshotId,kind,manifestId,nativeIdentity}))
      .sort((a,b)=>a.componentSnapshotId.localeCompare(b.componentSnapshotId));
    const from=`FROM source_truth_bundle_component b
      JOIN source_truth_component c ON c.workspace_id=b.workspace_id AND c.id=b.component_id
      JOIN source_truth_entry e ON e.workspace_id=c.workspace_id AND e.run_id=c.run_id AND e.source_id=c.source_id
      WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND c.id=ANY($3::text[])`;
    const params=[workspaceId,sourceInput.sourceBundleSnapshotId,ids];
    const count=Number((await tx.query(`SELECT count(*) AS n ${from}`,params)).rows[0].n);
    // Bounded metadata-only projection, in this owning transaction; no raw
    // reads, nested workspace transactions, model calls, audit inserts or TTL.
    if(!count || count>200000 || components.length!==ids.length)return null;
    const hash=createHash('sha256'),coverage=createHash('sha256');let after=null,seen=0;
    for(;;) {
      const rows=(await tx.query(`SELECT c.id,e.entry,e.disposition ${from}
        AND ($4::text IS NULL OR c.id>$4 OR (c.id=$4 AND e.path_bytes>$5))
        ORDER BY c.id,e.path_bytes LIMIT 1000`,[...params,after?.id??null,after?.path??null])).rows;
      for(const r of rows) {
        hash.update(canonicalEncode({componentId:r.id,pathBytes:r.entry.pathBytes,kind:r.entry.kind,
          contentDigest:r.disposition?.digest??null,sizeBytes:r.entry.sizeBytes??null,
          disposition:r.disposition?.disposition??'PENDING'})).update('\n');
        const locator={componentId:r.id,pathBytes:r.entry.pathBytes};
        coverage.update(canonicalEncode(inventoryEntryIdentity({key:digest(locator),...locator,kind:r.entry.kind,
          disposition:r.disposition?.disposition??'PENDING',reasonCode:r.disposition?.reasonCode??'UNKNOWN',
          sizeBytes:r.disposition?.sizeBytes??r.entry.sizeBytes??null,
          materialId:r.disposition?.digest ? structureDigest('material',{workspaceId,bundleId:sourceInput.sourceBundleSnapshotId,
            ...locator,contentDigest:r.disposition.digest}) : null}))).update('\n');
      }
      seen+=rows.length;
      if(rows.length<1000)break;
      after={id:rows.at(-1).id,path:Buffer.from(rows.at(-1).entry.pathBytes,'base64url')};
    }
    if(seen!==count)return null;
    return {version:1,components,entryCount:count,entriesDigest:hash.digest('hex'),coverageDigest:coverage.digest('hex')};
  }
  async #analysis(tx, actor, workspaceId, id) {
    const row = (await tx.query("SELECT * FROM f003_investigation WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id])).rows[0];
    requireF003(row, "F003_INVESTIGATION_NOT_FOUND", "未找到此调查", { status: 404 });
    requireF003(row.actor_id === actor.actorId || row.payload.delegateActorIds.includes(actor.actorId), "F003_INVESTIGATION_FORBIDDEN", "当前成员未获此调查委派", { status: 403 });
    const ref = row.payload.latestGraph;
    const checkpoint = ref && (await tx.query("SELECT payload,created_at FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2 AND generation=$3 AND checkpoint_key='graph'", [workspaceId, id, ref.generation])).rows[0];
    const graph=checkpoint&&await readCheckpointDocument(tx,row,{generation:ref.generation,key:'graph',payload:checkpoint.payload});
    requireF003(graph && ref && graph.digest === ref.digest, "F003_GRAPH_NOT_FOUND", "调查尚无完整分析图谱", { status: 404 });
    requireF003(intactGraph(graph) && graph.workspaceId === workspaceId && graph.investigationId === id
      && graph.sourceBundleId === row.source_input.sourceBundleSnapshotId && graph.profileId === row.profile.id
      && canonicalEncode(graph.adoptedVersionIds) === canonicalEncode(row.payload.adoptedVersionIds),
    "F003_VERSION_CORRUPT", "分析图谱的内容、来源或采用绑定不完整");
    const technicalVersions=[];
    for(const versionId of graph.adoptedVersionIds) {
      const technical=(await tx.query(`SELECT f.profile_id,f.record_digest,r.source_input FROM f002_fact_set f
        JOIN f002_run r ON r.workspace_id=f.workspace_id AND r.id=f.run_id
        WHERE f.workspace_id=$1 AND f.graph_version_id=$2`,[workspaceId,versionId])).rows[0];
      requireF003(technical && ['workspaceId','bundleId','sourceBundleSnapshotId','receiptId','confirmationId','inventoryId',
        'inventoryDigest','policyRevisionId','gapSetId','acceptanceRecordIds'].every(k=>
        canonicalEncode(technical.source_input[k]??null)===canonicalEncode(row.source_input[k]??null)),
      'F003_TECHNICAL_VERSION_MISMATCH','发布计量须绑定同一冻结来源的显式技术版本');
      technicalVersions.push({versionId,profileId:technical.profile_id,recordDigest:technical.record_digest});
    }
    const binding = { workspaceId, investigationId: id, graphDigest: graph.digest, sourceInput: row.source_input,
      questionDigest:digest(row.payload.question),budget:row.payload.budget,supplementBudget:row.payload.supplementBudget,
      admittedAt:new Date(row.created_at).toISOString(),
      investigationScope:row.payload.scope,
      sourceManifest:await this.#sourceManifest(tx,workspaceId,row.source_input,row.payload.scope),
      adoptedVersionIds: graph.adoptedVersionIds, profileId: graph.profileId,
      technicalVersions,
      modelRevisionIds: [row.profile.mainAgentSlot, ...row.profile.childAgentSlots].map(s => s.modelProfileRevisionId),
      implementationVersion: row.payload.implementationVersion ?? null };
    binding.runContractDigest=comparisonContractDigest(binding);
    return { row, graph, binding, collectedAt: new Date(checkpoint.created_at).toISOString() };
  }
  async #head(tx, workspaceId) {
    return headView((await tx.query("SELECT * FROM current_graph_head WHERE project_id=$1", [workspaceId])).rows[0]);
  }
  async #readiness(tx, actor, analysis, { historical = false } = {}) {
    const { graph, binding, collectedAt } = analysis, { workspaceId } = binding, missing = [], evidence = [];
    // Publication reads the recorded analysis; it is not a new model admission.
    // Check immutable F001 binding, without silently renewing expired consent.
    try {
      requireF003(this.sourceReader?.assertBinding, "F003_SOURCE_BINDING_UNVERIFIED", "原材料核验服务不可用");
      await this.sourceReader.assertBinding(workspaceId, { bundleId: binding.sourceInput.sourceBundleSnapshotId, receiptId: binding.sourceInput.receiptId }, tx);
    } catch { missing.push({ code: "F003_SOURCE_BINDING_UNVERIFIED" }); }
    const implementation = historical ? null : await this.implementationResolver();
    if (binding.implementationVersion?.status !== "VERIFIED" || (!historical && (implementation?.status !== "VERIFIED"
      || implementation.sourceDigest !== binding.implementationVersion.sourceDigest))) missing.push({ code: "F003_IMPLEMENTATION_UNVERIFIED" });
    const stored = (await tx.query("SELECT document FROM f003_publication_evidence WHERE workspace_id=$1 AND binding_digest=$2 ORDER BY imported_at,id", [workspaceId, digest(binding)])).rows;
    for (const item of stored) {
      try { evidence.push(this.authority.verify(item.document, binding)); } catch { missing.push({ code: "F003_EVIDENCE_UNTRUSTED" }); }
    }
    const policy = this.qualityPolicy;
    if (!policy) missing.push({ code: "F003_QUALITY_POLICY_UNCONFIRMED" });
    const qualities = evidence.filter(e => e.kind === "QUALITY"), recoveries = evidence.filter(e => e.kind === "RECOVERY");
    if (!qualities.length) missing.push({ code: "F003_INDEPENDENT_QUALITY_MISSING" });
    // The compatibility branch is used only by explicit isolated mechanism
    // fixtures; deployment configuration accepts only the allowlisted adapter.
    const assess=e=>policy.adapterId ? assessGraphQuality(e,graph,binding,policy,this.authority) : qualityAssessment(e,graph,policy);
    const quality = policy && qualities.find(e => assess(e).length === 0);
    if (policy && !quality && qualities.length) missing.push(...assess(qualities.at(-1)));
    let backup = null, recovery = null;
    if (this.backup && !this.backup.config?.volumeProbe) {
      try {
        await this.backup.ready();
        // F001.coverage() records health rows, so it is NOT a read primitive.
        // Verify the same authenticated target catalogue without mirroring or
        // writing health during GET, including while the backup barrier is held.
        const reference = { workspaceId, bundleId: binding.sourceInput.sourceBundleSnapshotId, receiptId: binding.sourceInput.receiptId };
        const candidates = (await tx.query(`SELECT s.id FROM source_truth_backup_member m JOIN source_truth_backup_set s ON s.id=m.backup_id
          WHERE m.workspace_id=$1 AND m.bundle_id=$2 AND m.receipt_id=$3 AND s.target_id=$4 ORDER BY s.completed_at DESC LIMIT 10`,
        [workspaceId, reference.bundleId, reference.receiptId, this.backup.config?.targetId ?? null])).rows;
        for (const candidate of candidates) {
          try {
            const proof = await this.backup.verify(candidate.id, reference);
            if (proof.included && Date.parse(proof.waterline.capturedAt) >= Date.parse(collectedAt)) {
              backup = { status: "COVERED", backupId: candidate.id, waterline: proof.waterline.capturedAt }; break;
            }
          } catch { /* Try another existing authenticated backup, never write. */ }
        }
        if (!backup) missing.push({ code: "F003_BACKUP_NOT_COVERED" });
        else recovery = recoveries.find(e => {
          const r = e.document.payload.recovery;
          return r?.kind === "REAL_NATIVE_PAIRED_RESTORE" && r.backupId === backup.backupId && r.waterline === backup.waterline
            && r.restoredGraphDigest === graph.digest && /^[a-f0-9]{64}$/.test(r.restoreReportDigest ?? "")
            && typeof r.restoreEventId === "string" && r.restoreEventId.length > 0;
        });
      } catch { missing.push({ code: "F003_BACKUP_UNVERIFIED" }); }
    } else missing.push({ code: this.backup?.config?.volumeProbe ? "F003_SYNTHETIC_PROTECTION_NOT_ACCEPTED" : "F003_BACKUP_UNAVAILABLE" });
    if (!recovery) missing.push({ code: "F003_PAIRED_RECOVERY_MISSING" });
    return { status: missing.length ? "BLOCKED" : "READY", binding, missing, currentHead: await this.#head(tx, workspaceId),
      policy: structuredClone(policy), evidenceRefs: { quality: quality?.id ?? null, recovery: recovery?.id ?? null, backupId: backup?.backupId ?? null } };
  }
  readiness(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, false, async (tx, access) => {
      const result = await this.#readiness(tx, actor, await this.#analysis(tx, actor, workspaceId, id));
      if (access.backupBarrier) result.missing.push({ code: "F003_BACKUP_BARRIER" });
      if (access.role !== "MAINTAIN") result.missing.push({ code: "F003_PUBLICATION_ROLE_REQUIRED" });
      result.status = result.missing.length ? "BLOCKED" : "READY";
      return { ...result, canPublish: result.status === "READY" };
    });
  }
  importEvidence(actor, workspaceId, id) {
    return this.#with(actor, workspaceId, true, async tx => {
      const { binding } = await this.#analysis(tx, actor, workspaceId, id), imported = await this.authority.read(binding);
      for (const r of imported.records) await tx.query(`INSERT INTO f003_publication_evidence (workspace_id,id,evidence_kind,issuer_id,binding_digest,document)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [workspaceId, r.id, r.kind, r.issuerId, r.bindingDigest, JSON.stringify(r.document)]);
      return { binding, importedEvidenceRefs: imported.records.map(({ id: evidenceId, kind, issuerId }) => ({ id: evidenceId, kind, issuerId })), diagnostics: imported.diagnostics };
    });
  }
  publish(actor, workspaceId, id, input) {
    requireF003(input && Object.keys(input).every(k => ["operationId", "expectedGraphDigest", "expectedHeadVersion"].includes(k))
      && key(input.operationId) && /^[a-f0-9]{64}$/.test(input.expectedGraphDigest ?? "")
      && Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0,
    "F003_INPUT_INVALID", "发布必须指定操作键、精确图谱摘要与当前头版本", { status: 422 });
    return this.#with(actor, workspaceId, true, async tx => {
      const requestDigest = digest({ id, input }), prior = (await tx.query("SELECT payload,request_digest FROM f003_publication WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3", [workspaceId, actor.actorId, input.operationId])).rows[0];
      if (prior) { requireF003(prior.request_digest === requestDigest, "F003_OPERATION_CONFLICT", "发布操作键已经绑定另一请求"); return { publication: prior.payload, head: await this.#head(tx, workspaceId), replayed: true }; }
      const analysis = await this.#analysis(tx, actor, workspaceId, id), current = await this.#head(tx, workspaceId);
      requireF003(analysis.graph.digest === input.expectedGraphDigest, "F003_GRAPH_CONFLICT", "选定分析图谱已变化");
      requireF003((current?.version ?? 0) === input.expectedHeadVersion, "F003_HEAD_CONFLICT", "当前图谱头已变化，请刷新后明确采用");
      const readiness = await this.#readiness(tx, actor, analysis);
      requireF003(readiness.status === "READY", "F003_PUBLICATION_BLOCKED", "发布条件尚未满足，请读取服务端就绪缺项", { details: { missing: readiness.missing } });
      const { graph, binding } = analysis, now = new Date().toISOString(), revisionId = `F003-REVISION-${randomUUID()}`, artifactId = `F003-ARTIFACT-${graph.digest}`;
      const artifact = { id: artifactId, kind: "BUSINESS_KNOWLEDGE", projectId: workspaceId, analysisRunId: id,
        graphArtifactDigest: graph.digest, sourceInput: binding.sourceInput, businessGraph: graph,
        nodes: [...graph.candidates, ...graph.materials].map(n => ({ ...n, id: n.id })),
        edges: graph.relations.map(e => ({ ...e, source: graph.candidates.find(n => n.key === e.sourceKey)?.id ?? e.sourceKey,
          target: graph.candidates.find(n => n.key === e.targetKey)?.id ?? e.targetKey })), featureTraceability: [], traceChains: [], createdAt: now };
      const revision = { id: revisionId, kind: "BUSINESS_KNOWLEDGE", projectId: workspaceId, analysisRunId: id,
        graphArtifactId: artifactId, graphArtifactDigest: graph.digest, sourceInput: binding.sourceInput, binding,
        baseRevisionId: current?.graphRevisionId ?? null, status: "PUBLISHED", evidenceRefs: readiness.evidenceRefs, createdAt: now, publishedAt: now };
      for (const [type, record] of [["GRAPH_ARTIFACT", artifact], ["GRAPH_REVISION", revision]]) {
        await tx.query(`INSERT INTO understanding_record
          (project_id,record_type,id,analysis_run_id,status,record_payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [workspaceId, type, record.id, id, type === "GRAPH_REVISION" ? "PUBLISHED" : null, JSON.stringify(record), now]);
        const saved = (await tx.query("SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type=$2 AND id=$3", [workspaceId, type, record.id])).rows[0]?.record_payload;
        requireF003(saved?.analysisRunId === id && saved.graphArtifactDigest === graph.digest
          && (type !== "GRAPH_ARTIFACT" || (intactGraph(saved.businessGraph) && canonicalEncode(saved.businessGraph) === canonicalEncode(graph))),
        "F003_VERSION_CORRUPT", "既有记录与本次不可变图谱不一致，不能发布");
      }
      const version = (current?.version ?? 0) + 1, publication = { id: randomUUID(), workspaceId, investigationId: id, actorId: actor.actorId,
        graphRevisionId: revisionId, graphDigest: graph.digest, headVersion: version, binding, evidenceRefs: readiness.evidenceRefs, publishedAt: now };
      await tx.query(`INSERT INTO f003_publication (workspace_id,id,investigation_id,actor_id,operation_id,request_digest,graph_revision_id,head_version,payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [workspaceId, publication.id, id, actor.actorId, input.operationId, requestDigest, revisionId, version, JSON.stringify(publication)]);
      const updated = await tx.query(`INSERT INTO current_graph_head (project_id,graph_revision_id,version,updated_at) VALUES ($1,$2,$3,$4)
        ON CONFLICT(project_id) DO UPDATE SET graph_revision_id=EXCLUDED.graph_revision_id,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at
        WHERE current_graph_head.version=$5 RETURNING version`, [workspaceId, revisionId, version, now, input.expectedHeadVersion]);
      requireF003(updated.rows.length === 1, "F003_HEAD_CONFLICT", "当前图谱头在发布期间变化，请刷新后明确采用");
      await tx.query("INSERT INTO current_graph_head_event (project_id,version,graph_revision_id,updated_at) VALUES ($1,$2,$3,$4)", [workspaceId, version, revisionId, now]);
      return { publication, head: await this.#head(tx, workspaceId), replayed: false };
    });
  }
  current(actor, workspaceId) {
    return this.#with(actor, workspaceId, false, async tx => {
      const head = await this.#head(tx, workspaceId);
      if (!head) return { head: null, publication: null, graph: null };
      const p = (await tx.query("SELECT payload FROM f003_publication WHERE workspace_id=$1 AND graph_revision_id=$2 ORDER BY head_version DESC LIMIT 1", [workspaceId, head.graphRevisionId])).rows[0];
      if (!p) return { head, publication: null, graph: null, reason: "LEGACY_GRAPH_HEAD" };
      return { head, ...await this.#version(tx, workspaceId, head.graphRevisionId) };
    });
  }
  versions(actor, workspaceId, { limit = 100 } = {}) {
    requireF003(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, "F003_INPUT_INVALID", "历史清单大小无效", { status: 422 });
    return this.#with(actor, workspaceId, false, async tx => (await tx.query("SELECT payload FROM f003_publication WHERE workspace_id=$1 ORDER BY head_version DESC LIMIT $2", [workspaceId, limit])).rows.map(r => r.payload));
  }
  async #version(tx, workspaceId, revisionId) {
    const p = (await tx.query("SELECT payload FROM f003_publication WHERE workspace_id=$1 AND graph_revision_id=$2 ORDER BY head_version DESC LIMIT 1", [workspaceId, revisionId])).rows[0];
    requireF003(p, "F003_VERSION_NOT_FOUND", "未找到已发布业务图谱版本", { status: 404 });
    const r = (await tx.query("SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='GRAPH_REVISION' AND id=$2", [workspaceId, revisionId])).rows[0]?.record_payload;
    const a = r && (await tx.query("SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='GRAPH_ARTIFACT' AND id=$2", [workspaceId, r.graphArtifactId])).rows[0]?.record_payload;
    requireF003(r?.status === "PUBLISHED" && intactGraph(a?.businessGraph) && a.businessGraph.digest === p.payload.graphDigest && a.graphArtifactDigest === r.graphArtifactDigest
      && canonicalEncode(r.binding) === canonicalEncode(p.payload.binding) && canonicalEncode(a.sourceInput) === canonicalEncode(p.payload.binding.sourceInput),
      "F003_VERSION_CORRUPT", "发布版本的不可变依据不完整");
    return { publication: p.payload, revision: r, graph: a.businessGraph };
  }
  version(actor, workspaceId, revisionId) { return this.#with(actor, workspaceId, false, tx => this.#version(tx, workspaceId, revisionId)); }

  // Internal composition boundary: consumers share the current ACL/restore/
  // backup fence and owning transaction, never open a nested authorization tx.
  withPublishedVersion(actor, workspaceId, revisionId, maintain, work) {
    return this.#with(actor, workspaceId, maintain, async tx => work(tx, await this.#version(tx, workspaceId, revisionId)));
  }

  // Trusted composition under the caller's existing Workspace transaction.
  // Historical graph quality remains bound to its original implementation;
  // new conversation model/config/runtime are pinned separately, never relabelled.
  conversationVersion(tx,workspaceId,revisionId) { return this.#version(tx,workspaceId,revisionId); }
  async conversationAdmission(tx,actor,workspaceId,revisionId) {
    const access=await this.sources.authorize(actor,workspaceId,true,tx);
    requireF003(access.restoreReady,"F003_RESTORE_UNVERIFIED","配套恢复尚未核验");
    requireF003(!access.backupBarrier,"F003_BACKUP_BARRIER","备份围栏期间暂缓真实工作写入");
    const version=await this.#version(tx,workspaceId,revisionId), binding=version.publication.binding;
    const checkpoint=(await tx.query(`SELECT generation,payload,created_at FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2 AND checkpoint_key='graph'
      AND (payload->>'digest'=$3 OR payload->>'logicalGraphDigest'=$3) ORDER BY generation DESC LIMIT 1`,[workspaceId,binding.investigationId,version.graph.digest])).rows[0];
    requireF003(checkpoint,"F003_VERSION_CORRUPT","已发布图谱缺少原分析检查点");
    const investigation=(await tx.query('SELECT * FROM f003_investigation WHERE workspace_id=$1 AND id=$2',[workspaceId,binding.investigationId])).rows[0];
    requireF003(investigation,"F003_VERSION_CORRUPT","已发布图谱缺少原调查绑定");
    const original=await readCheckpointDocument(tx,investigation,{generation:checkpoint.generation,key:'graph',payload:checkpoint.payload});
    requireF003(intactGraph(original)&&original.digest===version.graph.digest,"F003_VERSION_CORRUPT","已发布图谱与原检查点不符");
    const ready=await this.#readiness(tx,actor,{graph:version.graph,binding,collectedAt:new Date(checkpoint.created_at).toISOString()},{historical:true});
    requireF003(ready.status==='READY',"F003_SESSION_WRITE_BLOCKED","真实工作会话缺少可信试点／独立质量／配套恢复依据",{details:{missing:ready.missing}});
    return {binding:ready.binding,evidenceRefs:ready.evidenceRefs};
  }
}
