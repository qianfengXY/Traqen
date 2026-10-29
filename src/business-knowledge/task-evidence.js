import { createHash } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";

const hash = value => createHash("sha256").update(canonicalEncode(value)).digest("hex");
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === "string" ? value : null;
const number = value => Number.isSafeInteger(value) ? value : null;

// Read projection only. Never return a checkpoint's raw input, prompt, model
// response or internal execution envelope. The service owns ACL/version reads.
export function projectTaskEvidence(run, { graph = null, checkpoints = [] } = {}) {
  const currentBinding = Number.isSafeInteger(run.analysisContractVersion) ? hash({ analysisContractVersion: run.analysisContractVersion, sourceInput: run.sourceInput,
    profileId: run.profile.id, adoptedVersionIds: run.adoptedVersionIds, continuationBasisDigest: run.continuationBasis?.digest ?? null }) : null;
  const triage = list(graph?.process).find(item => item.stage === "TRIAGE");
  const current = currentBinding ? checkpoints.filter(c => c.payload?.binding === currentBinding) : [];
  const manifestRecord = graph
    ? checkpoints.find(c => c.key === "business-task-manifest" && c.payload?.data
      && triage?.taskManifestDigest === hash(c.payload.data))
    : current.filter(c => c.key === "business-task-manifest").at(-1);
  const manifest = Array.isArray(manifestRecord?.payload.data?.tasks) ? manifestRecord.payload.data : null;
  // A saved graph must never borrow a later/current task description. Its exact
  // manifest digest, when recorded, selects the historical checkpoint instead.
  const context = graph ? checkpoints.filter(c => typeof manifestRecord?.payload.binding === "string"
    && c.payload?.binding === manifestRecord.payload.binding) : current;
  const byKey = new Map(context.map(c => [c.key, c]));
  const inventory = graph ? list(graph.coverage) : list(byKey.get("inventory")?.payload.data);
  const inventoryByMaterial = new Map(inventory.map(m => [m.materialId, m]));
  const inventoryKeys = new Set(inventory.map(m => m.key));
  const materialIds = new Set(list(graph?.materials).map(m => m.id));
  const range = r => ({ materialId: text(r?.materialId), path: text(inventoryByMaterial.get(r?.materialId)?.path),
    byteStart: number(r?.byteStart), byteEnd: number(r?.byteEnd), startLine: number(r?.startLine), endLine: number(r?.endLine),
    readable: materialIds.has(r?.materialId) });
  const origins = new Map(list(graph?.consolidation?.originalProposals).map(p => [p.id, p.origin]));
  const mappings = list(graph?.consolidation?.sourceToCanonical);
  const mappingsByCanonical = new Map();
  for (const mapping of mappings) mappingsByCanonical.set(mapping.canonicalKey, [...(mappingsByCanonical.get(mapping.canonicalKey) ?? []), mapping]);
  const propositionsByTask = new Map();
  for (const p of [...list(graph?.candidates), ...list(graph?.relations)]) {
    const taskKeys = new Set(list(p.originRefs).map(id => origins.get(id)?.taskKey).filter(v => typeof v === "string"));
    if (typeof p.provenance?.taskKey === "string") taskKeys.add(p.provenance.taskKey);
    for (const taskKey of taskKeys) {
      const entry = { key: p.key, name: text(p.name) ?? text(p.predicate), state: p.state,
        mappingStatuses: [...new Set((mappingsByCanonical.get(p.key) ?? []).filter(m => origins.get(m.sourceKey)?.taskKey === taskKey).map(m => m.status))],
        evidence: list(p.evidence).map(c => ({ materialId: text(c.materialId), startLine: number(c.startLine), endLine: number(c.endLine), readable: materialIds.has(c.materialId) })) };
      propositionsByTask.set(taskKey, [...(propositionsByTask.get(taskKey) ?? []), entry]);
    }
  }
  const processes = graph ? list(graph.process).filter(p => typeof p.taskKey === "string")
    : context.flatMap(c => c.payload?.process ? [c.payload.process] : []);
  const processByKey = new Map(processes.map(p => [p.taskKey, p]));
  const taskByKey = new Map(list(manifest?.tasks).map(t => [t.taskKey, t]));
  const reports = list(triage?.taskReports);
  const keys = new Set([...taskByKey.keys(), ...processByKey.keys(), ...reports.map(r => r.taskKey)]);
  const tasks = [...keys].filter(k => typeof k === "string").map(taskKey => {
    const task = taskByKey.get(taskKey), process = processByKey.get(taskKey), candidate = byKey.get(taskKey);
    const checkpoint = !graph || (typeof process?.inputDigest === "string" && typeof process?.outputDigest === "string" && candidate?.payload.process?.inputDigest === process.inputDigest
      && candidate?.payload.process?.outputDigest === process.outputDigest) ? candidate : undefined;
    const report = reports.find(r => r.taskKey === taskKey), returned = !!process || !!report;
    const slotId = text(task?.slotId) ?? text(process?.slotId);
    const role = run.profile.mainAgentSlot?.id === slotId ? "MAIN"
      : list(run.profile.childAgentSlots).some(s => s.id === slotId) ? "CHILD" : null;
    const input = task?.input ?? checkpoint?.payload.input;
    const obligations = report ? list(report.obligations).map(o => ({ obligation: text(o.obligation),
      status: ["REPORTED_NOT_VERIFIED", "UNRESOLVED"].includes(o.status) ? o.status : "UNKNOWN", reason: text(o.reason) }))
      : list(input?.task?.obligations).map(obligation => {
        const reported = list(checkpoint?.payload.data?.obligationResults).find(o => o?.obligation === obligation);
        return { obligation: text(obligation), status: !returned ? "NOT_REPORTED"
          : reported?.status === "EVIDENCE_FOUND" ? "REPORTED_NOT_VERIFIED" : "UNRESOLVED", reason: text(reported?.reason) };
      });
    return { taskKey, slotId, role, generation: number(process?.generation), responsibilityId: text(task?.responsibilityId) ?? text(report?.responsibilityId),
      objective: text(input?.objective) ?? text(input?.question), status: returned ? "RETURN_RECORDED" : "PENDING",
      reportAvailable: Array.isArray(report?.obligations) || Array.isArray(checkpoint?.payload.data?.obligationResults),
      sourceRanges: list(report?.sourceRanges ?? task?.sourceRanges ?? process?.sourceRanges).map(range), obligations,
      crossTaskLeads: list(report?.crossTaskLeads ?? checkpoint?.payload.data?.crossTaskLeads)
        .filter(l => inventoryKeys.has(l?.materialKey)).map(l => ({ materialKey: text(l.materialKey), reason: text(l.reason) })),
      returnedCandidateCount: Array.isArray(checkpoint?.payload.data?.candidates) ? checkpoint.payload.data.candidates.length : null,
      returnedRelationCount: Array.isArray(checkpoint?.payload.data?.relations) ? checkpoint.payload.data.relations.length : null,
      propositions: propositionsByTask.get(taskKey) ?? [] };
  });
  const pendingSource = graph ? triage?.pendingTasks : manifest?.pending;
  return { version: 1, binding: { workspaceId: run.workspaceId, investigationId: run.id, runRevision: run.revision,
    runGeneration: run.generation, sourceBundleId: run.sourceInput.sourceBundleSnapshotId, receiptId: run.sourceInput.receiptId,
    profileId: run.profile.id, graphDigest: run.latestGraph?.digest ?? null }, runState: run.state,
    snapshotKind: graph ? "SAVED_GRAPH" : context.length ? "CURRENT_CHECKPOINTS" : "UNAVAILABLE",
    snapshotGeneration: graph ? run.latestGraph.generation : run.generation,
    snapshotAdoptedVersionIds: graph ? [...graph.adoptedVersionIds] : [...run.adoptedVersionIds],
    manifestAvailable: !!manifest, taskManifestDigest: text(triage?.taskManifestDigest) ?? (manifest ? hash(manifest) : null),
    tasks, pendingInventoryAvailable: Array.isArray(pendingSource), pending: list(pendingSource).map(p => ({ taskKey: text(p.taskKey),
      materialKey: text(p.materialKey), reason: text(p.reason), sourceRanges: list(p.sourceRanges).map(range) })),
    missing: [...(!manifest ? ["TASK_MANIFEST_UNAVAILABLE"] : []), ...(!Array.isArray(pendingSource) ? ["PENDING_INVENTORY_UNAVAILABLE"] : [])] };
}
