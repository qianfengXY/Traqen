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

const runnableScopeStates = new Set(["QUEUED", "RUNNING", "READY_TO_SEAL"]);

// A small, durable-work scheduler. Queue entries carry no source bytes or
// client authority: every execution reuses the persisted run identity and
// enters F002Worker, which rechecks current F001/Workspace authorization.
export class F002ExecutionService {
  constructor({ repository, worker, publication = null, members = [], resolveActor = null, workerId = `f002-runtime-${process.pid}`, leaseMs = 60_000, pollIntervalMs = 5_000, maxConcurrent = 2 } = {}) {
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
    this.publication = publication;
    this.members = new Map(members.map((member) => [member.actorId, { actorId: member.actorId, tenantId: member.tenantId }]));
    if (resolveActor !== null && typeof resolveActor !== "function") throw new TypeError("Invalid execution actor resolver");
    this.resolveActor = resolveActor ?? (actorId => this.members.get(actorId));
    this.workerId = workerId;
    this.leaseMs = leaseMs;
    this.pollIntervalMs = pollIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.timer = null;
    this.running = new Map();
    this.closed = false;
    this.starting = null;
    this.closing = null;
  }

  start() {
    if (this.closed) return Promise.reject(new Error("F002 execution service is closed"));
    return this.starting ??= (async () => {
      // Readiness verifies the durable queue, not completion of recovered work.
      // Jobs keep their existing tracking/ACL/lease and shutdown-drain boundary.
      await this.dispatch({ waitForWork: false, propagateScanError: true });
      if (!this.closed && !this.timer) {
        this.timer = setInterval(() => { void this.dispatch(); }, this.pollIntervalMs);
        this.timer.unref();
      }
    })();
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.closing ??= (async () => {
      await this.starting?.catch(() => {});
      await Promise.allSettled(this.running.values());
    })();
  }

