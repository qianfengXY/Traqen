import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { F002RuleRegistry } from "../src/deterministic-facts/rules.js";
import { canonicalDigest } from "../src/deterministic-facts/identity.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { vocabularyFor } from "../src/deterministic-facts/vocabulary.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = (version = "2", limits = {}) => ({ id: "c".repeat(64), version, ruleVersions: [`json@${version}`], extractionLimits: limits });
const material = (text, componentId = "a".repeat(64)) => ({ componentId, pathBytes: Buffer.from("api.json").toString("base64url"), mediaType: "application/json", bytes: Buffer.from(text) });
function compile(text, { version = "2", limits = {} } = {}) {
  return compileDeterministicFacts({ workspaceId, bundleId, profile: profile(version, limits), materials: [material(text)],
    ruleRegistry: new F002RuleRegistry({ ruleVersions: ["json@1", "json@2"] }) });
}
const node = (result, pointer) => { const found = result.objects.filter(item => item.anchor?.pointer === pointer); assert.equal(found.length, 1, `exact JSON node ${pointer}`); return found[0]; };
const value = (result, object, predicate) => result.facts.find(item => item.subjectId === object.objectId && item.predicate === predicate)?.value;
const relation = (result, predicate, subject, target) => result.facts.find(item => item.predicate === predicate && item.subjectId === subject.objectId && item.targetId === target.objectId);
const legacy = '{"openapi":"3.0.3","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}},"tests":[{"name":"report","status":"PASS"}]}';

test("F002 JSON @1 canonical output remains byte-identical", () => {
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: canonicalRecords(compile(legacy, { version: "1" })) }), "caa87d6763a32367f81c639b97f6af7d8b999d7e522887266346de4098b1086a");
});

test("F002 JSON @2 preserves typed scalars null arrays and direct syntax parents", () => {
  const result = compile('{"nested":{"s":"😀","n":12,"f":1.5,"b":false,"nil":null,"list":[1,2]}}');
  const parent = node(result, "/nested"), item = node(result, "/nested/list/1");
  for (const [pointer, typed] of [["s", { datatype: "string", value: "😀" }], ["n", { datatype: "integer", value: 12 }], ["f", { datatype: "number", value: 1.5 }], ["b", { datatype: "boolean", value: false }], ["nil", { datatype: "null", value: null }]]) {
    const child = node(result, `/nested/${pointer}`); assert.equal(child.parentId, parent.objectId);
    assert.deepEqual(value(result, child, "literalValue"), typed); assert.ok(relation(result, "contains", parent, child));
  }
  assert.equal(item.parentId, node(result, "/nested/list").objectId);
  assert.deepEqual(value(result, node(result, "/nested/list"), "type"), { datatype: "string", value: "array" });
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 JSON pointers bind repeated escaped keys to exact UTF8 CRLF source ranges", () => {
  const text = '{\r\n  "根😀": {"a/b~c": "same"},\r\n  "other": {"a/b~c": "same"}\r\n}';
  const result = compile(text), first = node(result, "/根😀/a~1b~0c"), second = node(result, "/other/a~1b~0c");
  assert.notEqual(first.objectId, second.objectId); assert.notEqual(first.anchor.textRange.byteStart, second.anchor.textRange.byteStart);
  for (const object of [first, second]) {
    assert.equal(object.anchor.kind, "JSON_POINTER"); const range = object.anchor.textRange;
    assert.equal(Buffer.from(text).subarray(range.byteStart, range.byteEnd).toString(), '"same"');
  }
  assert.equal(first.anchor.textRange.lineStart, 2); assert.equal(first.anchor.textRange.columnStart, 19, "columns count Unicode code points, not UTF-16 units");
});

test("F002 JSON rejects decoded duplicate keys rather than silently choosing a winner", () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"outer":{"x":1,"x":2}}']) {
    const result = compile(text); assert.equal(result.facts.length, 0); assert.equal(result.objects.length, 1);
    assert.ok(result.gaps.some(gap => gap.code === "JSON_DUPLICATE_KEY" && gap.anchor?.textRange));
  }
  assert.equal(compile('{"a":{"x":1},"b":{"x":2}}').gaps.length, 0, "keys in distinct objects are not duplicates");
});

