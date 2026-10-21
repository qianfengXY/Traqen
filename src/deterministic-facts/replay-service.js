import { randomUUID } from "node:crypto";

import { compileDeterministicFacts } from "./extraction/compile.js";
import { canonicalDigest } from "./identity.js";
import { F002Error, requireF002 } from "./errors.js";
import { assembleCanonicalOutput } from "./output-assembly.js";
import { installedF002Rules } from "./rules.js";
import { loadFrozenMaterials } from "./source-materials.js";
import { normalizeCanonicalRecords } from "./verification.js";

const terminalStates = new Set(["MATCH", "DIFFERENT", "FAILED", "CANCELLED"]);
const runnableStates = new Set(["QUEUED", "RUNNING"]);

function operationId(value) {
  requireF002(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value), "F002_OPERATION_INVALID", "操作键格式无效", { status: 422 });
  return value;
}

function replayId(value) {
  requireF002(typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value), "F002_REPLAY_INVALID", "重放定位符无效", { status: 422 });
  return value;
}

function versionId(value) {
  requireF002(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "F002_VERSION_INVALID", "事实集版本定位符无效", { status: 422 });
  return value;
}

function diagnostic(error) {
  return { code: error instanceof F002Error ? error.code : "F002_REPLAY_RUNTIME_FAILURE" };
}

