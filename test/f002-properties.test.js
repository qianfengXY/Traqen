import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { F002RuleRegistry } from "../src/deterministic-facts/rules.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { canonicalDigest, createFactId } from "../src/deterministic-facts/identity.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = (version = "2", limits = {}) => ({ id: "c".repeat(64), version, schemaVersion: 1, ruleVersions: [`properties@${version}`], extractionLimits: limits });
function compile(text, { version = "2", limits = {}, entryPath = "app.properties" } = {}) {
  return compileDeterministicFacts({ workspaceId, bundleId, profile: profile(version, limits),
    ruleRegistry: new F002RuleRegistry({ ruleVersions: ["properties@1", "properties@2"] }),
    materials: [{ componentId: "a".repeat(64), pathBytes: Buffer.from(entryPath).toString("base64url"), mediaType: "application/octet-stream", bytes: Buffer.from(text) }] });
}
const key = (result, name) => { const keys = result.objects.filter(object => object.kind === "CONFIG_KEY" && object.name === name); assert.equal(keys.length, 1, name); return keys[0]; };
const value = (result, name) => result.facts.find(fact => fact.subjectId === key(result, name).objectId && fact.predicate === "literalValue")?.value;

test("F002 properties @1 retains its exact historical canonical output", () => {
  const result = compile("enabled=true\nempty=\npassword=not-indexed\n", { version: "1" });
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: canonicalRecords(result) }), "ce5d3ea92e6c672267f2dc5bd60638cc967bb865194dbf96bde9525b5e95e419");
});

test("F002 properties @2 preserves declaration strings empty values and direct material parents", () => {
  const result = compile("enabled=true\nport=8080\nempty=\nno_separator\n");
  for (const [name, declared] of [["enabled", "true"], ["port", "8080"], ["empty", ""], ["no_separator", ""]]) {
    const object = key(result, name); assert.deepEqual(value(result, name), { datatype: "string", value: declared });
    assert.equal(object.parentId, result.materials[0].rootObjectId);
    assert.ok(result.facts.some(fact => fact.predicate === "contains" && fact.targetId === object.objectId && fact.subjectId === object.parentId));
    assert.deepEqual(result.facts.find(fact => fact.subjectId === object.objectId && fact.predicate === "type")?.value, { datatype: "string", value: "string" });
  }
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 properties escaped separators whitespace and Unicode form the actual key and value", () => {
  const result = compile('escaped\\ key\\:\\==hello\\ world\\nline\\tend\nroot.\\u6e2f=\\u53e3\\uD83D\\uDE00\nunknown=\\z\\b\n');
  assert.deepEqual(value(result, "escaped key:="), { datatype: "string", value: "hello world\nline\tend" });
  assert.deepEqual(value(result, "root.港"), { datatype: "string", value: "口😀" });
  assert.deepEqual(value(result, "unknown"), { datatype: "string", value: "zb" });
});

test("F002 properties logical continuation and comment boundaries preserve exact source coordinates", () => {
  const text = '# ignored \\\r\n  title = 根😀\\\r\n \t后续\\\r\n  !literal\r\n';
  const result = compile(text), object = key(result, "title");
  assert.deepEqual(value(result, "title"), { datatype: "string", value: "根😀后续!literal" });
  assert.equal(object.anchor.lineStart, 2); assert.equal(object.anchor.columnStart, 3);
  const literal = result.facts.find(fact => fact.subjectId === object.objectId && fact.predicate === "literalValue");
  const evidence = result.evidence.find(item => literal.evidenceIds.includes(item.evidenceId));
  assert.equal(evidence.anchor.lineStart, 2); assert.equal(evidence.anchor.lineEnd, 4);
  assert.equal(Buffer.from(text).subarray(evidence.anchor.byteStart, evidence.anchor.byteEnd).toString(), '根😀\\\r\n \t后续\\\r\n  !literal');
});

test("F002 properties continuation in a key maps its decoded name to the original physical range", () => {
  const result = compile('long\\\r\n  key=value\r\n');
  const object = key(result, "longkey"); assert.equal(object.anchor.lineStart, 1); assert.equal(object.anchor.lineEnd, 2);
  assert.deepEqual(value(result, "longkey"), { datatype: "string", value: "value" });
});

test("F002 properties even slashes do not continue and inline hashes are literal value bytes", () => {
  const result = compile('slashes=path\\\\\nnext=a#b !c\n');
  assert.deepEqual(value(result, "slashes"), { datatype: "string", value: "path\\" });
  assert.deepEqual(value(result, "next"), { datatype: "string", value: "a#b !c" });
});

