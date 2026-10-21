import { sourceTruthAuthenticator } from "../source-truth/authentication.js";
import { F002Error } from "./errors.js";

import { F002AdmissionService } from "./admission.js";
import { createF002HttpHandler } from "./http-handler.js";
import { createProfileConfigDigest, createProfileId } from "./identity.js";
import { F002MaterialService } from "./material-service.js";
import { F002PublicationService } from "./publication-service.js";
import { F002QueryService } from "./queries.js";
import { F002ReplayExecutionService, F002ReplayService } from "./replay-service.js";
import { F002Repository } from "./repository.js";
import { F002RequestDerivationService, F002RequestExecutionService, F002RequestService } from "./request-service.js";
import { F002Worker } from "./worker.js";
import { CURRENT_DISPLAY_POLICY_REVISION } from "./policy.js";

const runnableScopeStates = new Set(["QUEUED", "RUNNING"]);

// A small, durable-work scheduler. Queue entries carry no source bytes or
// client authority: every execution reuses the persisted run identity and
// enters F002Worker, which rechecks current F001/Workspace authorization.
export class F002ExecutionService {
  constructor({ repository, worker, members = [], resolveActor = null, workerId = `f002-runtime-${process.pid}`, leaseMs = 60_000, pollIntervalMs = 5_000, maxConcurrent = 2 } = {}) {
    if (typeof repository?.findRunnableScopes !== "function" || typeof worker?.run !== "function") {
      throw new TypeError("F002 execution service requires a runnable-scope repository and worker");
    }
    if (!Array.isArray(members) || !members.every((member) => member?.actorId && member?.tenantId)
      || !Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 60_000
      || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000
      || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new TypeError("F002 execution service configuration is invalid");
    }
    this.repository = repository;
    this.worker = worker;
    this.members = new Map(members.map((member) => [member.actorId, { actorId: member.actorId, tenantId: member.tenantId }]));
    if (resolveActor !== null && typeof resolveActor !== "function") throw new TypeError("Invalid execution actor resolver");
    this.resolveActor = resolveActor ?? (actorId => this.members.get(actorId));
    this.workerId = workerId;
    this.leaseMs = leaseMs;
    this.pollIntervalMs = pollIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.timer = null;
    this.running = new Map();
  }

  async start() {
    if (!this.timer) {
      this.timer = setInterval(() => { void this.dispatch(); }, this.pollIntervalMs);
      this.timer.unref();
    }
    await this.dispatch();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled(this.running.values());
  }

