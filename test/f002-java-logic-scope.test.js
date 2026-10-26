import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { verifyPublication } from "../src/deterministic-facts/verification.js";

function compile(code) {
  const workspaceId = "workspace", bundleId = "b".repeat(64), bytes = Buffer.from(code), profile = technicalF002Profile();
  const result = compileDeterministicFacts({ workspaceId, bundleId, profile, materials: [{ componentId: "a".repeat(64),
    pathBytes: Buffer.from("Scopes.java").toString("base64url"), mediaType: "text/plain", bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex") }] });
  verifyPublication({ workspaceId, bundleId, scopeId: "d".repeat(64), profile, records: canonicalRecords(result) });
  const objects = new Map(result.objects.map(object => [object.objectId, object]));
  const reads = result.facts.filter(fact => fact.predicate === "readsBinding")
    .map(fact => ({ source: objects.get(fact.subjectId), target: objects.get(fact.targetId) }));
  return { ...result, reads };
}

function targetAt(result, code, use, declaration) {
  const offset = code.indexOf(use);
  const read = result.reads.find(read => read.source.anchor.byteStart === offset);
  assert.ok(read, `expected a lexical read at ${use}`);
  assert.equal(read.target.anchor.byteStart, code.indexOf(declaration), `wrong declaration for ${use}`);
}

test("F002 Java enhanced-for binds its body variable, not its iterable expression or the enclosing field", () => {
  const code = "class Loop { java.util.List<String> item; void use(String x) {} void f() { for (String item : item) { use(item); } after(item); } }";
  const result = compile(code);
  targetAt(result, code, "item); }", "item :");
  targetAt(result, code, "item) {", "item; void");
  targetAt(result, code, "item); } }", "item; void");
});

test("F002 Java catch parameters and resources have their own visibility and do not leak into catch or finally", () => {
  const code = "class A { Object item; void f() { try (var item = open(); var next = wrap(item)) { use(item); } catch (Exception item) { caught(item); } finally { after(item); } tail(item); } }";
  const result = compile(code);
  targetAt(result, code, "item))", "item = open");
  targetAt(result, code, "item); } catch", "item = open");
  targetAt(result, code, "item); } finally", "item) { caught");
  targetAt(result, code, "item); } tail", "item; void");
  targetAt(result, code, "item); } }", "item; void");
});

test("F002 Java flow-scoped patterns never become reads of an outer homonym", () => {
  for (const statement of ["if (value instanceof String item) { use(item); }", "if (!(value instanceof String item)) return; use(item);",
    "switch(value) { case String item -> use(item); default -> use(value); }",
    "if (value instanceof Pair(String item, Integer count)) { use(item); }"]) {
    const code = `class A { String item; Object Pair; void f(Object value) { ${statement} } }`;
    const result = compile(code);
    assert.equal(result.reads.some(read => read.source.name === "item"), false, statement);
    assert.equal(result.reads.some(read => read.source.name === "Pair"), false, "a record pattern's type name is not a field read");
    assert.ok(result.gaps.some(gap => gap.code === "JAVA_PATTERN_SCOPE_UNRESOLVED"), statement);
    assert.ok(result.reads.some(read => read.source.name === "value"), "unrelated method parameters remain useful");
  }
});

test("F002 Java fields stay within their class and record components bind to their own body", () => {
  const code = "class A { String item; String f(){ return item; } } class B { String f(){ return item; } } record C(String item) { String f(){ return item; } }";
  const result = compile(code);
  targetAt(result, code, "item; } } class B", "item; String");
  const fromB = code.indexOf("item; } } record");
  assert.equal(result.reads.some(read => read.source.anchor.byteStart === fromB), false, "an unrelated class cannot see A's field");
  const fromRecord = code.lastIndexOf("item;");
  assert.equal(result.reads.find(read => read.source.anchor.byteStart === fromRecord)?.target.anchor.byteStart, code.indexOf("item) { String"));
});

test("F002 Java ordinary for, lambda and varargs remain resolved while inherited inner members remain unknown", () => {
  const code = "class A { String item; void f(){ for(String item=\"x\"; item!=null;) { use(item); } var fn=(item)->{ use(item); }; } void g(String... item){ use(item); } class Inner extends Base { void h(){ use(item); } } }";
  const result = compile(code);
  targetAt(result, code, "item); } var", "item=\"x\"");
  targetAt(result, code, "item); };", "item)->");
  targetAt(result, code, "item); } class", "item){ use");
  assert.equal(result.reads.some(read => read.source.anchor.byteStart === code.lastIndexOf("item);")), false);
  assert.ok(result.gaps.some(gap => gap.code === "JAVA_CLASS_MEMBER_SCOPE_UNRESOLVED"));
});

test("F002 Java local declaration visibility starts at its declaration, not at the beginning of the block", () => {
  const code = "class A { String item; void f() { before(item); String item = init(); after(item); } }";
  const result = compile(code);
  targetAt(result, code, "item); String", "item; void");
  targetAt(result, code, "item); } }", "item = init");
});

test("F002 Java explicit member names never resolve as a same-named unqualified local", () => {
  const code = "class A { String item; void f(A other, String item) { use(this.item); use(other.item); use(item); } }";
  const result = compile(code);
  targetAt(result, code, "item); } }", "item) { use");
  const properties = [code.indexOf("item); use(other"), code.indexOf("item); use(item")];
  assert.equal(result.reads.some(read => properties.includes(read.source.anchor.byteStart)), false);
  targetAt(result, code, "other.item", "other, String");
  assert.ok(result.gaps.some(gap => gap.code === "JAVA_MEMBER_ACCESS_UNRESOLVED"));
});

test("F002 Java record varargs components are body bindings, not compilation-unit globals", () => {
  const code = "record C(String... item) { Object f(){ return item; } } class Other { Object f(){ return item; } }";
  const result = compile(code);
  targetAt(result, code, "item; } } class", "item) { Object");
  assert.equal(result.reads.some(read => read.source.anchor.byteStart === code.lastIndexOf("item;")), false);
});
