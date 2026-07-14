import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  createSnapshotManifest,
  createTestSpec,
  evaluateTraceChain,
  generateEndpointTestSpecDraft,
  verifyExecutionEvidenceAttestation,
} from "../src/domain/index.js";
import {
  ControlledRunner,
  DatabaseExecutor,
  FixtureLifecycleExecutor,
  HttpExecutor,
  assertReadOnlySql,
  runnerPolicyHash,
  signRunnerTask,
} from "../src/runner/index.js";
import { completeInput } from "./fixtures.js";

const runnerSecret = "runner-shared-secret";

function snapshotManifest() {
  return createSnapshotManifest(
    {
      source: { id: "SOURCE-001", digest: "sha256:source" },
      build: { id: "BUILD-001", digest: "sha256:build" },
      deployment: { id: "DEPLOY-001", digest: "sha256:deployment" },
      runtime: { id: "RUNTIME-001", digest: "sha256:runtime" },
      observedFrom: "2026-07-14T05:00:00.000Z",
      observedTo: "2026-07-14T05:05:00.000Z",
    },
    () => new Date("2026-07-14T05:06:00.000Z"),
  );
}

function testSpec(input = {}) {
  const snapshot = snapshotManifest();
  return createTestSpec(
    {
      id: "TEST-READ-001",
      version: 1,
      name: "Read order",
      risk: "LOW",
      approved: true,
      approval: {
        actorId: "USER-001",
        actorRole: "quality-owner",
        approvedAt: "2026-07-14T05:20:00.000Z",
      },
      featureId: "FEATURE-001",
      verifiesClaims: [{ id: "CLAIM-001", version: 1 }],
      sourceSnapshotId: snapshot.id,
      environment: { target: "sit", operationLevel: "SAFE_READ" },
      variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
      steps: [
        {
          id: "read-order",
          executor: "HTTP",
          method: "GET",
          path: "/orders/1",
          headers: { Authorization: "Bearer ${accessToken}" },
        },
      ],
      assertions: [
        { id: "http-status", type: "HTTP_STATUS", stepId: "read-order", expected: 200 },
        {
          id: "order-status",
          type: "JSON_PATH",
          stepId: "read-order",
          expression: "$.data.status",
          expected: "DRAFT",
        },
      ],
      cleanup: null,
      policy: { approvalRequired: true },
      createdAt: "2026-07-14T05:30:00.000Z",
      ...input,
    },
    () => new Date("2026-07-14T05:30:00.000Z"),
  );
}

function sequenceClock() {
  const values = [
    new Date("2026-07-14T06:00:00.000Z"),
    new Date("2026-07-14T06:00:01.000Z"),
  ];
  return () => values.shift() ?? new Date("2026-07-14T06:00:01.000Z");
}