test("F002 JSON rejects malformed tokens Unicode and unrepresentable numbers without partial output", () => {
  for (const text of ['{"a":01}', '{"a":1,}', '[1,]', '{"a":NaN}', '{"a":1} trailing', '{"a":"\\ud800"}', '{"a":1e999}', '{"a":9007199254740993}']) {
    const result = compile(text); assert.equal(result.facts.length, 0, text); assert.ok(result.gaps.length > 0, text);
  }
});

test("F002 JSON structure limits are deterministic and leave no truncated successful facts", () => {
  for (const [text, limits] of [['{"a":{"b":1}}', { maxJsonDepth: 1 }], ['[1,2,3]', { maxJsonNodes: 2 }]]) {
    const result = compile(text, { limits }); assert.equal(result.facts.length, 0); assert.equal(result.objects.length, 1);
    assert.ok(result.gaps.some(gap => gap.code === "JSON_STRUCTURE_LIMIT"));
  }
});

test("F002 JSON sensitive keys retire their complete subtree from objects values and pointers", () => {
  const result = compile('{"visible":7,"api\\u005fkey":{"child":"SECRET_SENTINEL","deep":["SECRET_SECOND"]},"nested":{"password":"SECRET_THIRD","safe":true}}');
  const serialized = JSON.stringify(canonicalRecords(result));
  for (const token of ["SECRET_SENTINEL", "SECRET_SECOND", "SECRET_THIRD", '"child"', "/api_key"]) assert.equal(serialized.includes(token), false);
  assert.ok(result.gaps.some(gap => gap.code === "JSON_SENSITIVE_SUBTREE_RESTRICTED"));
  assert.deepEqual(value(result, node(result, "/nested/safe"), "literalValue"), { datatype: "boolean", value: true });
});

test("F002 OpenAPI @2 parameters and responses have their own exact objects and evidence", () => {
  const result = compile(JSON.stringify({ openapi: "3.0.3", paths: { "/orders": { parameters: [{ name: "id", in: "query" }], get: {
    parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "ok" }, "404": { description: "missing" } } } } } }));
  const operation = node(result, "/paths/~1orders/get"), local = node(result, "/paths/~1orders/get/parameters/0"), inherited = node(result, "/paths/~1orders/parameters/0");
  assert.equal(operation.kind, "OPENAPI_OPERATION"); assert.equal(local.kind, "OPENAPI_PARAMETER");
  assert.ok(relation(result, "declaresParameter", operation, local));
  const derived = relation(result, "declaresParameter", operation, inherited); assert.equal(derived?.basis, "DERIVED"); assert.ok(derived.premiseFactIds.length > 0);
  assert.equal(node(result, "/paths/~1orders/get/responses/200").kind, "OPENAPI_RESPONSE");
  assert.equal(result.facts.filter(fact => fact.subjectId === operation.objectId && fact.predicate === "declaresResponse").length, 2);
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 OpenAPI references resolve only exact same-file JSON pointers without expansion or network", () => {
  const result = compile(JSON.stringify({ openapi: "3.1.0", components: { schemas: { "根/😀": { type: "object" } } }, paths: { "/a": { get: { responses: { "200": { schema: { $ref: "#/components/schemas/%E6%A0%B9~1%F0%9F%98%80" } } } } } } }));
  const source = node(result, "/paths/~1a/get/responses/200/schema"), target = node(result, "/components/schemas/根~1😀");
  assert.ok(relation(result, "refersTo", source, target)); assert.equal(result.gaps.length, 0);
});

