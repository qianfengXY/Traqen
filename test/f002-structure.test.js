import assert from "node:assert/strict";
import test from "node:test";

import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalDigest, createFactId } from "../src/deterministic-facts/identity.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { F002RuleRegistry } from "../src/deterministic-facts/rules.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import * as runtime from "../src/deterministic-facts/runtime.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = version => ({ id: "c".repeat(64), version: String(version), schemaVersion: 1,
  ruleVersions: ["javascript", "java", "markdown"].map(capability => `${capability}@${version}`) });
const material = (name, text, componentId = "a".repeat(64)) => ({ componentId,
  pathBytes: Buffer.from(name).toString("base64url"), bytes: Buffer.from(text), mediaType: "text/plain" });
const compile = (materials, version = 2) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(version), materials });
const object = (result, name) => { const matches = result.objects.filter(item => item.name === name); assert.equal(matches.length, 1, name); return matches[0]; };
const edge = (result, predicate, parent, child) => result.facts.find(fact => fact.predicate === predicate && fact.subjectId === parent.objectId && fact.targetId === child.objectId);
const historicalMaterials = () => [material("src/a.js", "export function outer() { function inner() {} return 1; }\n"),
  material("src/A.java", "class Outer { class Inner { void run() {} } }\n"), material("doc.md", "# Root\n## Child\n# Sibling\n")];

test("F002 structural rules retain the exact historical @1 canonical output", () => {
  const result = compile(historicalMaterials(), 1);
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: canonicalRecords(result) }), "4216f47f09e7b2ee81d52347d58094f8ac449ded2ca36a85ff8ed8146df6e0d1");
  assert.equal(result.objects.some(item => Object.hasOwn(item, "parentId")), false);
});

test("F002 @2 JavaScript parent and declaration relationships come from lexical structure, not equal names", () => {
  const result = compile([material("src/nested.js", "export function outer() { function inner() {} const callback = () => {}; }\nclass Box { run() { function local() {} } }\n")]);
  const root = result.objects.find(item => item.kind === "MATERIAL"), outer = object(result, "outer"), inner = object(result, "inner"), callback = object(result, "callback"), box = object(result, "Box"), run = object(result, "run"), local = object(result, "local");
  for (const [parent, child] of [[root, outer], [outer, inner], [outer, callback], [root, box], [box, run], [run, local]]) {
    assert.equal(child.parentId, parent.objectId);
    assert.ok(edge(result, "contains", parent, child));
    assert.ok(edge(result, "declares", parent, child));
  }
  assert.equal(box.kind, "JAVASCRIPT_CLASS");
  const records = normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile(2) });
  assert.ok(records.length);
});

test("F002 @2 import declarations have exact evidence without inventing runtime or cross-component bindings", () => {
  const text = "import { helper as renamed } from './helper.js';\nimport 'external-package';\nexport function use() { return renamed(); }\n";
  const result = compile([material("src/use.js", text), material("src/helper.js", "export function helper() {}\n", "d".repeat(64))]);
  const source = result.materials.find(item => item.displayPath === "src/use.js"), root = result.objects.find(item => item.objectId === source.rootObjectId);
  for (const name of ["./helper.js", "external-package"]) {
    const declaration = object(result, name), fact = edge(result, "imports", root, declaration);
    assert.equal(declaration.kind, "IMPORT"); assert.equal(declaration.parentId, root.objectId); assert.ok(fact);
    assert.equal(fact.basis, "DECLARED"); assert.equal(fact.ruleRef.version, "2");
    const evidence = result.evidence.find(item => item.evidenceId === fact.evidenceIds[0]);
    assert.match(Buffer.from(text).subarray(evidence.anchor.byteStart, evidence.anchor.byteEnd).toString(), /^import /);
  }
  assert.equal(result.facts.filter(fact => fact.predicate === "staticCalls").length, 0);
  assert.ok(result.gaps.some(gap => gap.code === "JAVASCRIPT_IMPORT_UNRESOLVED"));
});