function taskFor({ executionId, specification, snapshot, policy, nonce = executionId }) {
  return signRunnerTask(
    {
      id: `TASK-${executionId}`,
      projectId: "PROJECT-001",
      executionId,
      runnerId: "RUNNER-001",
      nonce,
      policyHash: runnerPolicyHash(policy),
      issuedAt: "2026-07-14T05:59:00.000Z",
      expiresAt: "2026-07-14T06:04:00.000Z",
      testSpec: specification,
      snapshotManifest: snapshot,
    },
    runnerSecret,
  );
}

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("controlled Runner executes allowlisted HTTP and emits signed redacted Evidence", async (t) => {
  const baseUrl = await listen(t, (request, response) => {
    response.writeHead(200, { "content-type": "application/json", "set-cookie": "session=server-secret" });
    response.end(
      JSON.stringify({
        data: { status: "DRAFT", echoedToken: request.headers.authorization },
      }),
    );
  });
  const targetPolicy = {
    baseUrl,
    allowedOperationLevels: ["SAFE_READ"],
    httpAllowlist: [{ method: "GET", pathPattern: "^/orders/[0-9]+$" }],
  };
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async (secretRef) =>
      secretRef === "accounts/normal-user/token" ? "local-secret-token" : null,
    executors: { HTTP: new HttpExecutor() },
    clock: sequenceClock(),
  });

  const specification = testSpec();
  const snapshot = snapshotManifest();
  const bundle = await runner.run(taskFor({
    executionId: "EXEC-HTTP-001",
    specification,
    snapshot,
    policy: targetPolicy,
  }));

  assert.equal(bundle.execution.status, "PASS");
  assert.deepEqual(
    bundle.execution.attempts[0].assertionResults.map((result) => result.status),
    ["PASS", "PASS"],
  );
  assert.equal(verifyExecutionEvidenceAttestation("PROJECT-001", bundle, runnerSecret), true);
  assert.doesNotMatch(JSON.stringify(bundle), /local-secret-token|server-secret/);
  assert.match(JSON.stringify(bundle), /\[REDACTED\]/);
  assert.ok(bundle.evidence.some((item) => item.type === "HTTP"));
  assert.ok(bundle.evidence.some((item) => item.type === "ASSERTION"));

  const traceInput = completeInput();
  traceInput.snapshotManifest = snapshot;
  traceInput.conformance.snapshotManifestId = snapshot.id;
  traceInput.testSpec = specification;
  traceInput.execution = bundle.execution;
  traceInput.evidence = bundle.evidence.map((item) => ({ ...item, integrity: "VERIFIED" }));
  const traceChain = evaluateTraceChain(
    traceInput,
    () => new Date("2026-07-14T06:01:00.000Z"),
  );
  assert.equal(traceChain.complete, true);
  assert.equal(traceChain.dimensions.verification, "PASS");
});

test("database executor uses the trusted query catalog and deterministic assertions", async (t) => {
  const queries = [];
  const postgres = await PGlite.create();
  t.after(() => postgres.close());
  await postgres.exec("CREATE TABLE orders (id text PRIMARY KEY, status text NOT NULL)");
  await postgres.query("INSERT INTO orders (id, status) VALUES ($1, $2)", ["ORDER-001", "DRAFT"]);
  const database = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return postgres.query(sql, parameters);
    },
  };
  const targetPolicy = {
    allowedOperationLevels: ["SAFE_READ"],
    databaseRef: "orders-readonly",
    queryCatalog: {
      order_by_id: {
        sql: "SELECT status FROM orders WHERE id = $1",
        safeRead: true,
        maxRows: 1,
      },
    },
  };
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async () => null,
    executors: {
      DATABASE: new DatabaseExecutor({ databaseResolver: async () => database }),
    },
    clock: sequenceClock(),
  });
  const specification = testSpec({
    variables: { orderId: "ORDER-001" },
    steps: [
      {
        id: "read-order-row",
        executor: "DATABASE",
        queryRef: "order_by_id",
        parameters: ["${orderId}"],
      },
    ],
    assertions: [
      { id: "row-count", type: "DATABASE_ROW_COUNT", stepId: "read-order-row", expected: 1 },
      {
        id: "database-status",
        type: "DATABASE_FIELD",
        stepId: "read-order-row",
        row: 0,
        field: "status",
        expected: "DRAFT",
      },
    ],
  });

  const snapshot = snapshotManifest();
  const bundle = await runner.run(taskFor({
    executionId: "EXEC-DB-001",
    specification,
    snapshot,
    policy: targetPolicy,
  }));

  assert.equal(bundle.execution.status, "PASS");
  assert.deepEqual(queries, [
    { sql: "SELECT status FROM orders WHERE id = $1", parameters: ["ORDER-001"] },
  ]);
  const databaseEvidence = bundle.evidence.find((item) => item.type === "DATABASE");
  assert.equal(databaseEvidence.manifest.stepResult.sql, "SELECT status FROM orders WHERE id = $1");
  assert.equal(databaseEvidence.manifest.stepResult.rows[0].status, "DRAFT");
});

