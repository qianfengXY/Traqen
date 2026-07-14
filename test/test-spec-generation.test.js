import assert from "node:assert/strict";
import test from "node:test";

import {
  createFactBundle,
  generateEndpointTestSpecDraft,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T14:00:00.000Z");

function generationInput(overrides = {}) {
  const bundle = createFactBundle({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    extractor: { id: "SCANNER-001", version: "1.0.0" },
    observedAt: "2026-07-14T13:55:00.000Z",
    complete: true,
    diagnostics: [],
    nodes: [{
      type: "ENDPOINT",
      naturalKey: "http:GET /orders/{id}",
      name: "GET /orders/{id}",
      attributes: { method: "GET", path: "/orders/ORDER-001" },
      source: {
        artifact: "src/orders.js",
        startLine: 10,
        endLine: 20,
        contentHash: `sha256:${"b".repeat(64)}`,
      },
    }],
    edges: [],
  });
  const endpoint = bundle.nodes[0];
  return {
    id: "TEST-GENERATED-001",
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
      snapshotManifestId: "SNAPSHOT-001",
      factRefs: [{ factId: endpoint.factId, relation: "SUPPORTS" }],
    },
    endpoint,
    ...overrides,
  };
}

test("an authorized endpoint Claim converts into a traceable unapproved TestSpec draft", () => {
  const generated = generateEndpointTestSpecDraft(generationInput(), fixedClock);

  assert.equal(generated.draft.approved, false);
  assert.equal(generated.draft.environment.operationLevel, "SAFE_READ");
  assert.deepEqual(generated.draft.verifiesClaims, [{ id: "CLAIM-001", version: 1 }]);
  assert.equal(generated.draft.origin.type, "CONFIRMED_CLAIM_CONVERSION");
  assert.equal(generated.draft.origin.decisionId, "DECISION-001");
  assert.equal(generated.draft.origin.mappingId, "MAPPING-001");
  assert.equal(generated.draft.steps[0].method, "GET");
  assert.equal(generated.draft.assertions[0].expected, 200);
  assert.equal(generated.validation.valid, true);
  assert.equal(generated.validation.executable, false);
  assert.deepEqual(generated.validation.violations.map((item) => item.code), ["APPROVAL_REQUIRED"]);
});

test("write endpoints remain non-executable until cleanup and approval are both present", () => {
  const input = generationInput();
  const writeEndpoint = structuredClone(input.endpoint);
  writeEndpoint.attributes = { method: "POST", path: "/orders/{id}/submit" };
  const withoutCleanup = generateEndpointTestSpecDraft({
    ...input,
    endpoint: writeEndpoint,
    pathParameters: { id: "ORDER-001" },
  }, fixedClock);
  assert.equal(withoutCleanup.draft.environment.operationLevel, "CONTROLLED_WRITE");
  assert.deepEqual(
    withoutCleanup.validation.violations.map((item) => item.code).sort(),
    ["APPROVAL_REQUIRED", "CLEANUP_REQUIRED", "SEED_REQUIRED"],
  );

  const withCleanup = generateEndpointTestSpecDraft({
    ...input,
    endpoint: writeEndpoint,
    preconditions: [{ type: "SEED", seedRef: "draft-order" }],
    pathParameters: { id: "${seed.orderId}" },
    cleanup: { strategy: "SEED_RESET" },
    databaseVerification: {
      queryRef: "order_by_id",
      parameters: ["${seed.orderId}"],
      assertions: [
        {
          id: "database-status",
          type: "DATABASE_FIELD",
          field: "status",
          expected: "SUBMITTED",
        },
      ],
    },
  }, fixedClock);
  assert.deepEqual(withCleanup.validation.violations.map((item) => item.code), ["APPROVAL_REQUIRED"]);
  assert.equal(withCleanup.draft.steps[1].executor, "DATABASE");
  assert.equal(withCleanup.draft.steps[0].path, "/orders/${seed.orderId}/submit");
  assert.equal(withCleanup.draft.steps[1].queryRef, "order_by_id");
  assert.equal(withCleanup.draft.assertions[1].type, "DATABASE_FIELD");
  assert.equal(withCleanup.draft.assertions[1].expected, "SUBMITTED");
});

test("the converter refuses unconfirmed or unsupported Claims", () => {
  assert.throws(
    () => generateEndpointTestSpecDraft(
      generationInput({ decision: { id: "DECISION-001", type: "DEFERRED" } }),
      fixedClock,
    ),
    /currently authorized/,
  );
  const unsupported = generationInput();
  unsupported.claim.constraint = { dimension: "orderStatus", operator: "EQUALS", value: "DRAFT" };
  assert.throws(
    () => generateEndpointTestSpecDraft(unsupported, fixedClock),
    /only supports endpointExposed/,
  );
  assert.throws(
    () => generateEndpointTestSpecDraft(
      generationInput({
        databaseVerification: {
          queryRef: "order_by_id",
          assertions: [{ id: "unsafe", type: "SQL", expected: 1 }],
        },
      }),
      fixedClock,
    ),
    /DATABASE_ROW_COUNT or DATABASE_FIELD/,
  );
  const parameterized = structuredClone(generationInput());
  parameterized.endpoint.attributes = { method: "POST", path: "/orders/{id}/submit" };
  assert.throws(
    () => generateEndpointTestSpecDraft(parameterized, fixedClock),
    /pathParameters\.id/,
  );
});
