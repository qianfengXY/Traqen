import { InvestigationService } from "./investigation-service.js";
import { InvestigationWorker } from "./worker.js";
import { F006ExecutionConfiguration } from "./execution-configuration.js";
import { createF003HttpHandler } from "./http-handler.js";
import { F003Error, F003HostShutdown } from "./errors.js";
import { sourceTruthAuthenticator } from "../source-truth/authentication.js";
import { F003PublicationService } from "./publication-service.js";
import { loadPublicationAuthority } from "./publication-authority.js";
import { resolveF003ImplementationVersion } from "./implementation-version.js";
import { F003AuthorityService } from "./authority-service.js";
import { F003WorkSessionService } from "./work-session-service.js";
import { QuestionWorker } from "./question-worker.js";
import { F003PublishedReadService } from "./published-read-service.js";

export class F003ExecutionService {
  constructor({ investigations, worker, resolveActor, workerId = `f003-${process.pid}`, leaseMs = 60000, pollIntervalMs = 5000, maxConcurrent = 2 }) {
    if (!investigations?.findRunnable || !worker?.run || typeof resolveActor !== "function"
      || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000
      || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 60000
      || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) throw new TypeError("F003 execution configuration invalid");
    Object.assign(this, { investigations, worker, resolveActor, workerId, leaseMs, pollIntervalMs, maxConcurrent });
    this.running = new Map(); this.timer = null; this.closed = false;
  }
  async start() {
    if (this.closed) throw new Error("F003 executor closed");
    this.timer ??= setInterval(() => { void this.dispatch(); }, this.pollIntervalMs); this.timer.unref();
    await this.dispatch();
  }
  async dispatch() {
    if (this.closed) return;
    let refs;
    try { refs = await this.investigations.findRunnable({ limit: Math.min(100, this.maxConcurrent * 4) }); }
    catch { return; }
    for (const ref of refs) this.enqueue(ref);
  }
  enqueue(ref) {
    if (this.closed || !ref?.workspaceId || !ref.id || !ref.actorId) return;
    const key = `${ref.workspaceId}\0${ref.id}`;
    if (this.running.has(key) || this.running.size >= this.maxConcurrent) return;
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      if (this.closed) return;
      const actor = await this.resolveActor(ref.actorId, ref.workspaceId);
      if (actor && !this.closed) await this.worker.run(actor, ref.workspaceId, ref.id,
        { workerId: this.workerId, leaseMs: this.leaseMs, signal: controller.signal });
    }).catch(() => {
      // A worker records errors after claiming. Revoked identities and lost
      // leases are not grounds for impersonation or clearing persisted work.
    }).finally(() => { this.running.delete(key); });
    this.running.set(key, { promise, controller, workspaceId: ref.workspaceId, id: ref.id });
  }
  async drain() { await Promise.all([...this.running.values()].map(r => r.promise)); }
  stopAccepting() {
    this.closed = true; clearInterval(this.timer); this.timer = null;
  }
  async close() {
    this.stopAccepting();
    for (const r of this.running.values()) r.controller.abort(new F003HostShutdown());
    await this.drain();
  }
}

export async function createF003Runtime({ sourceRuntime, application, publicationAuthorityFile = process.env.F003_PUBLICATION_AUTHORITY_FILE ?? null } = {}) {
  const sources = sourceRuntime?.services?.repository, admission = sourceRuntime?.services?.admission;
  if (!sourceRuntime?.pool || !sources || !admission || !sourceRuntime.configuration || !application?.createBusinessKnowledgeModelExecutor)
    throw new TypeError("F003 requires actual F001 runtime and F006 application execution port");
  const authority = await loadPublicationAuthority(publicationAuthorityFile);
  const investigations = new InvestigationService({ sources, sourceAdmission: admission, profiles: new F006ExecutionConfiguration(),
    implementationVersion: await resolveF003ImplementationVersion() });
  const publications = new F003PublicationService({ sources, sourceReader: admission, authority, backup: sourceRuntime.services.backup ?? null });
  const authorityBindings = new F003AuthorityService({ sources, publications,
    verifyExecution: application.createBusinessKnowledgeExecutionVerifier?.() ?? null });
  const workSessions = new F003WorkSessionService({sources,publications,investigations});
  const publishedReads = new F003PublishedReadService({sources,admission,publications,authorityBindings});
  const invokeModel = application.createBusinessKnowledgeModelExecutor(investigations);
  const analysisWorker = new InvestigationWorker({ investigations, invokeModel });
  const questionWorker = new QuestionWorker({ investigations, workSessions, invokeModel });
  const worker = {
    run: async (actor,workspaceId,id,options) => ((await investigations.get(actor,workspaceId,id)).purpose === "GRAPH_QUESTION"
      ? questionWorker : analysisWorker).run(actor,workspaceId,id,options),
    stop: (workspaceId,id) => { analysisWorker.stop(workspaceId,id); questionWorker.stop(workspaceId,id); }
  };
  const members = new Map(sourceRuntime.configuration.members.map(m => [m.actorId, { actorId: m.actorId, tenantId: m.tenantId }]));
  const resolveActor = async (actorId, workspaceId) => {
    let actor;
    if (sources.identityService) {
      const row = (await sourceRuntime.pool.query(`SELECT p.tenant_id FROM principal p JOIN project w ON w.tenant_id=p.tenant_id WHERE p.id=$1 AND w.id=$2`, [actorId, workspaceId])).rows[0];
      if (row) actor = { actorId, tenantId: row.tenant_id };
    } else actor = members.get(actorId);
    if (actor) await sources.authorize(actor, workspaceId, true); return actor;
  };
  const executor = new F003ExecutionService({ investigations, worker, resolveActor,
    maxConcurrent: Math.max(1, Math.min(2, sourceRuntime.configuration.resources?.workerConcurrency ?? 2)) });
  const services = { investigations, worker, executor, publications, authorityBindings, workSessions, publishedReads };
  const authenticate = sources.identityService ? () => { throw new F003Error("F003_AUTHENTICATION_REQUIRED", "请先登录当前工作区", { status: 401 }); }
    : sourceTruthAuthenticator(sourceRuntime.configuration.members);
  return { services, start: () => executor.start(), stopAccepting: () => executor.stopAccepting(), close: () => executor.close(),
    businessKnowledgeHandler: createF003HttpHandler({ services, authenticate, allowedOrigins: sourceRuntime.configuration.origins }) };
}