test("controlled write seeds data, executes an allowlisted API, verifies the database, and always cleans up", async (t) => {
  const postgres = await PGlite.create();
  t.after(() => postgres.close());
  await postgres.exec("CREATE TABLE orders (id text PRIMARY KEY, status text NOT NULL)");
  const baseUrl = await listen(t, async (request, response) => {
    const match = /^\/orders\/([^/]+)\/submit$/.exec(request.url);
    if (request.method !== "POST" || !match) {
      response.writeHead(404).end();
      return;
    }
    await postgres.query("UPDATE orders SET status = $1 WHERE id = $2", [
      "SUBMITTED",
      decodeURIComponent(match[1]),
    ]);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { id: decodeURIComponent(match[1]), status: "SUBMITTED" } }));
  });
  const database = {
    query: (sql, parameters) => postgres.query(sql, parameters),
  };
  const targetPolicy = {
    baseUrl,
    allowedOperationLevels: ["CONTROLLED_WRITE"],
    maxRequestBytes: 4096,
    httpAllowlist: [{
      method: "POST",
      pathPattern: "^/orders/[^/]+/submit$",
      operationLevels: ["CONTROLLED_WRITE"],
      maxRequestBytes: 1024,
    }],
    databaseRef: "orders-readonly",
    queryCatalog: {
      order_by_id: {
        sql: "SELECT status FROM orders WHERE id = $1",
        safeRead: true,
        maxRows: 1,
      },
    },
    fixtureCatalog: {
      "draft-order": {
        protocolVersion: "1.0.0",
        cleanupStrategies: ["SEED_RESET"],
        compensationRef: "COMPENSATE-DRAFT-ORDER",
      },
    },
  };
  const lifecycleCalls = [];
  const fixtureLifecycle = new FixtureLifecycleExecutor({
    handlerResolver: async (seedRef) => seedRef === "draft-order" ? {
      async setup(seed) {
        lifecycleCalls.push("setup");
        await postgres.query("DELETE FROM orders WHERE id = $1", [seed.parameters.orderId]);
        await postgres.query("INSERT INTO orders (id, status) VALUES ($1, $2)", [
          seed.parameters.orderId,
          "DRAFT",
        ]);
        return {
          bindings: { seed: { orderId: seed.parameters.orderId } },
          state: { orderId: seed.parameters.orderId },
          evidence: { seededStatus: "DRAFT" },
        };
      },
      async cleanup({ state }) {
        lifecycleCalls.push("cleanup");
        await postgres.query("DELETE FROM orders WHERE id = $1", [state.orderId]);
        return { evidence: { removedOrderId: state.orderId } };
      },
    } : null,
  });
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.1.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async (secretRef) =>
      secretRef === "accounts/normal-user/token" ? "local-write-token" : null,
    fixtureLifecycle,
    executors: {
      HTTP: new HttpExecutor(),
      DATABASE: new DatabaseExecutor({ databaseResolver: async () => database }),
    },
    clock: sequenceClock(),
  });
  const snapshot = snapshotManifest();
  const generated = generateEndpointTestSpecDraft({
    id: "TEST-WRITE-001",
    projectId: "PROJECT-001",
    target: "sit",
    expectedHttpStatus: 200,
    claim: {
      id: "CLAIM-001",
      version: 1,
      featureId: "FEATURE-001",
      type: "NORMATIVE_REQUIREMENT",
      constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
    },
    decision: { id: "DECISION-001", type: "CONFIRMED" },
    mapping: {
      id: "MAPPING-001",
      snapshotManifestId: snapshot.id,
      factRefs: [{ factId: "FACT-ENDPOINT-WRITE-001", relation: "SUPPORTS" }],
    },
    endpoint: {
      factId: "FACT-ENDPOINT-WRITE-001",
      type: "ENDPOINT",
      attributes: { method: "POST", path: "/orders/{id}/submit" },
    },
    preconditions: [{
      type: "SEED",
      seedRef: "draft-order",
      parameters: { orderId: "ORDER-001" },
    }],
    pathParameters: { id: "${seed.orderId}" },
    variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
    headers: { Authorization: "Bearer ${accessToken}" },
    body: { orderId: "${seed.orderId}" },
    databaseVerification: {
      stepId: "read-order-row",
      queryRef: "order_by_id",
      parameters: ["${seed.orderId}"],
      assertions: [{
        id: "database-status",
        type: "DATABASE_FIELD",
        row: 0,
        field: "status",
        expected: "SUBMITTED",
      }],
    },
    cleanup: { strategy: "SEED_RESET" },
  }, () => new Date("2026-07-14T05:10:00.000Z"));
  assert.deepEqual(generated.validation.violations.map((item) => item.code), ["APPROVAL_REQUIRED"]);
  const specification = createTestSpec({
    ...generated.draft,
    version: 2,
    approved: true,
    approval: {
      actorId: "USER-001",
      actorRole: "quality-owner",
      approvedAt: "2026-07-14T05:20:00.000Z",
      rationale: "Approve the isolated API and database verification protocol.",
      requestFingerprint: "APPROVAL-FINGERPRINT-001",
    },
    createdAt: "2026-07-14T05:30:00.000Z",
  });
  const bundle = await runner.run(taskFor({
    executionId: "EXEC-WRITE-001",
    specification,
    snapshot,
    policy: targetPolicy,
  }));

  assert.equal(bundle.execution.status, "PASS");
  assert.equal(bundle.execution.attempts[0].setup.status, "PASS");
  assert.equal(bundle.execution.attempts[0].cleanup.status, "PASS");
  assert.deepEqual(lifecycleCalls, ["setup", "cleanup"]);
  assert.equal((await postgres.query("SELECT count(*)::int AS count FROM orders")).rows[0].count, 0);
  assert.equal(verifyExecutionEvidenceAttestation("PROJECT-001", bundle, runnerSecret), true);
  assert.doesNotMatch(JSON.stringify(bundle), /local-write-token/);
  assert.ok(bundle.evidence.some((item) => item.type === "HTTP"));
  assert.equal(
    bundle.evidence.find((item) => item.type === "DATABASE").manifest.stepResult.sql,
    "SELECT status FROM orders WHERE id = $1",
  );
  assert.ok(bundle.evidence.some((item) => item.id.endsWith("-LIFECYCLE")));
  const traceInput = completeInput();
  traceInput.snapshotManifest = snapshot;
  traceInput.conformance.snapshotManifestId = snapshot.id;
  traceInput.testSpec = specification;
  traceInput.execution = bundle.execution;
  traceInput.evidence = bundle.evidence.map((item) => ({ ...item, integrity: "VERIFIED" }));
  const traceChain = evaluateTraceChain(
    traceInput,
    () => new Date("2026-07-14T06:01:00.000Z"),
  );
  assert.equal(traceChain.complete, true);
  assert.equal(traceChain.dimensions.verification, "PASS");

  const laterSnapshot = createSnapshotManifest({
    source: { id: "SOURCE-002", digest: "sha256:source-002" },
    build: { id: "BUILD-002", digest: "sha256:build-002" },
    deployment: { id: "DEPLOY-002", digest: "sha256:deployment-002" },
    runtime: { id: "RUNTIME-002", digest: "sha256:runtime-002" },
    observedFrom: "2026-07-14T05:40:00.000Z",
    observedTo: "2026-07-14T05:50:00.000Z",
  }, () => new Date("2026-07-14T05:51:00.000Z"));
  const regressionBundle = await runner.run(taskFor({
    executionId: "EXEC-WRITE-REGRESSION-002",
    specification,
    snapshot: laterSnapshot,
    policy: targetPolicy,
  }));
  assert.equal(regressionBundle.execution.status, "PASS");
  assert.equal(regressionBundle.execution.snapshotManifestId, laterSnapshot.id);
  assert.equal(regressionBundle.execution.deploymentId, laterSnapshot.components.deployment.id);
  assert.equal(specification.sourceSnapshotId, snapshot.id);
  assert.deepEqual(lifecycleCalls, ["setup", "cleanup", "setup", "cleanup"]);
});