function rowResult(row) {
  return {
    id: row.id,
    operationId: row.operation_id,
    cancelOperationId: row.cancel_operation_id ?? null,
    graphVersionId: row.graph_version_id,
    candidateDigest: row.candidate_digest ?? null,
    status: row.status,
    generation: row.generation,
    revision: row.revision,
    diagnostic: row.diagnostic ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: terminalStates.has(row.status) && row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

// Replay never accepts a client-supplied answer. The durable request is
// created before its first F001 read, then a fenced worker reconstructs the
// original immutable run context and recompiles its exact historical profile.
export class F002ReplayService {
  constructor(repository, { admission, compile = compileDeterministicFacts, ruleRegistry = installedF002Rules } = {}) {
    if (typeof repository?.withMaintainedWorkspace !== "function" || typeof repository?.withAuthorizedWorkspace !== "function") {
      throw new TypeError("F002 replay requires an authorized repository");
    }
    if (!admission || typeof admission.inventory !== "function" || typeof admission.readFile !== "function") throw new TypeError("F002 replay requires admitted source reads");
    if (typeof compile !== "function") throw new TypeError("F002 replay compiler must be a function");
    if (!ruleRegistry || typeof ruleRegistry.assertProfile !== "function") throw new TypeError("F002 replay requires a server rule registry");
    this.repository = repository;
    this.admission = admission;
    this.compile = compile;
    this.ruleRegistry = ruleRegistry;
  }

  async submit(actor, workspaceId, graphVersionId, { operationId: suppliedOperationId } = {}) {
    versionId(graphVersionId);
    const stableOperationId = operationId(suppliedOperationId);
    const requestDigest = canonicalDigest("REPLAY_REQUEST", { graphVersionId });
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const existing = (await tx.query(`SELECT * FROM f002_replay
        WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR UPDATE`, [workspaceId, actor.actorId, stableOperationId])).rows[0];
      if (existing) {
        requireF002(existing.request_digest === requestDigest, "F002_OPERATION_CONFLICT", "操作键已绑定不同重放请求");
        return rowResult(existing);
      }
      await this.#context(tx, workspaceId, graphVersionId);
      const id = randomUUID();
      const row = (await tx.query(`INSERT INTO f002_replay
        (id,workspace_id,actor_id,operation_id,request_digest,graph_version_id,status)
        VALUES ($1,$2,$3,$4,$5,$6,'QUEUED') RETURNING *`,
      [id, workspaceId, actor.actorId, stableOperationId, requestDigest, graphVersionId])).rows[0];
      return rowResult(row);
    });
  }

  // Compatibility for in-process callers and focused tests. HTTP and runtime
  // use submit/enqueue; this helper still persists before reading any source.
  async replay(actor, workspaceId, graphVersionId) {
    const accepted = await this.submit(actor, workspaceId, graphVersionId, { operationId: `replay-${randomUUID()}` });
    return this.execute(actor, workspaceId, accepted.id, { workerId: "f002-direct-replay", leaseMs: 60_000 });
  }

  async execute(actor, workspaceId, id, { workerId, leaseMs = 60_000 } = {}) {
    replayId(id);
    requireF002(typeof workerId === "string" && workerId.length > 0 && Number.isInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 60_000,
      "F002_REPLAY_EXECUTION_INVALID", "重放执行参数无效", { status: 422 });
    const claimed = await this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const current = (await tx.query("SELECT * FROM f002_replay WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id])).rows[0];
      requireF002(current, "F002_REPLAY_NOT_FOUND", "重放不存在", { status: 404 });
      if (terminalStates.has(current.status)) return current;
      const { rows } = await tx.query(`UPDATE f002_replay SET status='RUNNING',generation=generation+1,revision=revision+1,worker_id=$3,
          lease_until=clock_timestamp()+($4::integer * interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 AND (status='QUEUED' OR (status='RUNNING' AND lease_until<=clock_timestamp())) RETURNING *`,
      [workspaceId, id, workerId, leaseMs]);
      requireF002(rows.length === 1, "F002_REPLAY_LEASE_BUSY", "重放已有有效执行者或不可执行", { status: 409 });
      return rows[0];
    });
    if (terminalStates.has(claimed.status)) return rowResult(claimed);
    try {
      const context = await this.repository.withMaintainedWorkspace(actor, workspaceId, (tx) => this.#context(tx, workspaceId, claimed.graph_version_id));
      this.ruleRegistry.assertProfile(context.profile_payload);
      const profile = { ...context.profile_payload, startable: context.startable };
      const run = { id: context.run_id, sourceInput: context.source_input };
      const scope = { scopeId: context.scope_id, selections: context.selections };
      const materials = await loadFrozenMaterials(this.admission, actor, workspaceId, run, scope, profile);
      const compiled = await this.compile({ workspaceId, bundleId: context.bundle_id, profile, materials, ruleRegistry: this.ruleRegistry });
      const { records: assembled } = await assembleCanonicalOutput({ admission: this.admission, actor, workspaceId, run, sourceMaterials: materials, compiled });
      const records = normalizeCanonicalRecords(assembled,
        { workspaceId, bundleId: context.bundle_id });
      const candidateDigest = canonicalDigest("FACT_SET_RECORDS", { records });
      return this.#finish(actor, workspaceId, claimed, { status: candidateDigest === context.record_digest ? "MATCH" : "DIFFERENT", candidateDigest, diagnostic: null });
    } catch (error) {
      if (error instanceof F002Error && error.code === "F002_STALE_REPLAY_WORKER") throw error;
      return this.#finish(actor, workspaceId, claimed, {
        status: "FAILED",
        candidateDigest: canonicalDigest("REPLAY_FAILURE", { graphVersionId: claimed.graph_version_id, reason: diagnostic(error) }),
        diagnostic: diagnostic(error),
      });
    }
  }

  async cancel(actor, workspaceId, id, { revision, operationId: cancelOperationId } = {}) {
    replayId(id); operationId(cancelOperationId);
    requireF002(Number.isInteger(revision) && revision > 0, "F002_REPLAY_REVISION_CONFLICT", "缺少当前重放修订", { status: 409 });
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT * FROM f002_replay WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id])).rows[0];
      requireF002(row, "F002_REPLAY_NOT_FOUND", "重放不存在", { status: 404 });
      if (row.status === "CANCELLED") {
        requireF002(row.cancel_operation_id === cancelOperationId, "F002_REPLAY_REVISION_CONFLICT", "重放已由其他取消操作终止");
        return rowResult(row);
      }
      requireF002(!terminalStates.has(row.status) && row.revision === revision, "F002_REPLAY_REVISION_CONFLICT", "重放修订或状态已变化", { status: 409 });
      const updated = (await tx.query(`UPDATE f002_replay SET status='CANCELLED',revision=revision+1,cancel_operation_id=$3,
        lease_until=NULL,diagnostic=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, id, cancelOperationId, JSON.stringify({ code: "CANCELLED", operationId: cancelOperationId })])).rows[0];
      return rowResult(updated);
    });
  }

  async get(actor, workspaceId, id) {
    replayId(id);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query("SELECT * FROM f002_replay WHERE workspace_id=$1 AND id=$2", [workspaceId, id])).rows[0];
      requireF002(row, "F002_REPLAY_NOT_FOUND", "重放不存在", { status: 404 });
      return rowResult(row);
    });
  }

  async findByOperation(actor, workspaceId, suppliedOperationId) {
    const stableOperationId = operationId(suppliedOperationId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM f002_replay WHERE workspace_id=$1
        AND ((actor_id=$2 AND operation_id=$3) OR cancel_operation_id=$3) LIMIT 2`, [workspaceId, actor.actorId, stableOperationId]);
      requireF002(rows.length <= 1, "F002_OPERATION_CONFLICT", "操作键对应多个重放回执", { status: 409 });
      const row = rows[0];
      return row ? rowResult(row) : null;
    });
  }

  async list(actor, workspaceId, graphVersionId) {
    versionId(graphVersionId);
    return this.repository.withAuthorizedWorkspace(actor, workspaceId, async (tx) => (await tx.query(`SELECT * FROM f002_replay
      WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`, [workspaceId, graphVersionId])).rows.map(rowResult));
  }

  async findRunnable({ limit = 32 } = {}) {
    requireF002(Number.isInteger(limit) && limit >= 1 && limit <= 128, "F002_REPLAY_EXECUTION_INVALID", "重放执行分页无效", { status: 422 });
    return (await this.repository.database.query(`SELECT workspace_id,id,actor_id,status FROM f002_replay
      WHERE status='QUEUED' OR (status='RUNNING' AND lease_until<=clock_timestamp())
      ORDER BY created_at,id LIMIT $1`, [limit])).rows.map((row) => ({
      workspaceId: row.workspace_id, replayId: row.id, actorId: row.actor_id, status: row.status,
    }));
  }

  async #finish(actor, workspaceId, claimed, { status, candidateDigest, diagnostic: failure }) {
    return this.repository.withMaintainedWorkspace(actor, workspaceId, async (tx) => {
      const row = (await tx.query(`UPDATE f002_replay SET status=$4,candidate_digest=$5,diagnostic=$6,lease_until=NULL,
          revision=revision+1,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 AND status='RUNNING' AND generation=$3 AND lease_until>clock_timestamp() RETURNING *`,
      [workspaceId, claimed.id, claimed.generation, status, candidateDigest, JSON.stringify(failure)])).rows[0];
      requireF002(row, "F002_STALE_REPLAY_WORKER", "重放执行权或状态已变化", { status: 409 });
      return rowResult(row);
    });
  }

  async #context(tx, workspaceId, graphVersionId) {
    const row = (await tx.query(`SELECT fact_set.record_digest, fact_set.bundle_id, run.id AS run_id, run.source_input,
        scope.scope_id, scope.selections, profile.payload AS profile_payload, profile.startable
      FROM f002_fact_set fact_set
      JOIN f002_run run ON run.workspace_id=fact_set.workspace_id AND run.id=fact_set.run_id
      JOIN f002_scope scope ON scope.workspace_id=fact_set.workspace_id AND scope.run_id=fact_set.run_id AND scope.scope_id=fact_set.scope_id
      JOIN f002_profile profile ON profile.id=fact_set.profile_id
      WHERE fact_set.workspace_id=$1 AND fact_set.graph_version_id=$2`, [workspaceId, graphVersionId])).rows[0];
    requireF002(row, "F002_VERSION_NOT_FOUND", "事实集版本不存在", { status: 404 });
    return row;
  }
}

