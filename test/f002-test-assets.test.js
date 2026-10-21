import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { createFactId } from "../src/deterministic-facts/identity.js";

const workspaceId = "workspace", bundleId = "b".repeat(64), componentId = "a".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["javascript@2", "java@2"], extractionLimits: { javascriptBindings: "lexical-bindings-v1", javaSyntax: "ast-declarations-v1", testAssets: "framework-declarations-v1", ...limits } });
const compile = (text, java = false, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials: [{ componentId, pathBytes: Buffer.from(java ? "Example.java" : "example.js").toString("base64url"), mediaType: java ? "text/x-java" : "text/javascript", bytes: Buffer.from(text) }] });
const objects = (r, kind) => r.objects.filter(o => o.kind === kind);
const prop = (r, object, predicate) => r.facts.find(f => f.subjectId === object.objectId && f.predicate === predicate)?.value?.value;
const jsImports = "import {test as scenario} from 'node:test';\r\nimport assert from 'node:assert/strict';\r\n";
const javaImports = "import org.junit.jupiter.api.Test;\r\nimport org.junit.jupiter.api.Assertions;\r\nimport static org.junit.jupiter.api.Assertions.assertTrue;\r\n";
const validate = r => normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
const mutate = (r, predicate, change) => canonicalRecords(r).map(record => {
  if (record.kind !== "FACT" || record.payload.predicate !== predicate) return record;
  const p = change(record.payload), id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, ...(p.kind === "RELATION" ? { targetId: p.targetId } : { typedValue: p.value }), basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
  return { ...record, id, payload: { ...p, factId: id } };
});

test("F002 test assets are opt-in without changing historical extraction profiles", () => {
  assert.equal(standardF002Profile().extractionLimits.testAssets, undefined);
  assert.equal(structuredF002Profile().extractionLimits.testAssets, "framework-declarations-v1");
});

test("F002 Node test registration assertions and proven subject calls retain distinct declarations and premises", () => {
  const r = compile(jsImports + 'function subject(){return 7;}\r\nscenario("读😀",()=>{assert.strictEqual(subject(),7); assert.ok(true);});\r\n');
  const cases = objects(r, "TEST_CASE"), assertions = objects(r, "TEST_ASSERTION"); assert.equal(cases.length, 1); assert.equal(assertions.length, 2);
  assert.equal(prop(r, cases[0], "testName"), "读😀"); assert.equal(prop(r, cases[0], "testFramework"), "node:test");
  assert.ok(assertions.every(a => a.parentId === cases[0].objectId && prop(r, a, "testFramework") === "node:assert/strict"));
  assert.equal(r.facts.filter(f => f.predicate === "hasAssertion").length, 2);
  const reference = r.facts.find(f => f.predicate === "refersTo" && f.subjectId === cases[0].objectId); assert.ok(reference); assert.equal(reference.premiseFactIds.length, 2);
  assert.equal(r.objects.find(o => o.objectId === reference.targetId).name, "subject"); assert.equal(r.facts.some(f => f.predicate === "reportsResult"), false);
  validate(r);
});

test("F002 Node named assertion imports preserve aliases and exact physical UTF8 CRLF source", () => {
  const text = "import test from 'node:test';\r\nimport {strictEqual as equalTo} from 'node:assert/strict';\r\ntest('根😀',()=>{equalTo(1,1);});\r\n", r = compile(text);
  const assertion = objects(r, "TEST_ASSERTION")[0]; assert.ok(assertion); assert.equal(prop(r, assertion, "assertionName"), "equalTo");
  assert.equal(assertion.anchor.lineStart, 3); assert.equal(Buffer.from(text).subarray(assertion.anchor.byteStart, assertion.anchor.byteEnd).toString(), "equalTo(1,1)");
  validate(r);
});