test("cleanup failure produces ERROR evidence and an explicit compensation reference", async () => {
  const targetPolicy = {
    allowedOperationLevels: ["CONTROLLED_WRITE"],
    fixtureCatalog: {
      "draft-order": {
        cleanupStrategies: ["SEED_RESET"],
        compensationRef: "COMPENSATE-DRAFT-ORDER",
      },
    },
  };
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.1.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async () => null,
    fixtureLifecycle: new FixtureLifecycleExecutor({
      handlerResolver: async () => ({
        setup: async () => ({ bindings: {}, state: { seeded: true } }),
        cleanup: async () => {
          throw new Error("fixture database unavailable");
        },
      }),
    }),
    executors: {
      HTTP: {
        execute: async (step) => ({
          id: step.id,
          executor: "HTTP",
          status: "PASS",
          response: { status: 200, headers: {}, body: "{}", json: {} },
        }),
      },
    },
    clock: sequenceClock(),
  });
  const specification = testSpec({
    id: "TEST-CLEANUP-ERROR-001",
    risk: "HIGH",
    variables: {},
    environment: { target: "sit", operationLevel: "CONTROLLED_WRITE" },
    preconditions: [{ type: "SEED", seedRef: "draft-order" }],
    steps: [{ id: "write", executor: "HTTP", method: "POST", path: "/orders" }],
    assertions: [{ id: "status", type: "HTTP_STATUS", stepId: "write", expected: 200 }],
    cleanup: { strategy: "SEED_RESET" },
  });
  const snapshot = snapshotManifest();
  const bundle = await runner.run(taskFor({
    executionId: "EXEC-CLEANUP-ERROR-001",
    specification,
    snapshot,
    policy: targetPolicy,
  }));

  assert.equal(bundle.execution.status, "ERROR");
  assert.equal(bundle.execution.attempts[0].cleanup.status, "ERROR");
  assert.equal(bundle.execution.attempts[0].cleanup.isolationRequired, true);
  assert.equal(bundle.execution.attempts[0].cleanup.compensationRef, "COMPENSATE-DRAFT-ORDER");
  assert.equal(bundle.evidence.find((item) => item.id.endsWith("-LIFECYCLE")).freshness, "INCOMPLETE");
});

