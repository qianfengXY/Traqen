import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";

const root = new URL("./fixtures/f002/structured-reference-corpus/", import.meta.url);
const expected = JSON.parse(await readFile(new URL("expected.json", root), "utf8"));
const profile = structuredF002Profile(), workspaceId = "corpus", bundleId = "b".repeat(64);
const range = anchor => anchor?.textRange ?? anchor;
const media = p => p.endsWith(".java") ? "text/x-java" : p.endsWith(".json") ? "application/json" : p.endsWith(".xml") ? "application/xml" : p.endsWith(".md") ? "text/markdown" : "text/plain";

async function compile(c) {
  const materials = await Promise.all(c.sources.map(async s => ({ componentId: (s.component === "other" ? "d" : "a").repeat(64),
    pathBytes: Buffer.from(s.path).toString("base64url"), mediaType: media(s.path), bytes: await readFile(new URL(s.file, root)) })));
  return { result: compileDeterministicFacts({ workspaceId, bundleId, profile, materials }), materials };
}

// Selection keys and expectations are manually authored source coordinates,
// not generated IDs, snapshots, or a replay of the same extraction algorithm.
function verify(c, { result: r, materials }) {
  const materialById = new Map(r.materials.map(m => [m.materialId, m]));
  const objectById = new Map(r.objects.map(o => [o.objectId, o]));
  const objects = selector => r.objects.filter(o => materialById.get(o.materialId)?.displayPath === selector.path
    && (!selector.kind || o.kind === selector.kind) && (selector.name === undefined || o.name === selector.name)
    && (selector.line === undefined || range(o.anchor)?.lineStart === selector.line));
  const object = selector => { const found = objects(selector); assert.equal(found.length, 1, `unique manual object ${JSON.stringify(selector)}`); return found[0]; };
  const anchor = (f, e) => {
    if (e.line === undefined && e.source === undefined && e.pointer === undefined) return;
    const evidence = r.evidence.filter(row => f.evidenceIds.includes(row.evidenceId)); assert.ok(evidence.length > 0);
    const first = evidence[0], a = range(first.anchor);
    if (e.line !== undefined) assert.equal(a.lineStart, e.line, "manual physical start line");
    if (e.endLine !== undefined) assert.equal(a.lineEnd, e.endLine, "manual physical end line");
    if (e.pointer !== undefined) assert.equal(first.anchor.pointer, e.pointer, "manual JSON pointer");
    if (e.source !== undefined) {
      const m = materialById.get(first.materialId), input = materials.find(m2 => m2.componentId === m.componentId && m2.pathBytes === m.pathBytes);
      assert.equal(input.bytes.subarray(a.byteStart, a.byteEnd).toString("utf8"), e.source, "manual exact byte slice");
    }
  };
  const relationKey = f => JSON.stringify([f.subjectId, f.predicate, f.targetId]);
  const requiredKeys = [];
  for (const e of c.relations ?? []) {
    const from = object(e.from), to = object(e.to), key = JSON.stringify([from.objectId, e.predicate, to.objectId]);
    requiredKeys.push(key);
    const found = r.facts.filter(f => f.kind === "RELATION" && relationKey(f) === key);
    assert.equal(found.length, 1, `manual required relation ${e.predicate}`);
    assert.equal(found[0].basis, e.basis); assert.equal(found[0].premiseFactIds.length, e.premises);
    const premises = found[0].premiseFactIds.map(id => { const p = r.facts.find(p => p.factId === id); assert.ok(p, "each premise resolves"); return [p.predicate, p.basis]; });
    if (e.premiseFacts) assert.deepEqual(premises.map(p => JSON.stringify(p)).sort(), e.premiseFacts.map(p => JSON.stringify(p)).sort(), "manual typed premise vocabulary and basis");
    else assert.ok(premises.every(p => p[1] === "DECLARED"), "this manual rule expects declared leaf premises");
    anchor(found[0], e);
  }
  const actualKeys = r.facts.filter(f => f.kind === "RELATION" && c.relationPredicates.includes(f.predicate)).map(relationKey);
  assert.deepEqual(actualKeys.sort(), requiredKeys.sort(), "bounded manual relation set: detects both missed and invented edges");
  for (const e of c.properties ?? []) {
    const selected = object(e.object), found = r.facts.filter(f => f.subjectId === selected.objectId && f.predicate === e.predicate);
    assert.equal(found.length, 1, `manual property ${e.predicate}`); assert.deepEqual(found[0].value, e.value); assert.equal(found[0].basis, e.basis);
    if (e.premises !== undefined) assert.equal(found[0].premiseFactIds.length, e.premises);
    anchor(found[0], e);
  }
  for (const e of c.counts ?? []) assert.equal(objects(e).length, e.count, `manual object count ${e.path} ${e.kind}`);
  for (const name of c.absentNames ?? []) assert.equal(r.objects.some(o => o.name === name), false, `forbidden source name ${name}`);
  for (const p of c.absentPredicates ?? []) assert.equal(r.facts.some(f => f.predicate === p), false, `forbidden inference ${p}`);
  for (const code of c.gapCodes ?? []) assert.ok(r.gaps.some(g => g.code === code), `required limitation ${code}`);
  for (const e of c.candidateCounts ?? []) {
    const g = r.gaps.find(g => g.code === e.code); assert.equal(g.reason.candidateObjectIds.length, e.count);
    assert.ok(g.reason.candidateObjectIds.every(id => objectById.has(id)));
  }
  for (const value of c.forbiddenStrings ?? []) assert.equal(JSON.stringify(canonicalRecords(r)).includes(value), false, "known secret must not appear in canonical output");
  if (c.factCount !== undefined) assert.equal(r.facts.length, c.factCount);
  if (c.reportIdentity) for (const result of r.objects.filter(o => o.kind === "TEST_RESULT")) {
    c.reportIdentity.names.forEach((p, i) => {
      const f = r.facts.find(f => f.subjectId === result.objectId && f.predicate === p);
      assert.deepEqual(f?.value, { datatype: "string", value: c.reportIdentity.values[i] }); assert.equal(f.basis, "DECLARED");
    });
    // Extracted limitations use material + exact occurrence anchor; a missing
    // objectId is not permission to borrow another report case's limitation.
    assert.ok(r.gaps.some(g => g.materialId === result.materialId && g.code === "EXECUTION_BINDING_MISSING"
      && range(g.anchor)?.byteStart === range(result.anchor).byteStart && range(g.anchor)?.byteEnd === range(result.anchor).byteEnd));
  }
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile });
}

for (const c of expected.cases) test(`F002 independent @2 corpus: ${c.name}`, async () => verify(c, await compile(c)));

test("F002 independent corpus oracle rejects a missing edge and an invented edge without changing its expected set", async () => {
  const c = expected.cases[1], compiled = await compile(c);
  verify(c, compiled);
  const edge = compiled.result.facts.find(f => f.predicate === "staticCalls"); assert.ok(edge);
  const missing = { ...compiled.result, facts: compiled.result.facts.filter(f => f !== edge) };
  assert.throws(() => verify(c, { ...compiled, result: missing }), /manual required relation/);
  const invented = { ...compiled.result, facts: [...compiled.result.facts, { ...edge, subjectId: edge.targetId, targetId: edge.subjectId }] };
  assert.throws(() => verify(c, { ...compiled, result: invented }), /bounded manual relation set/);
});
