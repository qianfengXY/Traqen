import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["java@2"], extractionLimits: { javaSyntax: "ast-declarations-v1", ...limits } });
const compile = (text, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials: [{ componentId: "a".repeat(64), pathBytes: Buffer.from("src/Example.java").toString("base64url"), mediaType: "text/x-java", bytes: Buffer.from(text) }] });
const objects = (r, kind) => r.objects.filter(o => o.kind === kind);
const props = (r, id, predicate) => r.facts.filter(f => f.subjectId === id && f.predicate === predicate);
const value = (r, object, predicate) => props(r, object.objectId, predicate)[0]?.value.value;
const calls = r => r.facts.filter(f => f.predicate === "staticCalls");

test("F002 Java AST declaration profile is opt-in without rewriting historical rules", () => {
  assert.equal(standardF002Profile().extractionLimits.javaSyntax, undefined);
  assert.equal(structuredF002Profile().extractionLimits.javaSyntax, "ast-declarations-v1");
});

test("F002 Java packages imports nested types and declared signatures remain explicit syntax", () => {
  const r = compile("package demo;\nimport java.util.List;\nimport static java.util.Collections.emptyList;\nclass Outer { class Inner { public String run(int count, List<String> items) { return null; } } }\n");
  assert.equal(objects(r, "JAVA_PACKAGE")[0]?.name, "demo");
  const inner = objects(r, "JAVA_TYPE").find(o => o.name === "Inner"); assert.equal(value(r, inner, "qualifiedName"), "demo.Outer.Inner");
  const method = objects(r, "JAVA_METHOD")[0]; assert.equal(value(r, method, "signature"), "run(int,List<String>)");
  assert.equal(value(r, method, "type"), "String"); assert.equal(value(r, method, "staticModifier"), false);
  const imports = objects(r, "IMPORT"); assert.equal(imports.length, 2);
  assert.equal(value(r, imports.find(o => o.name === "java.util.Collections.emptyList"), "importKind"), "STATIC");
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Java parameters retain direct method owners original types order and exact CRLF UTF8 anchors", () => {
  const text = 'class 根 {\r\n String run(@Deprecated final String 标签, int n) { return "😀"; }\r\n}\r\n';
  const r = compile(text), method = objects(r, "JAVA_METHOD")[0], params = objects(r, "JAVA_PARAMETER").sort((a, b) => a.anchor.byteStart - b.anchor.byteStart); assert.equal(params.length, 2);
  for (const [index, parameter] of params.entries()) {
    assert.equal(parameter.parentId, method.objectId); assert.equal(value(r, parameter, "parameterIndex"), index);
    const relation = r.facts.find(f => f.predicate === "declaresParameter" && f.targetId === parameter.objectId); assert.ok(relation); assert.equal(relation.subjectId, method.objectId);
    assert.equal(parameter.anchor.lineStart, 2); assert.match(Buffer.from(text).subarray(parameter.anchor.byteStart, parameter.anchor.byteEnd).toString(), index ? /^int n$/ : /^@Deprecated final String 标签$/);
  }
  assert.equal(value(r, params[0], "type"), "String"); assert.equal(value(r, params[1], "type"), "int");
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Java annotations bind to their declaration rather than comment spellings or nested parameter names", () => {
  const r = compile('/* @Fake */ @Deprecated class Outer { @Override String run(@Deprecated String value) { return "@False"; } }');
  const annotations = objects(r, "JAVA_ANNOTATION"); assert.equal(annotations.length, 3);
  assert.deepEqual(annotations.map(o => o.name).sort(), ["Deprecated", "Deprecated", "Override"]);
  assert.deepEqual(annotations.map(o => r.objects.find(p => p.objectId === o.parentId).kind).sort(), ["JAVA_METHOD", "JAVA_PARAMETER", "JAVA_TYPE"]);
  assert.ok(annotations.every(o => value(r, o, "annotationName") === o.name));
});

