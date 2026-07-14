import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";

const fixedClock = () => new Date("2026-07-14T04:00:00.000Z");

async function exampleInput() {
  return JSON.parse(await readFile(new URL("../examples/order-submit.json", import.meta.url), "utf8"));
}

async function startServer(t, options = {}) {
  const store = new MemoryTraceabilityStore();
  const application = new TraceabilityApplication({ store, clock: fixedClock });
  const server = createTraceabilityHttpServer({ application, ...options });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("health endpoint returns a request correlation ID", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/health`, {
    headers: { "x-request-id": "request-health-001" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "request-health-001");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("evaluation endpoint returns the independent trace-chain dimensions", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await exampleInput()),
  });
  const chain = await response.json();

  assert.equal(response.status, 200);
  assert.equal(chain.complete, true);
  assert.equal(chain.dimensions.authority, "CONFIRMED");
  assert.equal(chain.dimensions.conformance, "CONFORMS");
  assert.equal(chain.dimensions.verification, "PASS");
  assert.deepEqual(chain.gaps, []);
});

test("API recomputes the snapshot manifest instead of trusting client status", async (t) => {
  const baseUrl = await startServer(t);
  const input = await exampleInput();
  input.snapshotManifest = {
    id: "SPOOFED-MANIFEST",
    components: {
      deployment: { id: "SPOOFED-DEPLOYMENT", digest: "sha256:spoofed" }
    },
    complete: true
  };

  const response = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.match(body.error.message, /observedFrom/);
});

test("trace chain can be evaluated, appended, and queried", async (t) => {
  const baseUrl = await startServer(t);
  const persistResponse = await fetch(`${baseUrl}/v1/projects/PROJECT-001/trace-chains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await exampleInput()),
  });
  const persisted = await persistResponse.json();

  assert.equal(persistResponse.status, 201);
  assert.equal(persisted.persisted.revision, 1);

  const currentResponse = await fetch(
    `${baseUrl}/v1/projects/PROJECT-001/trace-chains/${encodeURIComponent(persisted.chain.id)}`,
  );
  const current = await currentResponse.json();

  assert.equal(currentResponse.status, 200);
  assert.equal(current.id, persisted.chain.id);
  assert.equal(current.revision, 1);
  assert.equal(current.snapshotManifestId, persisted.chain.snapshotManifestId);
});