test("F002 properties duplicate decoded keys retain distinct declarations and a visible ambiguity", () => {
  const result = compile('same=first\nsa\\u006de=second\n');
  const keys = result.objects.filter(object => object.kind === "CONFIG_KEY" && object.name === "same");
  assert.equal(keys.length, 2); assert.notEqual(keys[0].objectId, keys[1].objectId);
  assert.ok(result.gaps.some(gap => gap.code === "CONFIG_DUPLICATE_KEY"));
  assert.deepEqual(result.facts.filter(fact => fact.predicate === "literalValue").map(fact => fact.value.value).sort(), ["first", "second"]);
});

test("F002 properties malformed escapes and incomplete continuation never publish partial successful declarations", () => {
  for (const text of ['good=ok\nbad=\\u00GG\n', 'good=ok\nbad=\\ud800\n', 'good=ok\nbad=value\\']) {
    const result = compile(text); assert.equal(result.facts.length, 0); assert.equal(result.objects.length, 1);
    assert.ok(result.gaps.length > 0); assert.ok(result.gaps[0].anchor);
  }
});

test("F002 properties decode a sensitive key before indexing and retire all its value fragments", () => {
  const result = compile('pass\\\r\n  word=FIRST_SENTINEL\\\r\n  SECOND_SENTINEL\r\napi\\u005fkey=THIRD_SENTINEL\nsafe=yes\n');
  const records = JSON.stringify(canonicalRecords(result));
  for (const token of ["FIRST_SENTINEL", "SECOND_SENTINEL", "THIRD_SENTINEL", '"password"', '"api_key"']) assert.equal(records.includes(token), false);
  assert.equal(result.gaps.filter(gap => gap.code === "CONFIG_SENSITIVE_DECLARATION_RESTRICTED").length, 2);
  assert.deepEqual(value(result, "safe"), { datatype: "string", value: "yes" });
});

test("F002 properties fixed declaration and logical-byte limits reject the whole extraction without truncation", () => {
  for (const [text, limits] of [['a=1\nb=2\n', { maxConfigEntries: 1 }], ['long=123456789\n', { maxConfigLineBytes: 8 }]]) {
    const result = compile(text, { limits }); assert.equal(result.facts.length, 0);
    assert.ok(result.gaps.some(gap => gap.code === "CONFIG_STRUCTURE_LIMIT"));
  }
});

test("F002 properties interpolation remains a declared string and never becomes an evaluated environment value", () => {
  assert.deepEqual(value(compile('port=${PORT:8080}\ncommand=$(touch NEVER_RUN)\n'), "port"), { datatype: "string", value: "${PORT:8080}" });
  assert.deepEqual(value(compile('command=$(touch NEVER_RUN)\n'), "command"), { datatype: "string", value: "$(touch NEVER_RUN)" });
});

test("F002 properties rule does not misinterpret dotenv quoting or export syntax as Java properties", () => {
  const result = compile('export PORT="8080"\n', { entryPath: "settings.env" });
  assert.equal(result.facts.length, 0); assert.ok(result.gaps.some(gap => gap.code === "DOTENV_DECLARATIONS_NOT_CONFIGURED"));
});

test("F002 properties @2 is separately versioned and fixed limits do not alter standard @1", () => {
  const old = standardF002Profile(), current = structuredF002Profile();
  assert.ok(old.ruleVersions.includes("properties@1")); assert.ok(current.ruleVersions.includes("properties@2"));
  assert.notEqual(current.id, old.id); assert.equal(current.extractionLimits.maxConfigEntries, 20_000); assert.equal(current.extractionLimits.maxConfigLineBytes, 65_536);
});

test("F002 properties publication rejects a numeric or boolean runtime interpretation of the declared string", () => {
  const records = canonicalRecords(compile('enabled=true\n'));
  for (const typedValue of [{ datatype: "boolean", value: true }, { datatype: "integer", value: 1 }]) {
    const changed = records.map(record => {
      if (record.kind !== "FACT" || record.payload.predicate !== "literalValue") return record;
      const payload = { ...record.payload, value: typedValue };
      const id = createFactId({ subjectId: payload.subjectId, predicate: payload.predicate, typedValue, basis: payload.basis,
        evidenceIds: payload.evidenceIds, ruleRef: payload.ruleRef, premiseFactIds: payload.premiseFactIds });
      return { ...record, id, payload: { ...payload, factId: id } };
    });
    assert.throws(() => normalizeCanonicalRecords(changed, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_VOCABULARY_INVALID" });
  }
});