export class F002ReplayExecutionService {
  constructor({ replays, members = [], resolveActor = null, workerId = `f002-replay-${process.pid}`, leaseMs = 60_000, pollIntervalMs = 5_000, maxConcurrent = 2 } = {}) {
    if (typeof replays?.findRunnable !== "function" || typeof replays?.execute !== "function" || !Array.isArray(members)
      || !members.every((member) => member?.actorId && member?.tenantId) || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new TypeError("F002 replay execution service configuration is invalid");
    }
    this.replays = replays;
    this.members = new Map(members.map((member) => [member.actorId, { actorId: member.actorId, tenantId: member.tenantId }]));
    if (resolveActor !== null && typeof resolveActor !== "function") throw new TypeError("Invalid execution actor resolver");
    this.resolveActor = resolveActor ?? (actorId => this.members.get(actorId));
    this.workerId = workerId; this.leaseMs = leaseMs; this.pollIntervalMs = pollIntervalMs; this.maxConcurrent = maxConcurrent;
    this.timer = null; this.running = new Map();
  }

  async start() { if (!this.timer) { this.timer = setInterval(() => { void this.dispatch(); }, this.pollIntervalMs); this.timer.unref(); } await this.dispatch(); }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; await Promise.allSettled(this.running.values()); }
  async enqueue(replay) { return this.#schedule(replay); }
  async dispatch() { await Promise.all((await this.replays.findRunnable({ limit: this.maxConcurrent * 4 })).map((replay) => this.#schedule(replay))); }

  #schedule(replay) {
    if (!replay?.workspaceId || !replay?.replayId || !runnableStates.has(replay.status)) return Promise.resolve();
    const key = `${replay.workspaceId}\u0000${replay.replayId}`;
    if (this.running.has(key) || this.running.size >= this.maxConcurrent) return this.running.get(key) ?? Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const actor = await this.resolveActor(replay.actorId, replay.workspaceId);
      if (actor) await this.replays.execute(actor, replay.workspaceId, replay.replayId, { workerId: this.workerId, leaseMs: this.leaseMs });
    })
      .catch(() => {}).finally(() => this.running.delete(key));
    this.running.set(key, task);
    return task;
  }
}

export { F002Error };
