// Owned synthetic browser fixture. Not production data, a PostgreSQL proof,
// a F003 resolver, or an approved security/material presentation verdict.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { candidateFixture } from "./source-truth-candidate-fixture.js";
import { owner, reader } from "./source-truth-database.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { SourcePublicationService } from "../../src/source-truth/publication-service.js";
import { sourceTruthAuthenticator } from "../../src/source-truth/authentication.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { createF002Runtime } from "../../src/deterministic-facts/runtime.js";
import { F002Error } from "../../src/deterministic-facts/errors.js";
import { createProfileConfigDigest, createProfileId } from "../../src/deterministic-facts/identity.js";
import { createConfiguredApplication } from "../../src/api/application-bootstrap.js";
import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";

export const fixtureToken = "f002-owned-browser-owner-token";
export const fixtureReaderToken = "f002-owned-browser-reader-token";

export async function f002BrowserFixture({ port = 6225, webPort = 6226, content: suppliedContent = null, entryPath = "preview.application.properties", structured = false, additionalFiles = [], requestResults = false, requestForm = false, requestCatalog = false, requestRecovery = false, deliveryLifecycle = false, requestMaterials = false } = {}) {
  assert.ok(!requestRecovery || (requestForm && !requestResults && !requestCatalog), "request recovery faults require an explicit isolated form fixture");
  assert.ok(!deliveryLifecycle || (!requestForm && !requestResults && !requestCatalog && !requestRecovery), "delivery controls require their own isolated fixture");
  assert.ok(!requestMaterials || (requestForm && !requestResults && !requestCatalog && !requestRecovery && !deliveryLifecycle && additionalFiles.length === 21), "material reselection requires an explicit isolated22-material form fixture");
  assert.ok(Number.isInteger(port) && (port === 0 || port >= 1024) && Number.isInteger(webPort) && webPort >= 1024
    && ![3003, 3004, 6398, 6399].includes(port) && ![3003, 3004, 6398, 6399].includes(webPort));
  const cleanups = [];
  const content = suppliedContent ?? ["password=SYNTHETIC_BROWSER_PASSWORD", "name=orders",
    ...Array.from({ length: 448 }, (_, index) => `# synthetic fixture line ${index + 3}`)].join("\r\n");
  assert.ok(Buffer.isBuffer(content) || typeof content === "string", "owned fixture input must be explicit synthetic bytes");
  const source = await candidateFixture({ after: cleanup => cleanups.push(cleanup) }, { entryPath, content, additionalFiles });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "f002-browser-source" });
  const origins = [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`];
  const members = [[fixtureToken, owner], [fixtureReaderToken, reader]].map(([token, actor]) => ({
    tokenDigest: createHash("sha256").update(token).digest("hex"), ...actor,
  }));
  const services = sourceTruthServices({ repository: source.repository, blobs: source.blobs, policy: capturePolicy() });
  // Explicit test-only consumer seam. No real F003 service, user investigation
  // or production resolver is configured. Result rows still go through the
  // actual F002 submission, execution, publication and authorized GET paths.
  const requestBindings = new Map(), requestReads = new Map();
  const deniedRequestIds = new Set();
  let requestReadAllowed = true;
  const consumerResolver = requestResults || requestForm || requestCatalog ? {
    resolve: async (actor, workspaceId, investigationId) => actor.actorId === owner.actorId && workspaceId === "workspace" ? requestBindings.get(investigationId) ?? null : null,
    authorizeRead: async (actor, workspaceId, investigationId, requestId) => requestReadAllowed && workspaceId === "workspace" && [owner.actorId, reader.actorId].includes(actor.actorId)
      && !deniedRequestIds.has(requestId) && requestReads.get(requestId) === investigationId ? { workspaceId, investigationId, baseVersionId: requestBindings.get(investigationId).baseVersionId, allowedRequestIds: [requestId] } : null,
  } : null;
  const runtime = await createF002Runtime({ sourceRuntime: { pool: source.db, services, configuration: { members, origins } },
    cursorSecret: "owned-f002-browser-cursor-secret-no-production-connection", consumerResolver });
  let manifestUnavailable = false, manifestFaults = 0;
  const actualManifest = runtime.services.queries.manifest.bind(runtime.services.queries);
  runtime.services.queries.manifest = async (...args) => {
    if (manifestUnavailable) {
      manifestFaults += 1;
      // Owned metadata outage only: the real HTTP handler still authenticates,
      // emits its error/CORS contract, and all records/content remain genuine.
      throw new F002Error("F002_OWNED_MANIFEST_UNAVAILABLE", "隔离夹具版本清单暂不可读", { status: 503 });
    }
    return actualManifest(...args);
  };
  const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["inventory"], ruleVersions: ["inventory@1"], canonicalizationVersion: "1",
    extractionLimits: { maxBytes: 8 * 1024 * 1024, maxRecords: 1000, maxMaterials: 1000 }, redactionPolicyRevision: "policy-v1" };
  const inventoryProfile = { ...profileInput, id: createProfileId(profileInput), configDigest: createProfileConfigDigest(profileInput), name: "no-Fact browser fixture", startable: true };
  await runtime.services.repository.registerProfile(inventoryProfile);
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await services.admission.inventory(owner, "workspace", reference);
  const componentId = inventory.items[0].componentId;
  const seedVersion = async (profile, operationId) => {
    const run = await runtime.services.admission.start(owner, "workspace", { operationId, reference, profile,
      scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
    const scope = run.scopes[0];
    const ready = await runtime.services.worker.run(owner, "workspace", run.id, scope.scopeId, { workerId: operationId, leaseMs: 60_000, timeoutMs: 20_000 });
    assert.equal(ready.status, "READY_TO_SEAL", JSON.stringify(ready.diagnostic ?? null));
    const sealed = await runtime.services.publication.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: `${operationId}-seal` });
    const rows = await source.db.query("SELECT id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='MATERIAL'", ["workspace", sealed.graphVersionId]);
    assert.equal(rows.rows.length, 1 + additionalFiles.length);
    const material = rows.rows.find(row => row.payload.pathBytes === source.entry.pathBytes); assert.ok(material);
    return { graphVersionId: sealed.graphVersionId, runId: run.id, material };
  };
  const noFact = await seedVersion(inventoryProfile, "f002-browser-inventory"), standard = await seedVersion(structured ? runtime.services.structuredProfile : runtime.services.profile, "f002-browser-standard");
  const count = (await source.db.query("SELECT count(*)::integer AS n FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT'", ["workspace", noFact.graphVersionId])).rows[0].n;
  assert.equal(count, 0, "the material-only version must actually contain no Fact");
  const requestReceipts = {};
  const formInvestigations = {}, submittedRequests = [];
  const formMissingBase = { investigationId: "owned-form-missing-base", baseVersionId: "0".repeat(64) };
  const materialChoices = requestMaterials ? (await source.db.query("SELECT id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='MATERIAL' ORDER BY id", ["workspace", noFact.graphVersionId])).rows.map(row => ({ id: row.id, label: row.payload.displayPath })) : null;
  const replacement = materialChoices?.slice(20).find(row => row.id !== noFact.material.id);
  if (requestMaterials) assert.ok(replacement, "real second-page material must be distinct from the original");
  if (requestForm) {
    for (const requestKind of ["TARGETED_EVIDENCE", "SUSPECTED_OMISSION", "SUSPECTED_ERROR"]) {
      const investigationId = `owned-form-${requestKind.toLowerCase()}`;
      formInvestigations[requestKind] = investigationId;
      requestBindings.set(investigationId, { investigationId, workspaceId: "workspace", baseVersionId: noFact.graphVersionId, state: "RUNNING",
        allowedFactIds: [], allowedMaterialIds: requestMaterials ? [noFact.material.id, replacement.id] : [noFact.material.id], allowedCapabilities: ["properties"],
        budget: { maxMaterials: 10, maxBytes: 8 * 1024 * 1024, maxRuleApplications: 100, maximumAttempts: 1, deadline: new Date(Date.now() + 600_000).toISOString() } });
    }
    // A trusted test-only binding to an absent version exercises the real
    // service's404, not a mocked HTTP response or a consumer403 substitute.
    assert.notEqual(formMissingBase.baseVersionId, noFact.graphVersionId);
    requestBindings.set(formMissingBase.investigationId, { ...requestBindings.get(formInvestigations.TARGETED_EVIDENCE),
      investigationId: formMissingBase.investigationId, baseVersionId: formMissingBase.baseVersionId });
    const submit = runtime.services.requests.submit.bind(runtime.services.requests);
    runtime.services.requests.submit = async (...args) => {
      const result = await submit(...args);
      // Test-only grant to the genuinely accepted ID in this owned binding.
      // No fake HTTP receipt or production consumer authority is created.
      requestReads.set(result.id, result.investigationId);
      submittedRequests.push({ id: result.id, operationId: result.operationId, requestKind: result.requestKind, baseVersionId: result.baseVersionId,
        investigationId: result.investigationId, materialRefs: args[2].materialRefs, factRefs: args[2].factRefs, requestedCapabilities: args[2].requestedCapabilities });
      return result;
    };
  }
  // Pause dispatch and enqueue together: close() alone only stops polling.
  // Requests remain genuine durable QUEUED rows; no worker/result is replaced.
  const recovery = { paused: false, submissionCount: 0, cancellationCount: 0, droppedRequestResponses: 0, droppedCancelResponses: 0,
    lastDroppedRequest: null, lastDroppedCancel: null, executedRequestIds: [] };
  const requestExecutor = runtime.services.requestExecutor;
  const actualEnqueue = requestRecovery ? requestExecutor.enqueue.bind(requestExecutor) : null;
  if (requestRecovery) {
    requestExecutor.enqueue = request => recovery.paused ? Promise.resolve() : actualEnqueue(request);
    const execute = runtime.services.requests.execute.bind(runtime.services.requests);
    runtime.services.requests.execute = async (...args) => {
      recovery.executedRequestIds.push(args[2]); return execute(...args);
    };
  }
  // Scheduler controls retain real durable QUEUED work, not fabricated states,
  // outputs or worker results. Both enqueue and polling must be paused.
  const delivery = { executorPaused: false, replayPaused: false, executedScopes: [], executedReplayIds: [],
    profileId: runtime.services.profile.id, componentId };
  const executor = runtime.services.executor, replayExecutor = runtime.services.replayExecutor;
  const originalRunEnqueue = executor.enqueue.bind(executor), originalReplayEnqueue = replayExecutor.enqueue.bind(replayExecutor);
  const originalWorkerRun = runtime.services.worker.run.bind(runtime.services.worker), originalReplayExecute = runtime.services.replays.execute.bind(runtime.services.replays);
  if (deliveryLifecycle) {
    executor.enqueue = run => delivery.executorPaused ? Promise.resolve() : originalRunEnqueue(run);
    replayExecutor.enqueue = replay => delivery.replayPaused ? Promise.resolve() : originalReplayEnqueue(replay);
    runtime.services.worker.run = async (...args) => {
      delivery.executedScopes.push({ runId: args[2], scopeId: args[3] }); return originalWorkerRun(...args);
    };
    runtime.services.replays.execute = async (...args) => {
      delivery.executedReplayIds.push(args[2]); return originalReplayExecute(...args);
    };
  }
  if (requestResults) {
    const firstFact = (await source.db.query("SELECT id FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT' ORDER BY id LIMIT 1", ["workspace", standard.graphVersionId])).rows[0];
    assert.ok(firstFact, "request result fixture needs genuine extracted evidence");
    for (const outcome of ["EXISTING_EVIDENCE", "NEW_VERSION", "LIMITATION", "REJECTED"]) {
      const target = outcome === "EXISTING_EVIDENCE" ? standard : noFact;
      const investigationId = `owned-request-${outcome.toLowerCase()}`;
      const binding = { investigationId, workspaceId: "workspace", baseVersionId: target.graphVersionId, state: "RUNNING",
        allowedFactIds: outcome === "EXISTING_EVIDENCE" ? [firstFact.id] : [], allowedMaterialIds: [target.material.id], allowedCapabilities: ["properties"],
        budget: { maxMaterials: 10, maxBytes: 8 * 1024 * 1024, maxRuleApplications: 100, maximumAttempts: 2, deadline: new Date(Date.now() + 600_000).toISOString() } };
      requestBindings.set(investigationId, binding);
      const submitted = await runtime.services.requests.submit(owner, "workspace", { operationId: investigationId, investigationId, baseVersionId: target.graphVersionId,
        requestKind: "TARGETED_EVIDENCE", question: "Owned synthetic result navigation check; not a user investigation.", materialRefs: [target.material.id],
        factRefs: outcome === "EXISTING_EVIDENCE" ? [firstFact.id] : [], requestedCapabilities: outcome === "NEW_VERSION" ? ["properties"] : [] });
      requestReads.set(submitted.id, investigationId);
      if (outcome === "REJECTED") binding.state = "STOPPED";
      const completed = await runtime.services.requests.execute(owner, "workspace", submitted.id, { workerId: investigationId, leaseMs: 60_000 });
      assert.equal(completed.status, "COMPLETED"); assert.equal(completed.outcome, outcome, "never fabricate a result classification for the browser");
      assert.equal((await runtime.services.requests.get(reader, "workspace", completed.id)).id, completed.id);
      requestReceipts[outcome] = { id: completed.id, baseVersionId: completed.baseVersionId, graphVersionId: completed.result?.graphVersionId ?? null,
        factId: outcome === "EXISTING_EVIDENCE" ? firstFact.id : null };
    }
  }
  let catalog = null;
  if (requestCatalog) {
    const investigationId = "owned-catalog-investigation";
    const binding = { investigationId, workspaceId: "workspace", baseVersionId: noFact.graphVersionId, state: "RUNNING",
      allowedFactIds: [], allowedMaterialIds: [noFact.material.id], allowedCapabilities: ["properties"],
      budget: { maxMaterials: 10, maxBytes: 8 * 1024 * 1024, maxRuleApplications: 100, maximumAttempts: 2, deadline: new Date(Date.now() + 600_000).toISOString() } };
    requestBindings.set(investigationId, binding);
    const ids = [];
    for (let index = 0; index < 25; index++) {
      const row = await runtime.services.requests.submit(owner, "workspace", { operationId: `owned-catalog-${index}`, investigationId,
        baseVersionId: noFact.graphVersionId, requestKind: "TARGETED_EVIDENCE", question: `Owned catalog question ${index}; no adoption.`,
        materialRefs: [noFact.material.id], factRefs: [], requestedCapabilities: [] });
      requestReads.set(row.id, investigationId); ids.push(row.id);
      const completed = await runtime.services.requests.execute(owner, "workspace", row.id, { workerId: `owned-catalog-${index}` });
      assert.equal(completed.status, "COMPLETED"); assert.equal(completed.outcome, "LIMITATION");
    }
    const hiddenId = ids[4]; deniedRequestIds.add(hiddenId);
    const permitted = ids.filter(id => id !== hiddenId).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    catalog = { investigationId, ids: permitted, hiddenId, revokeTargetId: permitted[1],
      trusted: await runtime.services.requests.investigation(owner, "workspace", investigationId, noFact.graphVersionId) };
  }
  const configured = createConfiguredApplication({ store: new PostgresTraceabilityStore(source.db), env: { CORS_ALLOWED_ORIGINS: origins.join(",") } });
  await configured.ready;
  const server = createTraceabilityHttpServer({ application: configured.application, corsAllowedOrigins: origins, sourceTruthAllowedOrigins: origins,
    apiBearerToken: fixtureToken, sourceTruthHandler: createSourceTruthHttpHandler({ services, authenticate: sourceTruthAuthenticator(members), allowedOrigins: origins }),
    deterministicFactsHandler: runtime.deterministicFactsHandler, deterministicFactsAllowedOrigins: origins });
  let dropNextRunResponse = false, startRunCount = 0, droppedRunResponses = 0, lastDroppedResponse = null;
  let dropNextRequestResponse = false, dropNextRequestCancelResponse = false;
  const handlers = server.listeners("request"); server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    if (pathname.startsWith("/__f002_fixture/")) {
      if (request.headers.authorization !== `Bearer ${fixtureToken}`) { response.writeHead(401).end(); return; }
      void (async () => {
        if (pathname.endsWith("/revoke-reader") && request.method === "POST") await source.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "REVOKED" }] });
        else if (pathname.endsWith("/restore-reader") && request.method === "POST") await source.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "READ" }] });
        else if (pathname.endsWith("/drop-next-run-response") && request.method === "POST") dropNextRunResponse = true;
        else if (pathname.endsWith("/fail-manifest") && request.method === "POST") manifestUnavailable = true;
        else if (pathname.endsWith("/restore-manifest") && request.method === "POST") manifestUnavailable = false;
        else if (requestResults && pathname.endsWith("/revoke-request-read") && request.method === "POST") requestReadAllowed = false;
        else if (requestResults && pathname.endsWith("/restore-request-read") && request.method === "POST") requestReadAllowed = true;
        else if (requestCatalog && pathname.endsWith("/revoke-catalog-row") && request.method === "POST") deniedRequestIds.add(catalog.revokeTargetId);
        else if (requestCatalog && pathname.endsWith("/stop-catalog-investigation") && request.method === "POST") requestBindings.get(catalog.investigationId).state = "STOPPED";
        else if (requestRecovery && pathname.endsWith("/pause-request-executor") && request.method === "POST") { recovery.paused = true; await requestExecutor.close(); }
        else if (requestRecovery && pathname.endsWith("/resume-request-executor") && request.method === "POST") { recovery.paused = false; await requestExecutor.start(); }
        else if (requestRecovery && pathname.endsWith("/drop-next-request-response") && request.method === "POST") dropNextRequestResponse = true;
        else if (requestRecovery && pathname.endsWith("/drop-next-request-cancel-response") && request.method === "POST") dropNextRequestCancelResponse = true;
        else if (deliveryLifecycle && pathname.endsWith("/pause-delivery-executor") && request.method === "POST") { delivery.executorPaused = true; await executor.close(); }
        else if (deliveryLifecycle && pathname.endsWith("/resume-delivery-executor") && request.method === "POST") { delivery.executorPaused = false; await executor.start(); }
        else if (deliveryLifecycle && pathname.endsWith("/pause-delivery-replays") && request.method === "POST") { delivery.replayPaused = true; await replayExecutor.close(); }
        else if (deliveryLifecycle && pathname.endsWith("/resume-delivery-replays") && request.method === "POST") { delivery.replayPaused = false; await replayExecutor.start(); }
        else if (!pathname.endsWith("/metadata") || request.method !== "GET") { response.writeHead(404).end(); return; }
        const chunks = [];
        for await (const chunk of runtime.services.admission.readFile(owner, "workspace", noFact.runId,
          { componentId, pathBytes: noFact.material.payload.pathBytes })) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        assert.deepEqual(bytes, source.bytes, "actual F001 re-read after browser presentation must be byte-for-byte stable");
        assert.equal(createHash("sha256").update(bytes).digest("hex"), source.digest);
        for (const file of source.additional) {
          const chunks = []; for await (const chunk of runtime.services.admission.readFile(owner, "workspace", noFact.runId, { componentId, pathBytes: file.entry.pathBytes })) chunks.push(Buffer.from(chunk));
          assert.deepEqual(Buffer.concat(chunks), file.bytes); assert.equal(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"), file.digest);
        }
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({
          workspaceId: "workspace", sourceVersionId: reference.bundleId, originalDigest: source.digest, sourceStable: true, additionalSourceStable: true, fileCount: 1 + source.additional.length, startRunCount,
          dropNextRunResponse, droppedRunResponses, lastDroppedResponse,
          manifestUnavailable, manifestFaults,
          noFact: { graphVersionId: noFact.graphVersionId, materialId: noFact.material.id, factCount: count },
          standard: { graphVersionId: standard.graphVersionId, materialId: standard.material.id },
          ...(requestResults ? { requestReceipts, requestReadAllowed, consumerFixture: "OWNED_RESOLVER_TEST_DOUBLE_ONLY" } : {}),
          ...(requestForm ? { formInvestigations, formMissingBase, submittedRequests, consumerFixture: "OWNED_RESOLVER_TEST_DOUBLE_ONLY" } : {}),
          ...(requestMaterials ? { requestMaterials: { choices: materialChoices, replacement } } : {}),
          ...(requestCatalog ? { catalog, consumerFixture: "OWNED_RESOLVER_TEST_DOUBLE_ONLY" } : {}),
          ...(requestRecovery ? { requestRecovery: recovery } : {}),
          ...(deliveryLifecycle ? { delivery } : {}),
        }));
      })().catch(() => response.writeHead(500).end("owned fixture failed"));
      return;
    }
    if (requestRecovery && request.method === "POST") {
      const submitting = pathname === "/v1/workspaces/workspace/deterministic-facts/requests";
      const cancelling = /^\/v1\/workspaces\/workspace\/deterministic-facts\/requests\/[A-Za-z0-9-]{1,128}\/cancel$/.test(pathname);
      if (submitting) recovery.submissionCount += 1;
      if (cancelling) recovery.cancellationCount += 1;
      if ((submitting && dropNextRequestResponse) || (cancelling && dropNextRequestCancelResponse)) {
        if (submitting) dropNextRequestResponse = false; else dropNextRequestCancelResponse = false;
        let dropped = false;
        response.end = chunk => {
          if (dropped) return response;
          dropped = true;
          const value = JSON.parse(String(chunk))?.request;
          const receipt = { status: response.statusCode, requestId: value?.id ?? null,
            operationId: value?.operationId ?? null, cancelOperationId: value?.cancelOperationId ?? null };
          if (submitting) { recovery.droppedRequestResponses += 1; recovery.lastDroppedRequest = receipt; }
          else { recovery.droppedCancelResponses += 1; recovery.lastDroppedCancel = receipt; }
          // Real headers/Content-Length plus a truncated real response body:
          // Chromium cannot transparently replay this already-received POST.
          response.write("{", () => response.destroy()); return response;
        };
      }
    }
    if (request.method === "POST" && pathname === "/v1/workspaces/workspace/deterministic-facts/runs") {
      startRunCount += 1;
      if (dropNextRunResponse) {
        dropNextRunResponse = false;
        // The actual handler commits the original operation before sendJson
        // calls end. Only its response is lost; never fake a successful receipt.
        let dropped = false;
        response.end = chunk => {
          if (dropped) return response;
          dropped = true; droppedRunResponses += 1;
          let accepted;
          try { accepted = JSON.parse(String(chunk)); } catch { accepted = null; }
          // Persist only the actual committed response's IDs/status as fixture
          // evidence, never its source, facts, credentials or full body.
          lastDroppedResponse = { status: response.statusCode, operationId: accepted?.run?.operationId ?? null, runId: accepted?.run?.id ?? null };
          // Deliver the real response headers and an intentionally incomplete
          // JSON body before disconnecting. Closing before any response byte
          // permits Chromium to transparently replay the same POST on another
          // connection, which is not an unknown-response recovery scenario.
          // The normal Content-Length still describes the actual response;
          // neither its receipt nor the database is replaced with a fake.
          response.write("{", () => response.destroy());
          return response;
        };
      }
    }
    for (const handler of handlers) handler.call(server, request, response);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  await runtime.start();
  return { metadata: { noFact, standard, reference }, api: `http://127.0.0.1:${server.address().port}`, server, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (requestRecovery) requestExecutor.enqueue = actualEnqueue;
    if (deliveryLifecycle) {
      executor.enqueue = originalRunEnqueue; replayExecutor.enqueue = originalReplayEnqueue;
      runtime.services.worker.run = originalWorkerRun; runtime.services.replays.execute = originalReplayExecute;
    }
    await runtime.close(); for (const cleanup of cleanups.reverse()) await cleanup();
  } };
}
