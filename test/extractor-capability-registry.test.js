import assert from "node:assert/strict";
import test from "node:test";

import { ExtractorCapabilityRegistry } from "../src/scanner/extractor-capability-registry.js";

test("extractors declare exact engines, coverage, known gaps, and fixture status", () => {
  const registry = new ExtractorCapabilityRegistry();
  registry.register({
    id: "javascript-ast", version: "1", engine: "AST", languages: ["javascript"], artifactKinds: ["SOURCE"],
    nodeTypes: ["CODE_SYMBOL"], edgePredicates: ["CALLS"], knownGaps: ["dynamic-eval"], fixtureStatus: "VERIFIED",
  });
  registry.register({
    id: "javascript-regex", version: "1", engine: "REGEX_FALLBACK", languages: ["javascript"], artifactKinds: ["SOURCE"],
    nodeTypes: ["CODE_SYMBOL"], edgePredicates: [], knownGaps: ["no-scope-resolution"], fixtureStatus: "UNVERIFIED",
  });
  const selected = registry.list({ language: "javascript", artifactKind: "SOURCE" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].engine, "AST");
  assert.equal(registry.list({ verifiedOnly: false }).length, 2);
});