test("runner records assertion failure separately from execution errors", async (t) => {
  const baseUrl = await listen(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { status: "SUBMITTED" } }));
  });
  const targetPolicy = {
    baseUrl,
    allowedOperationLevels: ["SAFE_READ"],
    httpAllowlist: [{ method: "GET", pathPattern: "^/orders/[0-9]+$" }],
  };
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async () => "local-secret-token",
    executors: { HTTP: new HttpExecutor() },
    clock: sequenceClock(),
  });

  const specification = testSpec();
  const snapshot = snapshotManifest();
  const bundle = await runner.run(taskFor({
    executionId: "EXEC-FAIL-001",
    specification,
    snapshot,
    policy: targetPolicy,
  }));

  assert.equal(bundle.execution.status, "FAIL");
  assert.equal(bundle.execution.attempts[0].phaseStatus, "PASS");
  assert.equal(bundle.execution.attempts[0].assertionResults[1].status, "FAIL");
});

test("unallowlisted targets and raw SQL are never executed", async () => {
  const httpCalls = [];
  const httpExecutor = new HttpExecutor({
    fetchImpl: async (...args) => {
      httpCalls.push(args);
      throw new Error("must not execute");
    },
  });
  await assert.rejects(
    httpExecutor.execute(
      { id: "blocked", method: "GET", path: "/admin/secrets" },
      {
        targetPolicy: {
          baseUrl: "http://127.0.0.1:3000",
          httpAllowlist: [{ method: "GET", pathPattern: "^/orders/" }],
        },
      },
    ),
    /not allowlisted/,
  );
  await assert.rejects(
    httpExecutor.execute(
      { id: "secret-url", method: "GET", path: "/orders/local-secret-token" },
      {
        operationLevel: "SAFE_READ",
        secretValues: new Set(["local-secret-token"]),
        targetPolicy: {
          baseUrl: "http://127.0.0.1:3000",
          httpAllowlist: [{ method: "GET", pathPattern: "^/orders/" }],
        },
      },
    ),
    /must not be placed in an HTTP URL/,
  );
  assert.deepEqual(httpCalls, []);

  await assert.rejects(
    httpExecutor.execute(
      { id: "blocked-write", method: "POST", path: "/orders", body: { status: "DRAFT" } },
      {
        operationLevel: "CONTROLLED_WRITE",
        targetPolicy: {
          baseUrl: "http://127.0.0.1:3000",
          httpAllowlist: [{ method: "POST", pathPattern: "^/orders$" }],
        },
      },
    ),
    /not allowlisted for CONTROLLED_WRITE/,
  );
  await assert.rejects(
    httpExecutor.execute(
      { id: "blocked-delete", method: "DELETE", path: "/orders/1" },
      {
        operationLevel: "CONTROLLED_WRITE",
        targetPolicy: {
          baseUrl: "http://127.0.0.1:3000",
          httpAllowlist: [{
            method: "DELETE",
            pathPattern: "^/orders/1$",
            operationLevels: ["CONTROLLED_WRITE"],
          }],
        },
      },
    ),
    /DELETE is not allowed for CONTROLLED_WRITE/,
  );
  assert.deepEqual(httpCalls, []);

  assert.throws(() => assertReadOnlySql("DELETE FROM orders"), /read-only SELECT/);
  assert.throws(() => assertReadOnlySql("SELECT 1; DROP TABLE orders"), /exactly one/);
});

