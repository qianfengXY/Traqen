import assert from "node:assert/strict";
import test from "node:test";

import { extractDocumentContractFacts } from "../src/scanner/document-contract-extractor.js";
import { extractTestConfigResultFacts } from "../src/scanner/test-config-result-extractor.js";
import { createUnderstandingLaneStatus, UnderstandingLane } from "../src/analysis/understanding-lanes.js";

test("document, contract, test, config, and result lanes remain candidate-only and evidence-honest", () => {
  const documentFacts = extractDocumentContractFacts(
    { id: "DOC" },
    "# Submit order\nPOST /orders/{id}/submit",
  );
  assert.ok(documentFacts.some(({ type }) => type === "DOCUMENT_SECTION"));
  assert.ok(documentFacts.some(({ type }) => type === "ENDPOINT_DECLARATION"));
  assert.ok(documentFacts.every(({ authority }) => authority === "OBSERVED_CANDIDATE_ONLY"));
  const configFacts = extractTestConfigResultFacts(
    { id: "CONFIG", kind: "CONFIG", contentDigest: "digest" },
    "API_TOKEN=secret\nPORT=3000",
  );
  assert.ok(configFacts.every(({ value }) => value === null));
  const testFacts = extractTestConfigResultFacts(
    { id: "TEST", kind: "TEST", contentDigest: "digest" },
    "test('submits order', () => {})",
  );
  assert.equal(testFacts[0].provesExecution, false);
  const resultFacts = extractTestConfigResultFacts(
    { id: "RESULT", kind: "RESULT", contentDigest: "digest" },
    "passed",
  );
  assert.equal(resultFacts[0].provesVerification, false);
});

test("all six understanding lanes keep independent status and denominators", () => {
  const statuses = Object.values(UnderstandingLane).map((lane) => createUnderstandingLaneStatus({
    lane, status: "COMPLETED", producerId: lane, producerVersion: "1", denominator: 2, processed: 2,
  }));
  assert.equal(statuses.length, 6);
  assert.equal(new Set(statuses.map(({ producerId }) => producerId)).size, 6);
});
