import { randomUUID } from "node:crypto";
import { sourceInput } from "./policy.js";
import { SourceCaptureRunner } from "./capture-runner.js";
import { requireValue, SourceTruthError } from "./errors.js";
import { orderedArrayDigest } from "./identity.js";
import { terminalRunStates } from "./repository.js";

export class SourceCaptureService {
  constructor(services) {
    Object.assign(this, services);
    this.workerId = services.workerId ?? `source-worker-${randomUUID()}`;
    this.runner = new SourceCaptureRunner(services);
    this.advancing = new Map();
  }

  async save(actor, workspaceId, { expectedRevision, input }) {
    const normalized = sourceInput(input, this.policy);
    return this.repository.saveDraft(actor, workspaceId, { expectedRevision, input: normalized, beforeSave: async (tx) => {
      await tx.query("INSERT INTO source_truth_policy (id,payload) VALUES ($1,$2) ON CONFLICT DO NOTHING", [this.policy.id, JSON.stringify(this.policy)]);
      if (normalized.baselineBundleId) {
        const base = await tx.query("SELECT id FROM source_truth_bundle WHERE workspace_id=$1 AND id=$2", [workspaceId, normalized.baselineBundleId]);
        requireValue(base.rows.length === 1, "SOURCE_BASELINE_MISMATCH", "请选择此 Workspace 的已冻结基线");
      }
      for (const source of normalized.sources) {
        if (source.mode === "REUSE") await this.runner.baseline(tx, workspaceId, normalized.baselineBundleId, source);
        const existing = (await tx.query("SELECT kind,locator FROM source_truth_registration WHERE workspace_id=$1 AND source_id=$2", [workspaceId, source.sourceId])).rows[0];
        if (existing) requireValue(existing.kind === source.kind && (source.mode === "REUSE" || existing.locator === (source.url ?? null)), "SOURCE_REGISTRATION_CONFLICT", "来源登记不能被改成另一个仓库或类型；请添加新来源登记");
        else {
          requireValue(source.mode !== "REUSE", "SOURCE_REGISTRATION_CONFLICT", "沿用来源缺少登记记录");
          await tx.query("INSERT INTO source_truth_registration (workspace_id,source_id,kind,locator) VALUES ($1,$2,$3,$4)", [workspaceId, source.sourceId, source.kind, source.url ?? null]);
        }
      }
    } });
  }

  async start(actor, workspaceId, input) {
    return this.repository.startRun(actor, workspaceId, { draftRevision: input.draftRevision, retryOf: input.retryOf ?? null, policyRevisionId: this.policy.id });
  }

