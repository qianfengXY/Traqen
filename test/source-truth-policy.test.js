import assert from "node:assert/strict";
import test from "node:test";
import { capturePolicy, sourceInput } from "../src/source-truth/policy.js";

const config = { gitTargets: [{ origin: "https://git.example.test" }] };
test("B-01 server policy normalizes two independent sources, never an overlay or a third input type", () => {
  const policy = capturePolicy(config);
  assert.match(policy?.id ?? "", /^[a-f0-9]{64}$/);
  const input = sourceInput({ sources: [
    { sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE", label: "资料" },
    { sourceId: "git", kind: "GIT", mode: "UPDATE", url: "https://git.example.test/team/repo.git", ref: "main", root: null },
  ], baselineBundleId: null }, policy);
  assert.deepEqual(input.sources.map((source) => source.kind), ["GIT", "DIRECTORY_UPLOAD"]);
  assert.equal(input.sources[1].scope.kind, "UPLOADED_DIRECTORY");
  assert.equal(input.sources[0].scope.root, null);
  assert.equal(sourceInput({ sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "REUSE", componentId: "a".repeat(64) }], baselineBundleId: "b".repeat(64) }, policy).sources[0].componentId, "a".repeat(64));
});

test("B-05 policy is platform-owned and invalid source coordinates fail closed", () => {
  const policy = capturePolicy(config);
  for (const sources of [[], [{ kind: "COMPOSITE" }], [{ sourceId: "d", kind: "DIRECTORY_UPLOAD" }, { sourceId: "e", kind: "DIRECTORY_UPLOAD" }],
    [{ sourceId: "g", kind: "GIT", mode: "UPDATE", url: "/local/path", ref: "main", root: null }],
    [{ sourceId: "g", kind: "GIT", mode: "UPDATE", url: "https://secret@git.example.test/r", ref: "main", root: null }],
    [{ sourceId: "g", kind: "GIT", mode: "UPDATE", url: "https://git.example.test/r", ref: "main", root: "../" }]]) {
    assert.throws(() => sourceInput({ sources, baselineBundleId: null }, policy));
  }
  assert.throws(() => sourceInput({ sources: [{ sourceId: "d", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }], exclude: ["*.test.js"] }, policy), { code: "SOURCE_INVALID_INPUT" });
  assert.throws(() => capturePolicy({ ...config, maxChunkBytes: -1 }), { code: "SOURCE_POLICY_INVALID" });
});