test("invalid JSON and media types use the stable error envelope", async (t) => {
  const baseUrl = await startServer(t);
  const invalidJson = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{broken",
  });
  const invalidJsonBody = await invalidJson.json();
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJsonBody.error.code, "INVALID_JSON");
  assert.equal(invalidJsonBody.error.requestId, invalidJson.headers.get("x-request-id"));

  const unsupported = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("payload limits and missing trace chains are explicit", async (t) => {
  const baseUrl = await startServer(t, { maxBodyBytes: 32 });
  const tooLarge = await fetch(`${baseUrl}/v1/trace-chains/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(64) }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "PAYLOAD_TOO_LARGE");

  const missing = await fetch(`${baseUrl}/v1/projects/PROJECT-001/trace-chains/UNKNOWN`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "TRACE_CHAIN_NOT_FOUND");
});

test("feature governance appends decisions without overwriting the claim", async (t) => {
  const baseUrl = await startServer(t);
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;

  const feature = await postJson(`${projectUrl}/features`, {
    id: "FEATURE-001",
    version: 1,
    name: "Submit order",
    businessDomain: "orders",
  });
  assert.equal(feature.response.status, 201);

  const scope = await postJson(`${projectUrl}/claim-scopes`, {
    id: "SCOPE-001",
    version: 1,
    scope: { actor: "normal-user", orderType: "standard" },
  });
  assert.equal(scope.response.status, 201);

  const claimInput = {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    provenance: { source: "business-owner" },
  };
  const claim = await postJson(`${projectUrl}/claims`, claimInput);
  assert.equal(claim.response.status, 201);

  const confirmed = await postJson(`${projectUrl}/decisions`, {
    id: "DECISION-001",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    type: "CONFIRMED",
    actorId: "USER-001",
    actorRole: "business-owner",
  });
  assert.equal(confirmed.response.status, 201);

  const exception = await postJson(`${projectUrl}/decisions`, {
    id: "DECISION-002",
    claimId: "CLAIM-001",
    claimVersion: 1,
    scopeId: "SCOPE-001",
    scopeVersion: 1,
    type: "EXCEPTION_RECORDED",
    content: "Administrators may force submission during recovery.",
    actorId: "USER-002",
    actorRole: "business-owner",
  });
  assert.equal(exception.response.status, 201);

  const baselineResponse = await fetch(`${projectUrl}/features/FEATURE-001/baseline`);
  const baseline = await baselineResponse.json();
  assert.equal(baselineResponse.status, 200);
  assert.equal(baseline.claims[0].claim.statement, claimInput.statement);
  assert.equal(baseline.claims[0].decisionHistory.length, 2);
  assert.equal(baseline.claims[0].latestDecision.type, "EXCEPTION_RECORDED");
});

test("governance reference conflicts return 409", async (t) => {
  const baseUrl = await startServer(t);
  const result = await postJson(`${baseUrl}/v1/projects/PROJECT-001/claims`, {
    id: "CLAIM-ORPHAN",
    version: 1,
    featureId: "FEATURE-MISSING",
    type: "NORMATIVE_REQUIREMENT",
    statement: "Orphan claim",
    sourceType: "HUMAN",
    evidenceSupport: "NONE",
    scopeId: "SCOPE-MISSING",
    scopeVersion: 1,
  });

  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "PERSISTENCE_CONFLICT");
});

test("TestSpec API validates candidates and preserves immutable versions", async (t) => {
  const baseUrl = await startServer(t);
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  await postJson(`${projectUrl}/features`, { id: "FEATURE-001", version: 1, name: "Submit order" });
  await postJson(`${projectUrl}/claim-scopes`, {
    id: "SCOPE-001",
    version: 1,
    scope: { actor: "normal-user" },
  });
  await postJson(`${projectUrl}/claims`, {
    id: "CLAIM-001",
    version: 1,
    featureId: "FEATURE-001",
    type: "NORMATIVE_REQUIREMENT",
    statement: "A normal user may submit only a DRAFT order.",
    sourceType: "HUMAN",
    evidenceSupport: "MULTI_SOURCE",
    scopeId: "SCOPE-001",
    scopeVersion: 1,
  });

  const firstVersion = {
    id: "TEST-001",
    version: 1,
    name: "Submit a draft order",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-001", version: 1 }],
    environment: { target: "sit", operationLevel: "CONTROLLED_WRITE" },
    variables: { accessToken: { secretRef: "accounts/normal-user/token" } },
    steps: [{ id: "submit", executor: "HTTP", method: "POST", path: "/orders/1/submit" }],
    assertions: [{ id: "status", type: "HTTP_STATUS", expected: 200 }],
    cleanup: { strategy: "SEED_RESET" },
    policy: { approvalRequired: true },
  };

  const candidate = await postJson(`${projectUrl}/test-specs/validate`, {
    ...firstVersion,
    variables: { password: "plaintext" },
  });
  assert.equal(candidate.response.status, 200);
  assert.equal(candidate.body.valid, false);
  assert.equal(candidate.body.violations[0].code, "RAW_SECRET_FORBIDDEN");

  const created = await postJson(`${projectUrl}/test-specs`, firstVersion);
  assert.equal(created.response.status, 201);
  const validation = await fetch(`${projectUrl}/test-specs/TEST-001/validate`, { method: "POST" });
  const validationBody = await validation.json();
  assert.equal(validation.status, 200);
  assert.equal(validationBody.executable, false);
  assert.equal(validationBody.violations[0].code, "APPROVAL_REQUIRED");

  const secondVersion = await postJson(`${projectUrl}/test-specs`, {
    ...firstVersion,
    version: 2,
    approved: true,
    approval: {
      actorId: "USER-001",
      actorRole: "quality-owner",
      approvedAt: "2026-07-14T03:59:00.000Z",
    },
  });
  assert.equal(secondVersion.response.status, 201);

  const latestResponse = await fetch(`${projectUrl}/test-specs/TEST-001`);
  assert.equal(latestResponse.status, 200);
  assert.equal((await latestResponse.json()).version, 2);
  const firstResponse = await fetch(`${projectUrl}/test-specs/TEST-001?version=1`);
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.json()).approved, false);
  const invalidVersion = await fetch(`${projectUrl}/test-specs/TEST-001?version=0`);
  assert.equal(invalidVersion.status, 400);
  assert.equal((await invalidVersion.json()).error.code, "INVALID_REQUEST");

  const baselineResponse = await fetch(`${projectUrl}/features/FEATURE-001/baseline`);
  const baseline = await baselineResponse.json();
  assert.equal(baseline.testSpecs.length, 1);
  assert.equal(baseline.testSpecs[0].version, 2);
});

test("TestSpec storage rejects raw secrets and cross-feature claim links", async (t) => {
  const baseUrl = await startServer(t);
  const projectUrl = `${baseUrl}/v1/projects/PROJECT-001`;
  await postJson(`${projectUrl}/features`, { id: "FEATURE-001", version: 1, name: "Submit order" });

  const rawSecret = await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-UNSAFE",
    version: 1,
    name: "Unsafe test",
    risk: "HIGH",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-MISSING", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    variables: { token: "plaintext" },
    steps: [{ id: "read", executor: "HTTP" }],
    assertions: [],
    policy: {},
  });
  assert.equal(rawSecret.response.status, 400);
  assert.equal(rawSecret.body.error.code, "INVALID_REQUEST");

  const missingClaim = await postJson(`${projectUrl}/test-specs`, {
    id: "TEST-ORPHAN",
    version: 1,
    name: "Orphan test",
    risk: "LOW",
    approved: false,
    featureId: "FEATURE-001",
    verifiesClaims: [{ id: "CLAIM-MISSING", version: 1 }],
    environment: { target: "sit", operationLevel: "SAFE_READ" },
    steps: [{ id: "read", executor: "HTTP" }],
    assertions: [],
    policy: {},
  });
  assert.equal(missingClaim.response.status, 409);
  assert.equal(missingClaim.body.error.code, "PERSISTENCE_CONFLICT");
});