test("F002 Node test identifiers resolve actual lexical block catch and destructured parameter bindings", () => {
  for (const text of [
    "{ const scenario=()=>{}; scenario('fake',()=>{}); }",
    "function wrapper({scenario}){scenario('fake',()=>{});}",
    "try{}catch(scenario){scenario('fake',()=>{});}",
  ]) assert.equal(objects(compile(jsImports + text), "TEST_CASE").length, 0);
});

test("F002 Node assertion receiver writes computed calls escapes and lexical shadows never become framework assertions", () => {
  for (const text of [
    "assert.strictEqual=other; scenario('x',()=>{assert.strictEqual(1,1);});",
    "scenario('x',assert=>{assert.ok(true);});",
    "scenario('x',()=>{const assert={ok(){}};assert.ok(true);});",
    "unknown(assert);scenario('x',()=>{assert.ok(true);});",
    "scenario('x',()=>{assert['ok'](true);});",
  ]) assert.equal(objects(compile(jsImports + text), "TEST_ASSERTION").length, 0);
});

test("F002 test ownership excludes deferred nested functions and unsupported registration options", () => {
  const r = compile(jsImports + "scenario('x',()=>{function deferred(){assert.ok(true);}assert.strictEqual(1,1);});");
  assert.equal(objects(r, "TEST_ASSERTION").length, 1);
  for (const call of ["scenario(name,()=>{});", "scenario('x',{skip:true},()=>{});", "scenario.skip('x',()=>{});"]) {
    const r = compile(jsImports + call); assert.equal(objects(r, "TEST_CASE").length, 0); assert.ok(r.gaps.some(g => g.code === "TEST_DECLARATION_UNSUPPORTED"));
  }
});

test("F002 test declaration budgets reject a partial test or assertion set", () => {
  const r = compile(jsImports + "scenario('one',()=>{assert.ok(true);});scenario('two',()=>{assert.ok(true);});", false, { maxTestCases: 1 });
  assert.equal(objects(r, "TEST_CASE").length, 0); assert.equal(objects(r, "TEST_ASSERTION").length, 0); assert.ok(r.gaps.some(g => g.code === "TEST_ASSET_LIMIT"));
});

test("F002 JUnit Jupiter direct annotations and exact assertion imports retain method-owned test assets", () => {
  const r = compile(javaImports + 'class Example {\r\n @Test void read(){Assertions.assertEquals(subject(),7);assertTrue(true);}\r\n static int subject(){return 7;}\r\n}\r\n', true);
  const cases = objects(r, "TEST_CASE"), assertions = objects(r, "TEST_ASSERTION"); assert.equal(cases.length, 1); assert.equal(assertions.length, 2);
  assert.equal(prop(r, cases[0], "testFramework"), "junit-jupiter"); assert.equal(prop(r, cases[0], "testName"), "read");
  assert.equal(r.objects.find(o => o.objectId === cases[0].parentId).name, "Example#read"); assert.ok(assertions.every(a => a.parentId === cases[0].objectId));
  const reference = r.facts.find(f => f.predicate === "refersTo" && f.subjectId === cases[0].objectId); assert.ok(reference);
  assert.equal(r.objects.find(o => o.objectId === reference.targetId).name, "Example#subject"); validate(r);
});

test("F002 JUnit annotation spellings alone wildcard imports and local annotation shadows are not framework binding", () => {
  for (const text of [
    "import other.Test;class Example{@Test void x(){}}",
    "import org.junit.jupiter.api.*;class Example{@Test void x(){}}",
    "class Example{@Test void x(){}}",
    javaImports + "@interface Test{} class Example{@Test void x(){}}",
  ]) { const r = compile(text, true); assert.equal(objects(r, "TEST_CASE").length, 0); assert.ok(r.gaps.some(g => g.code === "TEST_FRAMEWORK_UNRESOLVED")); }
});

