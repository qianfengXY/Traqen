import { Worker } from "node:worker_threads";

import { createMaterialId } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";
import { assembleCanonicalOutput } from "./output-assembly.js";
import { F002PublicationService } from "./publication-service.js";
import { capabilityForMaterialKind } from "./rules.js";
import { loadFrozenMaterials } from "./source-materials.js";
import { createParserDeadline, safeParserTimeoutDetails } from "./parser-deadline.js";
import { maintainLease } from "./lease.js";

function workerParse(input, { timeoutMs, onProgress = null, signal = null }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    if (onProgress !== null && typeof onProgress !== "function") throw new TypeError("parser progress observer must be a function");
    const started = performance.now();
    let settled = false, deadline, parser, lastReceived = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", aborted);
      deadline?.stop();
      parser?.terminate().catch(() => {});
      callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    signal?.addEventListener("abort", aborted, { once: true });
    deadline = createParserDeadline({ materialCount: input.materials.length, timeoutMs,
      onTimeout: (reason, details) => finish(reject, new F002Error("F002_PARSE_TIMEOUT", reason === "wall" ? "解析超过固定总运行预算" : "解析工作单元超过固定运行预算",
        { status: 503, details: { parser: { ...details, ...(lastReceived ? { lastReceived } : {}) } } })) });
    try { parser = new Worker(new URL("./parser-worker.js", import.meta.url)); }
    catch (error) { finish(reject, error); return; }
    parser.once("error", (error) => finish(reject, error));
    parser.once("exit", () => { if (!settled) finish(reject, new F002Error("F002_PARSE_RUNTIME_FAILURE", "解析进程未返回完整结果", { status: 503 })); });
    parser.on("message", (message) => {
      if (message?.type === "PROGRESS") {
        // These are separate clocks: the parent observes delivery, the worker
        // measures its last completed generator step (wall and, if available,
        // thread CPU). Neither explains a slow in-flight step by itself.
        lastReceived = { phase: message.progress?.phase, completed: message.progress?.completed, total: message.progress?.total,
          receivedElapsedMs: Math.ceil(performance.now() - started), worker: message.timing };
        if (deadline.progress(message.progress) && onProgress) {
          try { onProgress(message.progress, { receivedElapsedMs: lastReceived.receivedElapsedMs, worker: message.timing }); } catch (error) { finish(reject, error); }
        }
      } else if (message?.type === "RESULT") {
        if (deadline.complete()) finish(resolve, message.result);
        else finish(reject, new F002Error("F002_PARSE_RUNTIME_FAILURE", "解析进度未覆盖完整范围", { status: 503 }));
      }
      else if (message?.type === "ERROR") finish(reject, new F002Error(message.code === "F002_SCOPE_RECORD_BUDGET_TOO_SMALL" ? message.code : "F002_PARSE_RUNTIME_FAILURE", message.message, { status: message.code === "F002_SCOPE_RECORD_BUDGET_TOO_SMALL" ? 422 : 503 }));
    });
    parser.postMessage({ type: "COMPILE", input });
  });
}

function boundedParse(parse, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new F002Error("F002_PARSE_TIMEOUT", "解析超过固定运行预算", { status: 503 })), timeoutMs);
    Promise.resolve().then(() => parse(input, { timeoutMs })).then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function itemStatus(gaps) {
  const codes = gaps.map((gap) => gap.code);
  if (codes.some((code) => code.endsWith("_PARSE_FAILED"))) return "PARSE_FAILED";
  if (codes.some((code) => code === "FORMAT_UNSUPPORTED" || code === "TEXT_ENCODING_UNSUPPORTED")) return "UNSUPPORTED";
  return "DONE";
}