test("F002 @2 Java nested type and method parents use AST ancestors", () => {
  const result = compile([material("src/A.java", "class Outer { class Inner { void run() {} } void sibling() {} }\n")]);
  const root = result.objects.find(item => item.kind === "MATERIAL"), outer = object(result, "Outer"), inner = object(result, "Inner"), method = object(result, "Inner#run"), sibling = object(result, "Outer#sibling");
  for (const [parent, child] of [[root, outer], [outer, inner], [inner, method], [outer, sibling]]) {
    assert.equal(child.parentId, parent.objectId); assert.ok(edge(result, "contains", parent, child)); assert.ok(edge(result, "declares", parent, child));
  }
});

test("F002 @2 Java constructor local type and import objects retain their actual syntax parents", () => {
  const result = compile([material("src/A.java", "import java.util.List;\nclass Outer { Outer() {} void run() { class Local { void nested() {} } } }\n")]);
  const root = result.objects.find(item => item.kind === "MATERIAL"), outer = object(result, "Outer"), constructor = object(result, "Outer#Outer"), method = object(result, "Outer#run"), local = object(result, "Local"), declaration = object(result, "java.util.List");
  assert.equal(constructor.kind, "JAVA_CONSTRUCTOR"); assert.equal(constructor.parentId, outer.objectId);
  assert.equal(local.parentId, method.objectId); assert.ok(edge(result, "declares", method, local));
  assert.equal(declaration.kind, "IMPORT"); assert.ok(edge(result, "imports", root, declaration));
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile(2) });
});

test("F002 @2 Markdown hierarchy follows heading levels and excludes fenced headings", () => {
  const result = compile([material("docs/a.md", "# 根\r\n## 子😀\r\n~~~md\r\n# not a section\r\n~~~\r\n### 深层\r\n# sibling\r\n")]);
  const root = result.objects.find(item => item.kind === "MATERIAL"), parent = object(result, "根"), child = object(result, "子😀"), deep = object(result, "深层"), sibling = object(result, "sibling");
  for (const [owner, section] of [[root, parent], [parent, child], [child, deep], [root, sibling]]) {
    assert.equal(section.parentId, owner.objectId); assert.ok(edge(result, "contains", owner, section));
  }
  assert.equal(result.objects.some(item => item.name === "not a section"), false);
  assert.equal(child.anchor.lineStart, 2);
});

test("F002 publication rejects missing, cross-material and cyclic declared parent references", () => {
  const legacy = canonicalRecords(compile(historicalMaterials(), 1));
  const mutate = transform => legacy.map(record => record.kind === "OBJECT" ? { ...record, payload: transform({ ...record.payload }, legacy) } : record);
  const children = legacy.filter(record => record.kind === "OBJECT" && record.payload.kind !== "MATERIAL");
  assert.throws(() => normalizeCanonicalRecords(mutate(payload => payload.objectId === children[0].id ? { ...payload, parentId: "f".repeat(64) } : payload), { workspaceId, bundleId }), { code: "F002_RECORD_REFERENCE_INVALID" });
  const foreign = children.find(record => record.payload.materialId !== children[0].payload.materialId);
  assert.throws(() => normalizeCanonicalRecords(mutate(payload => payload.objectId === children[0].id ? { ...payload, parentId: foreign.id } : payload), { workspaceId, bundleId }), { code: "F002_RECORD_REFERENCE_INVALID" });
  const sections = children.filter(record => record.payload.kind === "DOCUMENT_SECTION");
  assert.throws(() => normalizeCanonicalRecords(mutate(payload => payload.objectId === sections[0].id ? { ...payload, parentId: sections[1].id } : payload.objectId === sections[1].id ? { ...payload, parentId: sections[0].id } : payload), { workspaceId, bundleId }), { code: "F002_RECORD_PARENT_CYCLE" });
});

test("F002 structural output is deterministic across input order with no cross-material parent", () => {
  const inputs = historicalMaterials(), forward = compile(inputs), reverse = compile([...inputs].reverse());
  assert.deepEqual(canonicalRecords(forward), canonicalRecords(reverse));
  for (const child of forward.objects.filter(item => item.kind !== "MATERIAL")) {
    assert.ok(child.parentId); assert.equal(forward.objects.find(item => item.objectId === child.parentId).materialId, child.materialId);
  }
});

test("F002 profiles cannot ambiguously name two implementations of one material capability", () => {
  assert.throws(() => new F002RuleRegistry({ ruleVersions: ["javascript@1", "javascript@2"] }).assertProfile({ ruleVersions: ["javascript@1", "javascript@2"] }), { code: "RULE_VERSION_AMBIGUOUS" });
});