test("F002 JUnit assertion names require exact receiver imports without method or parameter shadows", () => {
  for (const body of ["void assertTrue(boolean x){} @Test void x(){assertTrue(true);}", "@Test void x(Other Assertions){Assertions.assertEquals(1,1);}", "@Test void x(){Other.assertEquals(1,1);}"])
    assert.equal(objects(compile(javaImports + `class Example{${body}}`, true), "TEST_ASSERTION").length, 0);
});

test("F002 test publication refuses a subject reference not supported by its actual static-call premise", () => {
  const r = compile(jsImports + "function subject(){return 1;}function other(){return 2;}scenario('x',()=>{assert.ok(subject());});");
  const other = objects(r, "FUNCTION").find(o => o.name === "other"); assert.ok(other);
  const records = mutate(r, "refersTo", p => ({ ...p, targetId: other.objectId }));
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 test publication refuses an assertion attached to another case without changing its original parent", () => {
  const r = compile(jsImports + "scenario('one',()=>{assert.ok(true);});scenario('two',()=>{assert.ok(false);});");
  const assertions = objects(r, "TEST_ASSERTION"); assert.equal(assertions.length, 2);
  const records = mutate(r, "hasAssertion", p => ({ ...p, targetId: assertions.find(a => a.objectId !== p.targetId).objectId }));
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 JUnit Test annotation attributes cannot pretend to be supported marker-test declarations", () => {
  const r = compile(javaImports + 'class Example{@Test(value="unsupported") void x(){}}', true);
  assert.equal(objects(r, "TEST_CASE").length, 0); assert.ok(r.gaps.some(g => g.code === "TEST_DECLARATION_UNSUPPORTED"));
});

test("F002 explicit fully-qualified and empty JUnit marker annotations have no uninterpreted-argument Gap", () => {
  for (const text of ['class Example{@org.junit.jupiter.api.Test void x(){org.junit.jupiter.api.Assertions.assertTrue(true);}}', javaImports + 'class Example{@Test() void x(){assertTrue(true);}}']) {
    const r = compile(text, true); assert.equal(objects(r, "TEST_CASE").length, 1); assert.equal(objects(r, "TEST_ASSERTION").length, 1);
    assert.equal(r.gaps.some(g => g.code === "JAVA_ANNOTATION_ARGUMENTS_NOT_INTERPRETED"), false); validate(r);
  }
});

test("F002 deferred nested subject calls do not become direct test references", () => {
  const r = compile(jsImports + "function subject(){} scenario('x',()=>{function deferred(){subject();}assert.ok(true);});");
  assert.equal(r.facts.filter(f => f.predicate === "refersTo" && objects(r, "TEST_CASE").some(o => o.objectId === f.subjectId)).length, 0); validate(r);
});

test("F002 publication requires framework and body proof for every new test-case object", () => {
  const r = compile(jsImports + "scenario('x',()=>{assert.ok(true);});");
  const remove = new Set(["registrationName", "testBody", "testFramework", "assertionName", "assertionReceiver", "hasAssertion"]);
  const records = canonicalRecords(r).filter(r => r.kind !== "FACT" || !remove.has(r.payload.predicate));
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 sensitive configuration-shaped test titles retire their values from all searchable output", () => {
  const r = compile(jsImports + "scenario('API_TOKEN=TEST_TITLE_SENTINEL',()=>{assert.ok(true);});");
  assert.equal(objects(r, "TEST_CASE").length, 0); assert.equal(JSON.stringify(r).includes("TEST_TITLE_SENTINEL"), false);
  assert.ok(r.gaps.some(g => g.code === "TEST_NAME_RESTRICTED"));
});

test("F002 test-name byte budgets are explicit and do not truncate Unicode declaration names", () => {
  const r = compile(jsImports + "scenario('根😀根😀',()=>{assert.ok(true);});", false, { maxTestNameBytes: 8 });
  assert.equal(objects(r, "TEST_CASE").length, 0); assert.ok(r.gaps.some(g => g.code === "TEST_NAME_LIMIT"));
});