test("F002 Java constructors varargs field declarations and record parameters keep syntax instead of runtime values", () => {
  const r = compile('record Pair(String left, int right) {} class Box { private String a="DO_NOT_INDEX", b; Box(String... values) {} }');
  const fields = objects(r, "JAVA_FIELD"); assert.deepEqual(fields.map(o => o.name), ["a", "b"]);
  assert.ok(fields.every(o => value(r, o, "type") === "String"));
  const constructor = objects(r, "JAVA_CONSTRUCTOR")[0]; assert.equal(value(r, constructor, "signature"), "Box(String...)");
  assert.equal(objects(r, "JAVA_PARAMETER").length, 3);
  assert.equal(JSON.stringify(r.facts).includes("DO_NOT_INDEX"), false, "field initializer values are not interpreted or indexed");
});

test("F002 Java invalid AST and Unicode preprocessing restrictions do not publish guessed partial declarations", () => {
  for (const [text, code] of [["class Broken { void run( {", "JAVA_PARSE_FAILED"], ["cl\\u0061ss Escaped {}", "JAVA_UNICODE_ESCAPE_UNSUPPORTED"]]) {
    const r = compile(text); assert.equal(objects(r, "JAVA_TYPE").length, 0); assert.ok(r.gaps.some(g => g.code === code));
  }
});

test("F002 Java deterministic node budget stops declarations before emitting a partial symbol set", () => {
  const r = compile("class A { void first() {} void second() {} }", { maxJavaNodes: 2 });
  assert.equal(objects(r, "JAVA_TYPE").length, 0); assert.ok(r.gaps.some(g => g.code === "JAVA_AST_LIMIT"));
});

test("F002 Java unique local zero-argument static calls carry source occurrence and non-inheritance premises", () => {
  const r = compile("class Example { static String helper() { return null; } String run() { return helper(); } }");
  assert.equal(calls(r).length, 1); const call = calls(r)[0], target = r.objects.find(o => o.objectId === call.targetId);
  assert.equal(target.name, "Example#helper"); assert.equal(call.basis, "DERIVED"); assert.equal(call.premiseFactIds.length, 5);
  assert.ok(call.premiseFactIds.every(id => r.facts.some(f => f.factId === id && f.basis === "DECLARED")));
  assert.equal(objects(r, "JAVA_CALL").length, 1);
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Java overloads varargs instance calls and inherited owners remain explicit unresolved occurrences", () => {
  for (const text of [
    "class Example { static void helper() {} static void helper(int n) {} void run(){helper();} }",
    "class Example { static void helper(String... args) {} void run(){helper();} }",
    "class Example { void helper() {} void run(){helper();} }",
    "class Example extends Parent { static void helper() {} void run(){helper();} }",
  ]) { const r = compile(text); assert.equal(calls(r).length, 0); assert.ok(r.gaps.some(g => g.code === "JAVA_INVOCATION_UNRESOLVED")); assert.equal(objects(r, "JAVA_CALL").length, 1); }
});

test("F002 Java static receiver spellings require the same unshadowed declared owner", () => {
  const r = compile("class Example { static void helper() {} void run(){Example.helper();} }"); assert.equal(calls(r).length, 1);
  for (const text of ["class Example { static void helper() {} void run(Other Example){Example.helper();} }", "class Example { static void helper() {} void run(){Other.helper();} }"]) {
    const restricted = compile(text); assert.equal(calls(restricted).length, 0); assert.ok(restricted.gaps.some(g => g.code === "JAVA_INVOCATION_UNRESOLVED"));
  }
});

test("F002 Java anonymous lambda and local-type invocation boundaries cannot be attributed to an outer method", () => {
  const r = compile("class Example { static void helper() {} void run(){Runnable value=()->helper(); Object o=new Object(){void x(){helper();}};} }");
  assert.equal(calls(r).length, 0); assert.ok(r.gaps.some(g => g.code === "JAVA_INVOCATION_SCOPE_UNSUPPORTED"));
});

