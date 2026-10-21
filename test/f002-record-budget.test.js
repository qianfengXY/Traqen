import assert from "node:assert/strict";
import test from "node:test";
import { boundedF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { createProfileId, createProfileConfigDigest } from "../src/deterministic-facts/identity.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { assembleCanonicalOutput, canonicalRecords, inheritedGapRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords, verifyPublication } from "../src/deterministic-facts/verification.js";

const material = (name, text) => ({ componentId: "a".repeat(64), pathBytes: Buffer.from(name).toString("base64url"), bytes: Buffer.from(text), mediaType: "text/plain" });
function profile(limit) {
  const { id: _id, configDigest: _digest, ...input } = boundedF002Profile();
  const config = { ...input, extractionLimits: { ...input.extractionLimits, maxRecords: limit } };
  return { ...config, id: createProfileId(config), configDigest: createProfileConfigDigest(config) };
}
const compile = (materials, configured) => compileDeterministicFacts({ workspaceId: "workspace", bundleId: "b".repeat(64), profile: configured, materials });

test("F002 scope record budgeting has a new profile identity without increasing old limits or mutating historical profiles", () => {
  const old = structuredF002Profile(), current = boundedF002Profile();
  assert.equal(old.extractionLimits.scopeRecordBudget, undefined);
  assert.equal(current.extractionLimits.maxRecords, old.extractionLimits.maxRecords);
  assert.notEqual(current.id, old.id); assert.deepEqual(current.ruleVersions, old.ruleVersions);
});

test("F002 record limits retain every input material and atomically replace oversized extraction with an explicit limitation", () => {
  const inputs = [material("a.md", "# Too much\n\n" + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.`).join("\n\n")), material("b.md", "# Small\n"), material("unknown.ts", "const n: number = 1;")];
  const configured = profile(35), result = compile(inputs, configured), records = canonicalRecords(result);
  assert.ok(records.length <= 35, `emitted ${records.length} records past the declared bound`);
  assert.equal(result.materials.length, inputs.length);
  const limited = result.materials.find(m => m.displayPath === "a.md");
  assert.deepEqual(result.objects.filter(o => o.materialId === limited.materialId).map(o => o.kind), ["MATERIAL"]);
  assert.ok(result.gaps.some(gap => gap.materialId === limited.materialId && gap.code === "SCOPE_RECORD_LIMIT"));
  assert.ok(result.objects.some(o => o.name === "Small"));
  normalizeCanonicalRecords(records, { workspaceId: "workspace", bundleId: "b".repeat(64), profile: configured });
  assert.deepEqual(canonicalRecords(compile([...inputs].reverse(), configured)), records);
});

test("F002 cannot hide a catalog that itself cannot fit the declared record budget", () => {
  const inputs = Array.from({ length: 10 }, (_, i) => material(`source-${i}.unknown`, "bytes"));
  assert.throws(() => compile(inputs, profile(20)), { code: "F002_SCOPE_RECORD_BUDGET_TOO_SMALL" });
});

test("F002 relation budget rollback leaves no dangling premises and discloses the whole resolution limitation", () => {
  const inputs = [material("a.md", Array.from({ length: 12 }, (_, i) => `[link${i}](b.md#beta)`).join("\n\n")), material("b.md", "# Beta\n")];
  const unlimited = compile(inputs, structuredF002Profile());
  const beforeRelations = canonicalRecords(unlimited).filter(r => !(r.kind === "FACT" && ["path", "refersTo"].includes(r.payload.predicate)));
  // Leave enough for every local declaration, but not the complete relation
  // phase. Output must be a valid closed set, not a partial/dangling proof.
  const configured = profile(beforeRelations.length + 3);
  const result = compile(inputs, configured), records = canonicalRecords(result);
  assert.ok(records.length <= configured.extractionLimits.maxRecords);
  assert.ok(result.gaps.some(gap => gap.materialId === null && gap.code === "SCOPE_RECORD_LIMIT"));
  assert.equal(result.facts.some(f => f.predicate === "refersTo"), false);
  normalizeCanonicalRecords(records, { workspaceId: "workspace", bundleId: "b".repeat(64), profile: configured });
});

function inheritedFixture() {
  const inputs = [material("unknown.ts", "const n: number = 1;")], configured = profile(8);
  const run = { id: "admitted-run", sourceInput: { bundleId: "b".repeat(64), inheritedGapSet: { count: "6" } } };
  const items = Array.from({ length: 6 }, (_, i) => ({ gapId: `source-gap-${i}`, componentId: inputs[0].componentId,
    pathBytes: inputs[0].pathBytes, reasonCode: `SOURCE_LIMIT_${i}` }));
  const admission = { inheritedGaps: async () => ({ items, nextCursor: null }) };
  return { inputs, configured, run, items, admission };
}

test("F002 counts every inherited F001 Gap inside the bounded final output, never dropping source limitations to fit", async () => {
  const { inputs, configured, run, admission } = inheritedFixture();
  const compiled = compile(inputs, configured);
  assert.equal(canonicalRecords(compiled).length, 3);
  await assert.rejects(assembleCanonicalOutput({ admission, actor: {}, workspaceId: "workspace", run, sourceMaterials: inputs, compiled, profile: configured }),
    { code: "F002_SCOPE_RECORD_BUDGET_TOO_SMALL" });
});

test("F002 final publication independently refuses a bounded profile overflow even when parser assembly is bypassed", async () => {
  const { inputs, configured, run, admission } = inheritedFixture();
  const compiled = compile(inputs, configured);
  const inherited = await inheritedGapRecords(admission, {}, "workspace", run, inputs);
  const records = canonicalRecords({ ...compiled, gaps: [...compiled.gaps, ...inherited] });
  assert.equal(records.length, 9);
  assert.throws(() => verifyPublication({ workspaceId: "workspace", bundleId: run.sourceInput.bundleId, scopeId: "c".repeat(64), profile: configured, records }),
    { code: "F002_SCOPE_RECORD_BUDGET_TOO_SMALL" });
});

test("F002 inherited Gap pagination proves the admitted total before filtering a smaller scope", async () => {
  const { inputs, run, items } = inheritedFixture();
  await assert.rejects(inheritedGapRecords({ inheritedGaps: async () => ({ items: items.slice(0, 5), nextCursor: null }) }, {}, "workspace", run, inputs),
    { code: "F002_INHERITED_GAPS_INVALID" });
  const outsideScope = items.map(item => ({ ...item, pathBytes: Buffer.from("another.ts").toString("base64url") }));
  assert.deepEqual(await inheritedGapRecords({ inheritedGaps: async () => ({ items: outsideScope, nextCursor: null }) }, {}, "workspace", run, inputs), []);
});
