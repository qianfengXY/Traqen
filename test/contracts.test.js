import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TraceGapType } from "../src/domain/index.js";

test("trace-chain input contract is valid JSON Schema metadata", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain-evaluation-input.schema.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.title, "TraceChainEvaluationInput");
  assert.ok(contract.required.includes("snapshotManifest"));
  assert.ok(contract.required.includes("evidence"));
});

test("trace-chain output contract stays aligned with domain gap types", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/trace-chain.schema.json", import.meta.url), "utf8"),
  );
  const contractGapTypes = contract.properties.gaps.items.properties.type.enum;

  assert.equal(contract.title, "TraceChain");
  assert.deepEqual([...contractGapTypes].sort(), Object.keys(TraceGapType).sort());
});

test("OpenAPI contract exposes the implemented trace-chain routes", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.paths["/health"].get.operationId, "getHealth");
  assert.equal(
    contract.paths["/v1/trace-chains/evaluate"].post.operationId,
    "evaluateTraceChain",
  );
  assert.equal(
    contract.paths["/v1/projects/{projectId}/trace-chains/{chainId}"].get.operationId,
    "getCurrentTraceChain",
  );
});
