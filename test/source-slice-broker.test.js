import assert from "node:assert/strict";
import test from "node:test";

import { createSourceSliceRequest } from "../src/domain/index.js";
import { SourceSliceBroker } from "../src/application/source-slice-broker.js";
import { createDirectSourceAnalysisAdapter } from "../src/analysis/skill-adapters.js";

function request(overrides = {}) {
  return createSourceSliceRequest({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W", artifactId: "A",
    range: { startByte: 0, endByte: null }, maxBytes: 65536, maxTokens: 12000, policyDigest: "POLICY", ...overrides,
  });
}

test("SourceSlice Broker authorizes Artifact IDs, redacts secrets, and never accepts paths", async () => {
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", content: "const apiKey = 'raw-secret';\nexport default true;" }),
  });
  const authorized = { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] };
  const slice = await broker.read(request(), authorized);
  assert.equal(slice.status, "REDACTED");
  assert.doesNotMatch(slice.content, /raw-secret/);
  const rejected = await broker.read(request(), null);
  assert.equal(rejected.status, "REJECTED");
  assert.throws(() => request({ path: "/etc/passwd" }), /cannot contain path/);
});

test("a Direct-source Skill recovers an entry point with no scanner FactBundle", async () => {
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", content: "export function deliberatelyMissedEntryPoint() {}" }),
  });
  const adapter = createDirectSourceAnalysisAdapter({
    id: "direct-reader",
    version: "1",
    async execute(input) {
      assert.equal(input.optionalFacts, null);
      assert.match(input.sourceSlices[0].content, /deliberatelyMissedEntryPoint/);
      return {
        candidateFeatures: [{
          id: "MISSED-ENTRY",
          sourceSliceIds: [input.sourceSlices[0].id],
          proposal: { name: "Missed entry point" },
        }],
      };
    },
  }, broker);
  const result = await adapter.analyze({
    projectId: "P", snapshotManifestId: "S", workUnitId: "W",
    sourceSliceRequests: [request()],
    authorization: { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] },
  });
  assert.equal(result.candidateFeatures[0].id, "MISSED-ENTRY");
  assert.equal(result.candidateFeatures[0].sourceSliceIds.length, 1);
});