  async enqueue(run) {
    const refs = (run?.scopes ?? []).filter((scope) => runnableScopeStates.has(scope.status)).map((scope) => ({
      workspaceId: run.workspaceId, runId: run.id, scopeId: scope.scopeId, actorId: run.actorId, status: scope.status,
    }));
    await Promise.all(refs.map((ref) => this.#schedule(ref)));
  }

  async dispatch({ waitForWork = true, propagateScanError = false } = {}) {
    if (this.closed) return;
    let scopes;
    try { scopes = await this.repository.findRunnableScopes({ limit: this.maxConcurrent * 4 }); }
    catch (error) { if (propagateScanError) throw error; return; }
    const tasks = (scopes ?? []).map((scope) => this.#schedule(scope));
    if (waitForWork) await Promise.all(tasks);
  }

  #schedule(scope) {
    if (this.closed || !scope?.workspaceId || !scope?.runId || !scope?.scopeId || !runnableScopeStates.has(scope.status)) return Promise.resolve();
    const key = `${scope.workspaceId}\u0000${scope.runId}\u0000${scope.scopeId}`;
    if (this.running.has(key)) return this.running.get(key);
    if (this.running.size >= this.maxConcurrent) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const actor = await this.resolveActor(scope.actorId, scope.workspaceId);
      if (this.closed || !actor) return;
      if (scope.status !== "READY_TO_SEAL") await this.worker.run(actor, scope.workspaceId, scope.runId, scope.scopeId, {
        workerId: this.workerId, leaseMs: this.leaseMs,
      });
      if (!this.publication) return;
      const run = await this.repository.getRun(actor, scope.workspaceId, scope.runId);
      const profile = await this.repository.getProfile(actor, scope.workspaceId, run.profileId);
      if (profile.extractionLimits?.automaticPublication !== "closed-scope-v1") return;
      const ready = run.scopes.find(candidate => candidate.scopeId === scope.scopeId);
      if (ready?.status !== "READY_TO_SEAL") return;
      const check = await this.publication.check(actor, scope.workspaceId, scope.runId, scope.scopeId);
      if (!check.ready) {
        await this.repository.blockAutomaticPublication(actor, scope.workspaceId, scope.runId, scope.scopeId, {
          revision: ready.revision, code: "F002_AUTOMATIC_PUBLICATION_INCOMPLETE",
        });
        return;
      }
      // Stable after crash, duplicate dispatch and lost response. Publication
      // still independently enforces current ACL, closure and C03 ownership.
      try {
        await this.publication.publish(actor, scope.workspaceId, scope.runId, scope.scopeId, {
          revision: ready.revision, operationId: `auto-${scope.runId}-${scope.scopeId}`,
        });
      } catch (error) {
        // Parser/closure faults are visible terminal blockers. Transport faults
        // remain restartable; race/cancel/ACL errors must not overwrite state.
        if (error instanceof F002Error && error.status === 422 && error.code.startsWith("F002_")) {
          await this.repository.blockAutomaticPublication(actor, scope.workspaceId, scope.runId, scope.scopeId, { revision: ready.revision, code: error.code });
        } else throw error;
      }
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

export function technicalF002Profile() {
  const previous = boundedF002Profile();
  const config = { ...previous, version: "4", capabilityIds: [...previous.capabilityIds, "typescript", "sql", "program-logic"],
    ruleVersions: [...previous.ruleVersions, "typescript@2", "sql@1", "program-logic@1"],
    extractionLimits: { ...previous.extractionLimits, programLogic: "bounded-syntax-v1", functionBindings: "initializer-proof-v1",
      functionInitialization: "local-sequence-v1", maxProgramNodes: 20_000,
      staticSql: "literal-statements-v1", maxSqlTokens: 20_000, automaticPublication: "closed-scope-v1" } };
  for (const key of ["id", "configDigest", "name", "startable", "recommended"]) delete config[key];
  return { ...config, configDigest: createProfileConfigDigest(config), id: createProfileId(config), name: "technical-v4", startable: true, recommended: true };
}

// New interactive work retains the v4 parser/rule set; only its publication
// workflow is a new immutable profile. Historical v4 and replay stay untouched.
export function reviewF002Profile() {
  const config = { ...technicalF002Profile(), version: "5", extractionLimits: { ...technicalF002Profile().extractionLimits } };
  delete config.extractionLimits.automaticPublication;
  for (const key of ["id", "configDigest", "name", "startable", "recommended"]) delete config[key];
  return { ...config, configDigest: createProfileConfigDigest(config), id: createProfileId(config), name: "technical-review-v5", startable: true, recommended: true };
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
  const technicalProfile = technicalF002Profile();
  await repository.registerProfile(technicalProfile);
  const reviewProfile = reviewF002Profile();
  await repository.registerProfile(reviewProfile);
  const admission = new F002AdmissionService(repository, sourceRuntime.services.admission);
  const publication = new F002PublicationService(repository);
  const queries = new F002QueryService(repository, { cursorSecret, preferredProfileId: reviewProfile.id });
  // Current READ policy is distinct from the sealed extraction profile. Old
  // canonical records/replay remain immutable while present-day disclosure is safe.
  const materials = new F002MaterialService(repository, admission, { policyRevision: CURRENT_DISPLAY_POLICY_REVISION, queries });
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
  const executor = new F002ExecutionService({ repository, worker, publication, members: sourceRuntime.configuration.members, resolveActor,
    maxConcurrent: Math.min(16, Math.max(1, sourceRuntime.configuration.resources?.workerConcurrency ?? 2)) });
  const services = { repository, admission, publication, queries, materials, requests, replays, replayExecutor, worker, executor, requestExecutor, profile, structuredProfile, boundedProfile, technicalProfile, reviewProfile };
  return { services, start: async () => { await executor.start(); await replayExecutor.start(); if (requestExecutor) await requestExecutor.start(); }, close: async () => {
    // Fence every queue immediately, then drain them all even if a sibling
    // cleanup fails. One long request must not leave scope polling admitted.
    const drains = [requestExecutor, replayExecutor, executor].filter(Boolean).map(service => {
      try { return service.close(); } catch (error) { return Promise.reject(error); }
    });
    const failure = (await Promise.allSettled(drains)).find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  }, deterministicFactsHandler: createF002HttpHandler({
    services,
    authenticate: sourceRepository.identityService ? () => { throw new F002Error("F002_AUTHENTICATION_REQUIRED", "请先登录当前工作区", { status: 401 }); }
      : sourceTruthAuthenticator(sourceRuntime.configuration.members),
    allowedOrigins: sourceRuntime.configuration.origins,
  }) };
}