test("F002 @2 publication requires parent metadata and contains Facts to agree exactly", () => {
  const result = compile([material("src/a.js", "function outer() { function inner() {} }\n")]);
  const child = object(result, "inner"), outer = object(result, "outer"), root = result.objects.find(item => item.kind === "MATERIAL");
  const records = canonicalRecords(result);
  const missing = records.filter(record => !(record.kind === "FACT" && record.payload.predicate === "contains" && record.payload.targetId === child.objectId));
  assert.throws(() => normalizeCanonicalRecords(missing, { workspaceId, bundleId, profile: profile(2) }), { code: "F002_RECORD_REFERENCE_INVALID" });
  const mismatch = records.map(record => record.kind === "OBJECT" && record.id === child.objectId ? { ...record, payload: { ...record.payload, parentId: root.objectId } } : record);
  assert.throws(() => normalizeCanonicalRecords(mismatch, { workspaceId, bundleId, profile: profile(2) }), { code: "F002_RECORD_REFERENCE_INVALID" });
  assert.ok(edge(result, "declares", outer, child));
});

test("F002 exposes a separately identified structured profile without mutating standard-v1", () => {
  assert.equal(typeof runtime.structuredF002Profile, "function");
  const legacy = runtime.standardF002Profile(), current = runtime.structuredF002Profile();
  assert.notEqual(current.id, legacy.id); assert.equal(legacy.version, "1"); assert.equal(current.version, "2");
  assert.ok(legacy.ruleVersions.includes("javascript@1")); assert.ok(current.ruleVersions.includes("javascript@2"));
  assert.ok(current.ruleVersions.includes("java@2")); assert.ok(current.ruleVersions.includes("markdown@2"));
  assert.equal(current.ruleVersions.includes("javascript@1"), false);
});

test("F002 publication does not accept @2 material with missing structural output or @1 structural predicates", () => {
  const result = compile([material("src/a.js", "function run() {}\n")]);
  const incomplete = canonicalRecords(result).filter(record => !(record.kind === "FACT" && ["contains", "declares"].includes(record.payload.predicate)))
    .map(record => { if (record.kind !== "OBJECT") return record; const { parentId: _parentId, ...payload } = record.payload; return { ...record, payload }; });
  assert.throws(() => normalizeCanonicalRecords(incomplete, { workspaceId, bundleId, profile: profile(2) }), { code: "F002_RECORD_REFERENCE_INVALID" });
  const old = compile([material("src/a.js", "function run() {}\n")], 1), root = old.objects.find(item => item.kind === "MATERIAL"), child = object(old, "run");
  child.parentId = root.objectId;
  const payload = { kind: "RELATION", subjectId: root.objectId, predicate: "contains", targetId: child.objectId,
    basis: "DECLARED", evidenceIds: old.facts[0].evidenceIds, ruleRef: { id: "f002-javascript", version: "1" }, premiseFactIds: [] };
  payload.factId = createFactId(payload);
  assert.throws(() => normalizeCanonicalRecords([...canonicalRecords(old), { kind: "FACT", id: payload.factId, payload }],
    { workspaceId, bundleId, profile: profile(1) }), { code: "F002_RECORD_RULE_INVALID" });
});

test("F002 object detail exposes the exact same-version parent reference", async () => {
  const result = compile([material("src/a.js", "function outer() { function inner() {} }\n")]), records = canonicalRecords(result), child = object(result, "inner");
  const graphVersionId = "e".repeat(64);
  const queries = new F002QueryService({ withAuthorizedWorkspace: async (actor, workspace, callback) => {
    assert.equal(workspace, workspaceId); assert.equal(actor.actorId, "owner");
    return callback({ query: async (sql, values) => {
      assert.equal(values[0], workspaceId); assert.equal(values[1], graphVersionId);
      return { rows: sql.includes("kind=$3") ? records.filter(record => record.kind === values[2] && record.id === values[3]) : records };
    } });
  } }, { cursorSecret: "structure-query-pure-contract" });
  const detail = await queries.record({ actorId: "owner" }, workspaceId, graphVersionId, "OBJECT", child.objectId);
  assert.equal(detail.references.find(reference => reference.role === "parent")?.id, child.parentId);
  assert.equal(detail.references.find(reference => reference.role === "parent")?.payload.materialId, child.materialId);
});