  async enqueue(run) {
    const refs = (run?.scopes ?? []).filter((scope) => runnableScopeStates.has(scope.status)).map((scope) => ({
      workspaceId: run.workspaceId, runId: run.id, scopeId: scope.scopeId, actorId: run.actorId, status: scope.status,
    }));
    await Promise.all(refs.map((ref) => this.#schedule(ref)));
  }

  async dispatch() {
    let scopes;
    try { scopes = await this.repository.findRunnableScopes({ limit: this.maxConcurrent * 4 }); }
    catch { return; }
    await Promise.all((scopes ?? []).map((scope) => this.#schedule(scope)));
  }

  #schedule(scope) {
    if (!scope?.workspaceId || !scope?.runId || !scope?.scopeId || !runnableScopeStates.has(scope.status)) return Promise.resolve();
    const key = `${scope.workspaceId}\u0000${scope.runId}\u0000${scope.scopeId}`;
    if (this.running.has(key)) return this.running.get(key);
    if (this.running.size >= this.maxConcurrent) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const actor = await this.resolveActor(scope.actorId, scope.workspaceId);
      if (actor) await this.worker.run(actor, scope.workspaceId, scope.runId, scope.scopeId, {
        workerId: this.workerId, leaseMs: this.leaseMs,
      });
    }).catch(() => {
      // Worker persists retryable diagnostics once it owns the lease. A lost
      // lease or an unavailable member remains recoverable on the next scan.
    }).finally(() => { this.running.delete(key); });
    this.running.set(key, task);
    return task;
  }
}

const standardInput = {
  version: "1",
  schemaVersion: 1,
  capabilityIds: ["inventory", "javascript", "java", "markdown", "json", "yaml", "properties", "junit-xml", "image-metadata", "evidence", "gaps", "policy"],
  ruleVersions: ["inventory@1", "javascript@1", "java@1", "markdown@1", "json@1", "yaml@1", "properties@1", "junit-xml@1", "image-metadata@1", "evidence@1", "gaps@1", "policy@1"],
  canonicalizationVersion: "1",
  extractionLimits: { maxBytes: 8 * 1024 * 1024, maxRecords: 200_000, maxMaterials: 200_000 },
  redactionPolicyRevision: "policy-v1",
};

export function standardF002Profile() {
  return { ...standardInput, configDigest: createProfileConfigDigest(standardInput), id: createProfileId(standardInput), name: "standard-v1", startable: true };
}

export function structuredF002Profile() {
  const config = { ...standardInput, version: "2", ruleVersions: standardInput.ruleVersions.map(rule => /^(javascript|java|markdown|json|properties|junit-xml)@1$/.test(rule) ? rule.replace(/@1$/, "@2") : rule),
    extractionLimits: { ...standardInput.extractionLimits, maxJsonDepth: 64, maxJsonNodes: 20_000, maxConfigEntries: 20_000, maxConfigLineBytes: 65_536, dotenvSyntax: "node-static-v1",
      documentSyntax: "static-document-v1", maxDocumentObjects: 10_000, maxDocumentParagraphBytes: 65_536,
      javascriptBindings: "lexical-bindings-v1", maxJavaScriptCalls: 20_000, maxJavaScriptBindings: 20_000,
      expressStatic: "top-level-literals-v1", maxExpressDeclarations: 2000, maxExpressPaths: 128, maxExpressMountDepth: 16,
      javaSyntax: "ast-declarations-v1", maxJavaNodes: 20_000,
      javaBindings: "component-static-zero-v1", maxJavaBindingCalls: 20_000, maxJavaBindingDeclarations: 20_000, maxJavaBindingCandidateRefs: 64,
      springMappings: "ast-literals-v1", maxSpringPaths: 128, maxSpringValues: 128,
      testAssets: "framework-declarations-v1", maxTestCases: 2000, maxTestAssertions: 10_000, maxTestNameBytes: 4096,
      testReports: "literal-reports-v1", maxReportCases: 2000, maxReportFieldBytes: 4096, maxXmlNodes: 20_000, maxXmlDepth: 64, maxXmlAttributes: 64, maxXmlAttributeBytes: 65_536,
      endpointContracts: "component-path-shape-v1", maxEndpointDeclarations: 10_000, maxEndpointMatches: 2000, maxEndpointCandidateRefs: 64 } };
  return { ...config, configDigest: createProfileConfigDigest(config), id: createProfileId(config), name: "structure-js-java-markdown-json-properties-dotenv-v2", startable: true };
}

export function boundedF002Profile() {
  const { id: _id, configDigest: _digest, name: _name, startable: _startable, ...previous } = structuredF002Profile();
  const config = { ...previous, version: "3", extractionLimits: { ...previous.extractionLimits, scopeRecordBudget: "atomic-material-v1" } };
  return { ...config, configDigest: createProfileConfigDigest(config), id: createProfileId(config), name: "bounded-structure-v3", startable: true, recommended: true };
}

// F002 deliberately shares F001's authoritative pool, member authenticator,
// source reader and browser origin allow-list. It owns only its new tables and
// services; it neither opens a second source connection nor accepts a legacy
// API token as a source identity.
export async function createF002Runtime({ sourceRuntime, cursorSecret, consumerResolver = null }) {
  if (!sourceRuntime?.pool || !sourceRuntime?.services?.repository || !sourceRuntime?.services?.admission || !sourceRuntime?.configuration) {
    throw new TypeError("F002 runtime requires a configured F001 source runtime");
  }
  const repository = new F002Repository(sourceRuntime.pool, {
    authorize: (actor, workspaceId, tx, maintain) => sourceRuntime.services.repository.authorize(actor, workspaceId, maintain, tx),
  });
  const sourceRepository = sourceRuntime.services.repository;
  // Recover a persisted principal, not a cookie or an administrator credential.
  // Both identity and F001 ACLs are rechecked now and again by each worker write.
  const resolveActor = sourceRepository.identityService ? async (actorId, workspaceId) => {
    const row = (await sourceRuntime.pool.query(`SELECT p.tenant_id FROM principal p
      JOIN project w ON w.tenant_id=p.tenant_id WHERE p.id=$1 AND w.id=$2`, [actorId, workspaceId])).rows[0];
    if (!row) return null;
    const actor = { actorId, tenantId: row.tenant_id };
    await sourceRepository.authorize(actor, workspaceId, true);
    return actor;
  } : null;
  const profile = standardF002Profile();
  await repository.registerProfile(profile);
  const structuredProfile = structuredF002Profile();
  await repository.registerProfile(structuredProfile);
  const boundedProfile = boundedF002Profile();
  await repository.registerProfile(boundedProfile);
  const admission = new F002AdmissionService(repository, sourceRuntime.services.admission);
  const publication = new F002PublicationService(repository);
  const queries = new F002QueryService(repository, { cursorSecret });
  // Current READ policy is distinct from the sealed extraction profile. Old
  // canonical records/replay remain immutable while present-day disclosure is safe.
  const materials = new F002MaterialService(repository, admission, { policyRevision: CURRENT_DISPLAY_POLICY_REVISION });
  const replays = new F002ReplayService(repository, { admission });
  const replayExecutor = new F002ReplayExecutionService({ replays, members: sourceRuntime.configuration.members, resolveActor,
    maxConcurrent: Math.min(16, Math.max(1, sourceRuntime.configuration.resources?.workerConcurrency ?? 2)) });
  const worker = new F002Worker(repository, { admission, publication });
  // No F003 resolver is supplied here. Until its separately authorized runtime
  // exists, submit is intentionally fail-closed with F002_CONSUMER_UNAVAILABLE.
  const expansion = new F002RequestDerivationService({ repository, admission, worker, publication });
  const requests = new F002RequestService(repository, { resolver: consumerResolver, expansion });
  const requestExecutor = consumerResolver ? new F002RequestExecutionService({ repository, requests, members: sourceRuntime.configuration.members, resolveActor,
    maxConcurrent: Math.min(16, Math.max(1, sourceRuntime.configuration.resources?.workerConcurrency ?? 2)) }) : null;
  const executor = new F002ExecutionService({ repository, worker, members: sourceRuntime.configuration.members, resolveActor,
    maxConcurrent: Math.min(16, Math.max(1, sourceRuntime.configuration.resources?.workerConcurrency ?? 2)) });
  const services = { repository, admission, publication, queries, materials, requests, replays, replayExecutor, worker, executor, requestExecutor, profile, structuredProfile, boundedProfile };
  return { services, start: async () => { await executor.start(); await replayExecutor.start(); if (requestExecutor) await requestExecutor.start(); }, close: async () => { if (requestExecutor) await requestExecutor.close(); await replayExecutor.close(); await executor.close(); }, deterministicFactsHandler: createF002HttpHandler({
    services,
    authenticate: sourceRepository.identityService ? () => { throw new F002Error("F002_AUTHENTICATION_REQUIRED", "请先登录当前工作区", { status: 401 }); }
      : sourceTruthAuthenticator(sourceRuntime.configuration.members),
    allowedOrigins: sourceRuntime.configuration.origins,
  }) };
}