  async context(actor, workspaceId, runId) {
    const access = await this.repository.authorize(actor, workspaceId, true);
    let run = await this.repository.getRun(actor, workspaceId, runId);
    requireValue(run, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
    requireValue(!terminalRunStates.has(run.status), "SOURCE_INVALID_TRANSITION", "任务已结束，请查询历史结果或显式创建新尝试");
    const context = { workspaceId, runId, generation: run.generation, tenantId: access.tenantId };
    if (run.workerId === this.workerId) {
      try { run = await this.repository.heartbeat(context); return { context, run }; }
      catch (error) { if (error.code !== "SOURCE_STALE_WORKER") throw error; }
    }
    run = await this.repository.claimRun(workspaceId, runId, { workerId: this.workerId, leaseMs: 60000 });
    return { context: { ...context, generation: run.generation }, run };
  }

  async withHeartbeat(context, action) {
    const controller = new AbortController();
    let pending = null, failure = null;
    const timer = setInterval(() => {
      if (pending) return;
      pending = this.repository.heartbeat(context).catch((error) => { failure = error; controller.abort(); }).finally(() => { pending = null; });
    }, 10000);
    try {
      const result = await action(controller.signal);
      if (failure) throw failure;
      return result;
    } finally { clearInterval(timer); await pending; }
  }

  async advance(actor, workspaceId, runId) {
    await this.repository.authorize(actor, workspaceId, true);
    const key = `${workspaceId}:${runId}`;
    if (this.advancing.has(key)) return this.advancing.get(key);
    const current = await this.repository.getRun(actor, workspaceId, runId);
    requireValue(current, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
    if (terminalRunStates.has(current.status) || ["REVIEW_REQUIRED", "PREPARING_SEAL", "FINALIZING"].includes(current.status)) return current;
    const work = (async () => {
      const { context, run } = await this.context(actor, workspaceId, runId);
      try { return await this.withHeartbeat(context, (signal) => this.runner.advance(context, run, signal)); }
      catch (error) {
        if (!(error instanceof SourceTruthError) || ["SOURCE_STALE_WORKER", "SOURCE_FORBIDDEN", "SOURCE_LEASE_BUSY"].includes(error.code)) throw error;
        const latest = await this.repository.getRun(actor, workspaceId, runId);
        if (terminalRunStates.has(latest.status)) return latest;
        return this.repository.transition(workspaceId, runId, { generation: context.generation, expectedStatus: latest.status,
          status: error.status >= 500 ? "FAILED_RETRYABLE" : "BLOCKED", diagnostic: { code: error.code, message: error.message,
            priorVersionsUnchanged: true, recovery: error.status >= 500 ? "恢复存储或来源连接后重试" : "编辑来源或范围后创建新尝试" } });
      }
    })();
    this.advancing.set(key, work);
    try { return await work; } finally { this.advancing.delete(key); }
  }

  async directoryContext(actor, workspaceId, runId, sourceId) {
    const { context, run } = await this.context(actor, workspaceId, runId);
    const local = { ...context, sourceId };
    const source = await this.materials.source(local);
    requireValue(source.kind === "DIRECTORY_UPLOAD" && source.source.mode === "UPDATE", "SOURCE_INVALID_INPUT", "只能向本任务正在更新的目录来源传输", { status: 400 });
    return { context: local, run, source };
  }

  async enumerateDirectory(actor, workspaceId, runId, sourceId, input) {
    const { context } = await this.directoryContext(actor, workspaceId, runId, sourceId);
    for (const entry of input.entries ?? []) requireValue(entry.sizeBytes === null || BigInt(entry.sizeBytes) <= BigInt(this.policy.maxFileBytes), "SOURCE_FILE_TOO_LARGE", "目录文件超过平台限制，不能跳过");
    return this.materials.appendEntries(context, input.entries, { batchId: input.batchId });
  }

  async closeDirectory(actor, workspaceId, runId, sourceId, input) {
    const { context } = await this.directoryContext(actor, workspaceId, runId, sourceId);
    requireValue(/^[a-f0-9]{64}$/.test(input.manifestId), "SOURCE_INVALID_INPUT", "需要完整所选目录的 manifest 摘要", { status: 400 });
    const digest = await orderedArrayDigest("manifest", { kind: "DIRECTORY_UPLOAD" }, "entries", this.materials.entryStream(context));
    requireValue(digest === input.manifestId, "SOURCE_DIRECTORY_CHANGED", "服务端清单与本机完整目录哈希不同；请重新选择并核对，不能继续冻结");
    const summary = await this.materials.closeEnumeration(context, { ...input, beforeClose: async (tx) => {
      await tx.query(`INSERT INTO source_truth_directory_selection (workspace_id,run_id,source_id,manifest_id,actor_id) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING`, [workspaceId, runId, sourceId, digest, actor.actorId]);
    } });
    return summary;
  }

  async uploadChunk(actor, workspaceId, runId, sourceId, input, stream) {
    const { context } = await this.directoryContext(actor, workspaceId, runId, sourceId);
    return this.withHeartbeat(context, () => this.upload.uploadChunk(actor, context, input, stream));
  }
  async finishFile(actor, workspaceId, runId, sourceId, encodedPath) {
    const { context } = await this.directoryContext(actor, workspaceId, runId, sourceId);
    return this.withHeartbeat(context, () => this.upload.finishFile(actor, context, encodedPath));
  }
}
