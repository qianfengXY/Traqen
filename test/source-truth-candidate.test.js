import assert from "node:assert/strict";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner } from "./support/source-truth-database.js";

test("B-02/11 a deterministic candidate is private until explicit publication", async (t) => {
  const f = await candidateFixture(t);
  const candidate = await f.candidates.prepare(f.context);
  assert.match(candidate?.id ?? "", /^[a-f0-9]{64}$/);
  assert.equal(candidate.fileCount, "1");
  assert.equal(candidate.gapCount, "0");
  assert.equal(candidate.components.length, 1);
  assert.equal((await f.candidates.prepare(f.context)).id, candidate.id);
  assert.deepEqual(await f.repository.listBundles(owner, "workspace"), []);
});

test("B-05 an unresolved item cannot become a prepared candidate", async (t) => {
  const f = await candidateFixture(t, { verified: false });
  await assert.rejects(f.candidates.prepare(f.context), { code: "SOURCE_INVENTORY_INCOMPLETE" });
});

test("B-05 claimed verification cannot hide a missing stored blob", async (t) => {
  const f = await candidateFixture(t, { stored: false });
  await assert.rejects(f.candidates.prepare(f.context), { code: "SOURCE_CONTENT_MISSING" });
});

test("B-05 blocker evidence cannot be turned into an acceptable candidate", async (t) => {
  const f = await candidateFixture(t, { git: true, gaps: [{ ruleCode: "PATH_ESCAPE", severity: "BLOCKING", ruleVersion: "v1", affectedScope: "artifact", externalReference: null }] });
  await assert.rejects(f.candidates.prepare(f.context), { code: "SOURCE_BLOCKING_GAP" });
});
