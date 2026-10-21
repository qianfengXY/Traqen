import assert from "node:assert/strict";
import test from "node:test";
import { resolveTestReferences } from "../src/deterministic-facts/extraction/test-assets.js";

test("F002 resolves test references with one fact index, not a full fact scan for every test", () => {
  let predicateReads = 0;
  const facts = Array.from({ length: 5000 }, (_, i) => ({ factId: `fact-${i}`, subjectId: `caller-${i}`, targetId: `target-${i}`,
    evidenceIds: i < 100 ? [`evidence-${i}`] : [], get predicate() { predicateReads++; return i < 100 ? "staticCalls" : "name"; } }));
  const references = Array.from({ length: 100 }, (_, i) => ({ material: { materialId: `material-${i}` }, caller: { objectId: `caller-${i}` },
    testcase: { objectId: `test-${i}` }, framework: `framework-${i}`, anchor: { byteStart: 10, byteEnd: 100 } }));
  const objects = references.map((_, i) => ({ objectId: `target-${i}` }));
  const evidence = references.map((_, i) => ({ evidenceId: `evidence-${i}`, materialId: `material-${i}`, anchor: { kind: "TEXT", byteStart: 20, byteEnd: 30 } }));
  const emitted = [];
  resolveTestReferences({ references, facts, objects, evidence, addFact: fact => emitted.push(fact) });
  assert.equal(emitted.length, 100);
  assert.ok(predicateReads <= facts.length * 2, `${predicateReads} fact reads for ${facts.length} input facts`);
  for (let i = 0; i < emitted.length; i++) {
    assert.equal(emitted[i].target.objectId, `target-${i}`);
    assert.deepEqual(emitted[i].premiseFactIds, [`framework-${i}`, `fact-${i}`]);
  }
});