test("F002 Java full static proof cannot publish empty or retargeted premise lists even with a recomputed Fact ID", () => {
  const r = compile("class Example { static void helper() {} static void other() {} void run(){helper();} }"); assert.equal(calls(r).length, 1);
  const other = objects(r, "JAVA_METHOD").find(o => o.name === "Example#other");
  for (const change of [{ premiseFactIds: [] }, { targetId: other.objectId }]) {
    const records = canonicalRecords(r).map(record => {
      if (record.kind !== "FACT" || record.payload.predicate !== "staticCalls") return record;
      const p = { ...record.payload, ...change }; const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, targetId: p.targetId, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
      return { ...record, id, payload: { ...p, factId: id } };
    });
    assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
  }
});

test("F002 Java field annotations attach only to a unique field declaration instead of its surrounding type", () => {
  const r = compile("class Example { @Deprecated String field; }"); const field = objects(r, "JAVA_FIELD")[0], annotation = objects(r, "JAVA_ANNOTATION")[0];
  assert.equal(annotation.parentId, field.objectId);
  const multi = compile("class Example { @Deprecated String one,two; }");
  assert.equal(objects(multi, "JAVA_ANNOTATION").length, 0); assert.ok(multi.gaps.some(g => g.code === "JAVA_ANNOTATION_OWNER_UNSUPPORTED"));
});

test("F002 Java parameter dimensions and local type parents retain their actual syntax without name flattening", () => {
  const r = compile("class Outer { void run(String labels[]) { class Local { void inner() {} } } }");
  const method = objects(r, "JAVA_METHOD").find(o => o.name === "Outer#run"), local = objects(r, "JAVA_TYPE").find(o => o.name === "Local");
  assert.equal(local.parentId, method.objectId); assert.equal(value(r, method, "signature"), "run(String[])");
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Java publication rejects forged signature and negative parameter order with recomputed identities", () => {
  const r = compile("class Example { void run(String value) {} }");
  for (const [predicate, value] of [["signature", "run(int)"], ["parameterIndex", -1]]) {
    const records = canonicalRecords(r).map(record => {
      if (record.kind !== "FACT" || record.payload.predicate !== predicate) return record;
      const p = { ...record.payload, value: { ...record.payload.value, value } };
      const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, typedValue: p.value, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
      return { ...record, id, payload: { ...p, factId: id } };
    });
    assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_DECLARATION_INVALID" });
  }
});

test("F002 Java syntactic comments are not arguments and missing parser tokens cannot become declarations", () => {
  const r = compile("class Example { static void helper() {} void run(){helper(/* no argument */);} }");
  assert.equal(calls(r).length, 1);
  const broken = compile("class Example {"); assert.equal(objects(broken, "JAVA_TYPE").length, 0); assert.ok(broken.gaps.some(g => g.code === "JAVA_PARSE_FAILED"));
});

test("F002 Java type annotations cannot smuggle unprocessed annotation values into declared type strings", () => {
  const r = compile('class Example { java.util.List<@Unknown("DO_NOT_INDEX") String> values; }');
  assert.equal(objects(r, "JAVA_TYPE").length, 0); assert.equal(JSON.stringify(r.facts).includes("DO_NOT_INDEX"), false);
  assert.ok(r.gaps.some(g => g.code === "JAVA_TYPE_ANNOTATION_UNSUPPORTED"));
});

test("F002 Java annotation declarations disclose the not-yet-configured Spring mapping capability", () => {
  const r = compile("import org.springframework.web.bind.annotation.GetMapping; class Example { @GetMapping void run() {} }");
  assert.equal(objects(r, "ROUTE").length, 0); assert.ok(r.gaps.some(g => g.code === "SPRING_MAPPING_NOT_CONFIGURED"));
});