test("F002 OpenAPI cyclic external missing and malformed references remain explicit limitations", () => {
  const result = compile(JSON.stringify({ openapi: "3.0.3", components: { schemas: {
    A: { $ref: "#/components/schemas/B" }, B: { $ref: "#/components/schemas/A" },
    C: { $ref: "https://invalid.example/spec.json" }, D: { $ref: "#/missing" }, E: { $ref: "#/bad~2pointer" } } }, paths: {} }));
  for (const code of ["JSON_REFERENCE_CYCLE", "JSON_REFERENCE_EXTERNAL_UNSUPPORTED", "JSON_REFERENCE_UNRESOLVED", "JSON_REFERENCE_INVALID"]) assert.ok(result.gaps.some(gap => gap.code === code), code);
  assert.equal(result.facts.some(fact => fact.predicate === "refersTo"), false);
});

test("F002 arbitrary JSON $ref fields do not acquire OpenAPI semantics", () => {
  const result = compile('{"$ref":"#/other","other":{}}');
  assert.equal(result.facts.some(fact => fact.predicate === "refersTo"), false);
  assert.deepEqual(value(result, node(result, "/$ref"), "literalValue"), { datatype: "string", value: "#/other" });
});

test("F002 JSON report declarations remain explicitly unbound to an execution", () => {
  const result = compile('{"tests":[{"name":"same","status":"PASS"},{"name":"same","status":"FAIL"}]}');
  const reports = result.objects.filter(object => object.kind === "TEST_RESULT"); assert.equal(reports.length, 2);
  assert.notEqual(reports[0].objectId, reports[1].objectId);
  assert.equal(result.facts.filter(fact => fact.predicate === "reportsResult").length, 2);
  assert.equal(result.gaps.filter(gap => gap.code === "EXECUTION_BINDING_MISSING").length, 2);
});