test("Runner rejects tampered, replayed, expired, and policy-drifted tasks before execution", async () => {
  const targetPolicy = {
    baseUrl: "http://127.0.0.1:3000",
    allowedOperationLevels: ["SAFE_READ"],
    httpAllowlist: [{ method: "GET", pathPattern: "^/orders/[0-9]+$" }],
  };
  let calls = 0;
  let policyLookups = 0;
  const executor = {
    async execute(step) {
      calls += 1;
      return {
        id: step.id,
        executor: "HTTP",
        status: "PASS",
        response: { status: 200, headers: {}, body: "{}", json: { data: { status: "DRAFT" } } },
      };
    },
  };
  const runner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => {
      policyLookups += 1;
      return targetPolicy;
    },
    secretResolver: async () => "local-secret-token",
    executors: { HTTP: executor },
    clock: sequenceClock(),
  });
  const specification = testSpec();
  const snapshot = snapshotManifest();
  const task = taskFor({
    executionId: "EXEC-TASK-001",
    specification,
    snapshot,
    policy: targetPolicy,
    nonce: "NONCE-001",
  });

  await runner.run(task);
  await assert.rejects(runner.run(task), /nonce has already been used/);
  const tampered = structuredClone(task);
  tampered.executionId = "EXEC-TAMPERED";
  await assert.rejects(runner.run(tampered), /signature is invalid/);
  assert.equal(calls, 1);
  assert.equal(policyLookups, 1);

  const driftedRunner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => ({ ...targetPolicy, httpAllowlist: [] }),
    secretResolver: async () => "local-secret-token",
    executors: { HTTP: executor },
    clock: sequenceClock(),
  });
  await assert.rejects(driftedRunner.run(task), /policyHash does not match/);

  const expired = signRunnerTask(
    {
      ...task,
      nonce: "NONCE-EXPIRED",
      issuedAt: "2026-07-14T05:54:00.000Z",
      expiresAt: "2026-07-14T05:59:00.000Z",
    },
    runnerSecret,
  );
  const expiryRunner = new ControlledRunner({
    runner: { id: "RUNNER-001", version: "1.0.0" },
    runnerSecret,
    targetPolicyResolver: async () => targetPolicy,
    secretResolver: async () => "local-secret-token",
    executors: { HTTP: executor },
    clock: sequenceClock(),
  });
  await assert.rejects(expiryRunner.run(expired), /validity window/);
  assert.equal(calls, 1);
});
