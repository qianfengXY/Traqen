import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { uniqueDeclaredObject } from "./support/f002-declared-object.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = (limits = {}) => ({ id: "c".repeat(64), version: "2", ruleVersions: ["javascript@2"], extractionLimits: { javascriptBindings: "lexical-bindings-v1", ...limits } });
const material = (entryPath, source, componentId = "a".repeat(64)) => ({ componentId, pathBytes: Buffer.from(entryPath).toString("base64url"), bytes: Buffer.from(source), mediaType: "text/javascript" });
const compile = (materials, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials });
const calls = result => result.facts.filter(f => f.predicate === "staticCalls");
const object = (result, id) => result.objects.find(o => o.objectId === id);
const pairs = result => calls(result).map(f => [object(result, f.subjectId).name, object(result, f.targetId).name]).sort();

test("F002 lexical binding is opt-in and leaves historical profiles unchanged", () => {
  assert.equal(standardF002Profile().extractionLimits.javascriptBindings, undefined);
  assert.equal(structuredF002Profile().extractionLimits.javascriptBindings, "lexical-bindings-v1");
  const old = profile(); delete old.extractionLimits.javascriptBindings;
  const result = compileDeterministicFacts({ workspaceId, bundleId, profile: old, materials: [material("a.js", "function target() {} function caller() { target(); }")] });
  assert.deepEqual(calls(result)[0].premiseFactIds, []);
});

test("F002 nested lexical calls and recursion carry exact call and declaration premises", () => {
  const result = compile([material("a.js", "function outer() { function target() { target(); } function caller() { target(); } caller(); }")]);
  assert.deepEqual(pairs(result), [["caller", "target"], ["outer", "caller"], ["target", "target"]]);
  for (const fact of calls(result)) { assert.equal(fact.basis, "DERIVED"); assert.equal(fact.premiseFactIds.length, 2); assert.ok(fact.premiseFactIds.every(id => result.facts.find(f => f.factId === id)?.basis === "DECLARED")); }
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 block-local declarations choose the nearest binding rather than the same-named global", () => {
  const result = compile([material("a.js", "function target() {} function caller() { { function target() {} target(); } target(); }")]);
  const linked = calls(result); assert.equal(linked.length, 2); assert.equal(new Set(linked.map(f => f.targetId)).size, 2);
  const targets = linked.map(f => object(result, f.targetId)); assert.ok(targets.some(o => o.parentId === object(result, linked[0].subjectId).objectId));
});

test("F002 parameter destructuring catch and loop shadows cannot resolve to a global function", () => {
  for (const body of ["function caller(target) { target(); }", "function caller({target}) { target(); }", "function caller() { try {} catch(target) { target(); } }", "function caller() { for (let target of []) { target(); } }"]) {
    const result = compile([material("a.js", "function target() {} " + body)]); assert.equal(calls(result).length, 0, body);
    assert.ok(result.objects.some(o => o.kind === "JAVASCRIPT_CALL")); assert.ok(result.gaps.some(g => g.code === "JAVASCRIPT_BINDING_UNRESOLVED"));
  }
});

test("F002 writes invalidate only their lexical binding and mutable aliases are not proven calls", () => {
  const changed = compile([material("a.js", "function target() {} function caller() { target(); } target = other;")]);
  assert.equal(calls(changed).length, 0); assert.ok(changed.gaps.some(g => g.code === "JAVASCRIPT_BINDING_MUTABLE"));
  const shadowWrite = compile([material("a.js", "function target() {} function mutate(target) { target = other; } function caller() { target(); }")]); assert.deepEqual(pairs(shadowWrite), [["caller", "target"]]);
  const alias = compile([material("a.js", "function target() {} let alias = target; function caller() { alias(); }")]); assert.equal(calls(alias).length, 0);
});

test("F002 const arrow binding excludes pre-initialization references and preserves UTF8 physical call anchors", () => {
  const source = "// 中文😀\r\nfunction early() { target(); }\r\nconst target = () => {};\r\nfunction caller() { target(); }\r\n";
  const result = compile([material("a.js", source)]); assert.deepEqual(pairs(result), [["caller", "target"]]);
  const occurrence = result.objects.find(o => o.kind === "JAVASCRIPT_CALL" && o.anchor.lineStart === 4); assert.ok(occurrence);
  assert.equal(Buffer.from(source).subarray(occurrence.anchor.byteStart, occurrence.anchor.byteEnd).toString(), "target()");
  assert.ok(result.gaps.some(g => g.code === "JAVASCRIPT_BINDING_INITIALIZATION_UNPROVEN"));
});

test("F002 explicit aliased named and default imports have same-component module and export premises", () => {
  const result = compile([material("src/use.js", "import { target as alias } from './lib.js'; import fallback from './default.js'; export function caller() { alias(); fallback(); }"), material("src/lib.js", "function implementation() {} export { implementation as target };"), material("src/default.js", "export default function defaultTarget() {}"), material("src/lib.js", "export function target() {}", "d".repeat(64))]);
  assert.deepEqual(pairs(result), [["caller", "defaultTarget"], ["caller", "implementation"]]);
  assert.ok(calls(result).every(f => f.premiseFactIds.length >= 4));
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 extensionless module ambiguity never picks the first file with a matching export", () => {
  const result = compile([material("use.js", "import {target} from './lib'; function caller() { target(); }"), material("lib.js", "export function target() {}"), material("lib.mjs", "export function different() {}")]);
  assert.equal(calls(result).length, 0); assert.ok(result.gaps.some(g => g.code === "JAVASCRIPT_MODULE_AMBIGUOUS"));
});