test("F002 JSON @2 publication rejects malformed pointer anchors and missing structure", () => {
  const result = compile('{"x":1}'), records = canonicalRecords(result), child = node(result, "/x");
  const invalid = records.map(record => record.kind === "OBJECT" && record.id === child.objectId ? { ...record, payload: { ...record.payload, anchor: { ...child.anchor, pointer: "/bad~2" } } } : record);
  assert.throws(() => normalizeCanonicalRecords(invalid, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_ANCHOR_INVALID" });
  assert.throws(() => normalizeCanonicalRecords(records.filter(record => !(record.kind === "FACT" && record.payload.predicate === "contains" && record.payload.targetId === child.objectId)), { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_REFERENCE_INVALID" });
});

test("F002 new JSON profile is versioned independently of retained standard @1", () => {
  const current = structuredF002Profile(), old = standardF002Profile();
  assert.ok(current.ruleVersions.includes("json@2")); assert.ok(old.ruleVersions.includes("json@1")); assert.notEqual(current.id, old.id);
  assert.equal(current.extractionLimits.maxJsonDepth, 64); assert.equal(current.extractionLimits.maxJsonNodes, 20_000);
});

test("F002 JSON cannot round away source decimal digits or create an overlong pointer", () => {
  for (const text of ['{"x":1.00000000000000001}', '{"x":0.123456789012345678901}', JSON.stringify({ ["x".repeat(8200)]: 1 })]) {
    const result = compile(text); assert.equal(result.facts.length, 0); assert.ok(result.gaps.length > 0);
    normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
  }
  assert.deepEqual(value(compile('{"x":1e1}'), node(compile('{"x":1e1}'), "/x"), "literalValue"), { datatype: "integer", value: 10 });
});

test("F002 OpenAPI references through nested schema children cannot conceal a cycle", () => {
  const result = compile(JSON.stringify({ openapi: "3.0.3", components: { schemas: {
    A: { properties: { nested: { $ref: "#/components/schemas/B" } } }, B: { properties: { nested: { $ref: "#/components/schemas/A" } } } } }, paths: {} }));
  assert.equal(result.gaps.filter(gap => gap.code === "JSON_REFERENCE_CYCLE").length, 2);
  assert.equal(result.facts.some(fact => fact.predicate === "refersTo"), false);
});

test("F002 OpenAPI unsupported versions and malformed parameter response containers are explicit limitations", () => {
  for (const doc of [{ openapi: "2.0.0", paths: {} }, { openapi: "3.0.3", paths: [] },
    { openapi: "3.0.3", paths: { "/a": { get: { parameters: { bogus: { name: "id", in: "query" } }, responses: [{ description: "ok" }] } } } }]) {
    const result = compile(JSON.stringify(doc)); assert.ok(result.gaps.some(gap => /^OPENAPI_/.test(gap.code)));
    assert.equal(result.facts.some(fact => fact.predicate === "declaresParameter" || fact.predicate === "declaresResponse"), false);
  }
});

test("F002 OpenAPI ref objects do not invent an inline parameter name or a resolved schema expansion", () => {
  const doc = { openapi: "3.0.3", paths: { "/a": { get: { parameters: [{ $ref: "#/components/parameters/id" }], responses: { "200": { $ref: "#/components/responses/ok" } } } } },
    components: { parameters: { id: { name: "id", in: "query" } }, responses: { ok: { description: "ok" } } } };
  const result = compile(JSON.stringify(doc));
  assert.equal(result.gaps.length, 0);
  const parameter = node(result, "/paths/~1a/get/parameters/0"), target = node(result, "/components/parameters/id");
  assert.ok(relation(result, "refersTo", parameter, target));
  assert.equal(result.objects.some(object => object.anchor?.pointer === "/paths/~1a/get/parameters/0/name"), false);
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 OpenAPI operation parameters override matching path declarations without duplicate inheritance", () => {
  const result = compile(JSON.stringify({ openapi: "3.0.3", paths: { "/a": { parameters: [{ name: "id", in: "query", required: false }],
    get: { parameters: [{ name: "id", in: "query", required: true }] }, post: { parameters: [{ name: "id", in: "header" }] } } } }));
  const inherited = node(result, "/paths/~1a/parameters/0"), get = node(result, "/paths/~1a/get"), post = node(result, "/paths/~1a/post");
  assert.equal(relation(result, "declaresParameter", get, inherited), undefined, "overridden path declarations are not effective inherited operation parameters");
  assert.ok(relation(result, "declaresParameter", get, node(result, "/paths/~1a/get/parameters/0")));
  assert.equal(relation(result, "declaresParameter", post, inherited)?.basis, "DERIVED", "the same name at a different parameter location does not override");
});

test("F002 OpenAPI unresolved parameter identities cannot prove path inheritance", () => {
  const result = compile(JSON.stringify({ openapi: "3.0.3", paths: { "/a": { parameters: [{ name: "id", in: "query" }],
    get: { parameters: [{ $ref: "#/missing" }] } } } }));
  assert.equal(relation(result, "declaresParameter", node(result, "/paths/~1a/get"), node(result, "/paths/~1a/parameters/0")), undefined);
  assert.ok(result.gaps.some(gap => gap.code === "OPENAPI_PARAMETER_INHERITANCE_UNCONFIRMED"));
});

test("F002 version vocabulary includes parameter declarations only when that version actually uses them", () => {
  const versionProfile = { ...profile(), schemaVersion: 1 };
  const plain = compile('{"nested":{"port":8080,"empty":null},"safe":true}');
  const plainVocabulary = vocabularyFor({ profile: versionProfile, records: canonicalRecords(plain) });
  assert.deepEqual(plainVocabulary.predicates.map(item => item.predicate), ["contains", "literalValue", "name", "type"]);
  const declared = compile('{"openapi":"3.0.3","paths":{"/probe":{"get":{"parameters":[{"name":"id","in":"query"}]}}}}');
  const declaredVocabulary = vocabularyFor({ profile: versionProfile, records: canonicalRecords(declared) });
  assert.ok(declared.facts.some(fact => fact.predicate === "declaresParameter"));
  assert.ok(declaredVocabulary.predicates.some(item => item.predicate === "declaresParameter" && item.form === "RELATION"));
});