function declaredCapabilities(profile) {
  return [...new Set(profile.capabilityIds)].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

function scopeItemsForMaterials({ workspaceId, bundleId, profile, sourceMaterials, result, records }) {
  const materials = new Map((result?.materials ?? []).map((material) => [material.materialId, material]));
  const gaps = result?.gaps ?? [];
  const recordsByMaterial = new Map(), gapsByMaterial = new Map();
  for (const record of records ?? []) {
    const key = record.payload?.materialId;
    if (!recordsByMaterial.has(key)) recordsByMaterial.set(key, []);
    recordsByMaterial.get(key).push(record.id);
  }
  for (const gap of gaps) {
    if (!gapsByMaterial.has(gap.materialId)) gapsByMaterial.set(gap.materialId, []);
    gapsByMaterial.get(gap.materialId).push(gap);
  }
  const capabilities = declaredCapabilities(profile);
  return sourceMaterials.flatMap((sourceMaterial) => {
    const materialId = createMaterialId({ workspaceId, bundleId, componentId: sourceMaterial.componentId, pathBytes: sourceMaterial.pathBytes });
    const material = materials.get(materialId);
    const applicable = material ? capabilityForMaterialKind(material.kind) : null;
    const materialRecordIds = recordsByMaterial.get(materialId) ?? [];
    const materialGaps = gapsByMaterial.get(materialId) ?? [];
    const materialGapIds = materialGaps.map(gap => gap.gapId);
    return capabilities.map((capabilityId) => {
      if (!material) return { materialId, capabilityId, status: "PENDING" };
      if (capabilityId === "inventory") return { materialId, capabilityId, status: "DONE", recordIds: materialRecordIds, gapIds: [] };
      if (capabilityId === "evidence") return { materialId, capabilityId, status: "DONE", recordIds: materialRecordIds, gapIds: [] };
      if (capabilityId === "gaps") return { materialId, capabilityId, status: "DONE", recordIds: [], gapIds: materialGapIds };
      if (capabilityId === "policy") {
        return { materialId, capabilityId, status: "NOT_APPLICABLE", recordIds: [], gapIds: [], diagnostic: { code: "F002_POLICY_READ_TIME" } };
      }
      const logicApplicable = capabilityId === "program-logic" && profile.extractionLimits?.programLogic === "bounded-syntax-v1"
        && ["JAVASCRIPT", "TYPESCRIPT", "JAVA"].includes(material.kind);
      const sqlApplicable = capabilityId === "sql" && profile.extractionLimits?.staticSql === "literal-statements-v1"
        && ["JAVASCRIPT", "TYPESCRIPT", "JAVA", "SQL"].includes(material.kind);
      if (capabilityId !== applicable && !logicApplicable && !sqlApplicable) return { materialId, capabilityId, status: "NOT_APPLICABLE", recordIds: [], gapIds: [] };
      return {
        materialId,
        capabilityId,
        status: itemStatus(materialGaps),
        recordIds: materialRecordIds,
        gapIds: materialGapIds,
      };
    });
  });
}

async function recordBatches(repository, actor, input) {
  for (let offset = 0; offset < input.items.length; offset += 500) {
    await repository.recordScopeItems(actor, { ...input, items: input.items.slice(offset, offset + 500) });
  }
}

// A lease fences ownership, not the total source-reading/parse duration. Renew
// only the live generation through the same current ACL and request-owner gate.
function maintainScopeLease(repository, actor, input) {
  return maintainLease(() => repository.renewScopeLease(actor, input), input.leaseMs);
}

export class F002Worker {
  constructor(repository, { admission = null, parse = workerParse, publication = new F002PublicationService(repository) } = {}) {
    if (!repository?.claimScope || !repository?.renewScopeLease || !repository?.recordScopeItems || !repository?.failScope || !repository?.getRun || !repository?.getProfile) {
      throw new TypeError("F002 worker requires a scope repository");
    }
    if (typeof parse !== "function") throw new TypeError("F002 worker parser must be a function");
    if (admission !== null && (typeof admission.inventory !== "function" || typeof admission.readFile !== "function")) {
      throw new TypeError("F002 worker admission must provide durable inventory and reads");
    }
    this.repository = repository;
    this.admission = admission;
    this.parse = parse;
    this.publication = publication;
  }

  async run(actor, workspaceId, runId, scopeId, { workerId, leaseMs, materials = undefined, timeoutMs = 10_000, requestId = null, requestGeneration = null }) {
    requireF002((materials === undefined || Array.isArray(materials)) && (!Array.isArray(materials) || materials.length <= 200_000)
      && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000,
      "F002_WORKER_INPUT_INVALID", "范围执行输入无效", { status: 422 });
    requireF002(!(this.admission && materials !== undefined), "F002_WORKER_INPUT_FORBIDDEN", "生产执行器只能从已准入来源读取材料", { status: 422 });
    const claimed = await this.repository.claimScope(actor, workspaceId, runId, scopeId, { workerId, leaseMs, requestId, requestGeneration });
    const lease = maintainScopeLease(this.repository, actor, { workspaceId, runId, scopeId, generation: claimed.generation, workerId, leaseMs, requestId, requestGeneration });
    try {
      const run = await this.repository.getRun(actor, workspaceId, runId);
      const profile = await this.repository.getProfile(actor, workspaceId, run.profileId);
      const scope = await this.repository.getScope(actor, workspaceId, runId, scopeId);
      const sourceMaterials = materials ?? await loadFrozenMaterials(this.admission, actor, workspaceId, run, scope, profile, { signal: lease.signal });
      lease.assertActive();
      const items = scopeItemsForMaterials({ workspaceId, bundleId: run.sourceInput.bundleId, profile, sourceMaterials });
      await recordBatches(this.repository, actor, { workspaceId, runId, scopeId, generation: claimed.generation, items });
      const input = { workspaceId, bundleId: run.sourceInput.bundleId, profile, materials: sourceMaterials };
      // Native parser progress comes only from completed deterministic units,
      // with the same per-unit deadline plus an independent 20-minute ceiling.
      // Injected parsers without that protocol retain the original total bound.
      const compiled = this.parse === workerParse ? await workerParse(input, { timeoutMs, signal: lease.signal }) : await boundedParse(this.parse, input, timeoutMs);
      lease.assertActive();
      const { result: completedResult, records } = await assembleCanonicalOutput({ admission: this.admission, actor, workspaceId, run, sourceMaterials, compiled, profile });
      await this.publication.prepare(actor, workspaceId, runId, scopeId, { generation: claimed.generation, records });
      const completedItems = scopeItemsForMaterials({ workspaceId, bundleId: run.sourceInput.bundleId, profile, sourceMaterials, result: completedResult, records });
      await recordBatches(this.repository, actor, { workspaceId, runId, scopeId, generation: claimed.generation, items: completedItems });
      lease.assertActive();
      return await this.repository.readyToSeal(actor, { workspaceId, runId, scopeId, generation: claimed.generation });
    } catch (error) {
      if (error instanceof F002Error && ["F002_STALE_SCOPE_WORKER", "F002_SCOPE_PENDING"].includes(error.code)) throw error;
      const diagnostic = { code: error instanceof F002Error ? error.code : "F002_PARSE_RUNTIME_FAILURE", category: "RUNTIME_FAILURE" };
      const parser = safeParserTimeoutDetails(error);
      if (parser) diagnostic.parser = parser;
      await this.repository.failScope(actor, { workspaceId, runId, scopeId, generation: claimed.generation, diagnostic });
      return { status: "FAILED_RETRYABLE", diagnostic };
    } finally {
      await lease.stop();
    }
  }

}

export { workerParse };
