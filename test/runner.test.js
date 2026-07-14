import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  createSnapshotManifest,
  createTestSpec,
  evaluateTraceChain,
  verifyExecutionEvidenceAttestation,
} from "../src/domain/index.js";
import {
  ControlledRunner,
  DatabaseExecutor,
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
  assert.equal(bundle.evidence.find((item) => item.type === "DATABASE").manifest.stepResult.rows[0].status, "DRAFT");
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