test("F002 re-exports external modules and cross-root paths remain explicit limitations", () => {
  for (const specifier of ["pkg", "../outside.js", "./facade.js"]) {
    const result = compile([material("use.js", `import {target} from '${specifier}'; function caller() { target(); }`), material("facade.js", "export {target} from './lib.js';"), material("lib.js", "export function target() {}")]);
    assert.equal(calls(result).length, 0, specifier); assert.ok(result.gaps.length > 0);
  }
});

test("F002 direct eval dynamic member calls and duplicate script declarations never become a unique binding", () => {
  for (const source of ["function target() {} function caller() { eval(''); target(); }", "function target() {} function caller() { receiver.target(); }", "function target() {} function target() {} with (receiver) {} function caller() { target(); }"]) {
    const result = compile([material("a.js", source)]); assert.equal(calls(result).length, 0, source); assert.ok(result.gaps.length > 0);
  }
});

test("F002 call-reference budget refuses the new pass without publishing a truncated call set", () => {
  const result = compile([material("a.js", "function target() {} function caller() { target(); target(); }")], { maxJavaScriptCalls: 1 });
  assert.equal(calls(result).length, 0); assert.equal(result.objects.some(o => o.kind === "JAVASCRIPT_CALL"), false);
  assert.ok(result.gaps.some(g => g.code === "JAVASCRIPT_BINDINGS_LIMIT"));
});

test("F002 publication rejects absent call premises even when the tampered identity is recomputed", () => {
  const result = compile([material("a.js", "function target() {} function caller() { target(); }")]);
  const records = canonicalRecords(result).map(r => { if (r.kind !== "FACT" || r.payload.predicate !== "staticCalls") return r; const p = { ...r.payload, premiseFactIds: [] }; const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, targetId: p.targetId, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: [] }); return { ...r, id, payload: { ...p, factId: id } }; });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 publication rejects a same-named cross-component import target with a closed forged identity", () => {
  const result = compile([material("use.js", "import {target} from './lib.js'; function caller() { target(); }"), material("lib.js", "export function target() {}"), material("lib.js", "export function target() {}", "d".repeat(64))]);
  const foreign = result.objects.find(o => o.kind === "FUNCTION" && result.materials.find(m => m.materialId === o.materialId).componentId === "d".repeat(64)); assert.ok(foreign);
  const records = canonicalRecords(result).map(r => { if (r.kind !== "FACT" || r.payload.predicate !== "staticCalls") return r; const p = { ...r.payload, targetId: foreign.objectId }; const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, targetId: p.targetId, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds }); return { ...r, id, payload: { ...p, factId: id } }; });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_REFERENCE_INVALID" });
});

test("F002 declaration fixture selection cannot confuse a same-named call occurrence with its target function", () => {
  const result = compile([material("src/calls.js", "import {target as alias} from './binding-target.js';\r\nexport function outer() {\r\n  function inner() { alias(); }\r\n  inner();\r\n}\r\n"), material("src/binding-target.js", "export function target() { return '😀'; }\r\n")]);
  const records = canonicalRecords(result), materialId = result.materials.find(m => m.displayPath === "src/calls.js").materialId;
  const candidates = records.filter(r => r.kind === "OBJECT" && r.payload.name === "inner");
  assert.deepEqual(candidates.map(r => r.payload.kind).sort(), ["FUNCTION", "JAVASCRIPT_CALL"]);
  const ordered = [...candidates].sort((a, b) => Number(b.payload.kind === "JAVASCRIPT_CALL") - Number(a.payload.kind === "JAVASCRIPT_CALL"));
  assert.equal(ordered.find(r => r.payload.name === "inner").payload.kind, "JAVASCRIPT_CALL", "name-only selector reproduces the original false target assertion");
  const parent = uniqueDeclaredObject(records, { materialId, kind: "FUNCTION", name: "outer" });
  const child = uniqueDeclaredObject(ordered, { materialId, kind: "FUNCTION", name: "inner", parentId: parent.id });
  assert.equal(child.payload.anchor.lineStart, 3); assert.ok(calls(result).some(f => f.targetId === child.id));
});

test("F002 declaration fixture selection excludes same-named objects in other admitted materials", () => {
  const records = ["primary", "foreign"].map(materialId => ({ kind: "OBJECT", id: materialId, payload: { kind: "FUNCTION", name: "inner", materialId, parentId: "outer" } }));
  assert.equal(uniqueDeclaredObject(records.reverse(), { materialId: "primary", kind: "FUNCTION", name: "inner", parentId: "outer" }).id, "primary");
});

test("F002 declaration fixture selection rejects missing kind or multiple matching declarations instead of choosing first", () => {
  const record = { kind: "OBJECT", id: "one", payload: { kind: "FUNCTION", name: "inner", materialId: "primary", parentId: "outer" } };
  assert.throws(() => uniqueDeclaredObject([record], { materialId: "primary", name: "inner" }), /Explicit/);
  assert.throws(() => uniqueDeclaredObject([record, { ...record, id: "two" }], { materialId: "primary", kind: "FUNCTION", name: "inner", parentId: "outer" }), /found 2/);
});
