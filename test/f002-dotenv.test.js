import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { redactDisplayBytes } from "../src/deterministic-facts/policy.js";
import { F002MaterialService } from "../src/deterministic-facts/material-service.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["properties@2"],
  extractionLimits: { dotenvSyntax: "node-static-v1", ...limits } });
function compile(text, { entryPath = ".env", limits = {} } = {}) {
  return compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials: [{ componentId: "a".repeat(64),
    pathBytes: Buffer.from(entryPath).toString("base64url"), mediaType: "application/octet-stream", bytes: Buffer.from(text) }] });
}
const object = (result, name) => { const matches = result.objects.filter(item => item.kind === "CONFIG_KEY" && item.name === name); assert.equal(matches.length, 1, name); return matches[0]; };
const value = (result, name) => result.facts.find(fact => fact.subjectId === object(result, name).objectId && fact.predicate === "literalValue")?.value;

test("F002 dotenv is a fixed opt-in dialect while historical standard profiles remain unchanged", () => {
  assert.equal(standardF002Profile().extractionLimits.dotenvSyntax, undefined);
  assert.equal(structuredF002Profile().extractionLimits.dotenvSyntax, "node-static-v1");
});

test("F002 dotenv recognizes admitted .env variants and preserves quoted numeric boolean and empty strings", () => {
  for (const entryPath of [".env", "config/.env.dev", "settings.env"]) {
    const result = compile('export PORT = "8080"\nENABLED=true\nEMPTY=\n', { entryPath });
    assert.equal(result.materials[0].kind, "PROPERTIES");
    for (const [name, raw] of [["PORT", "8080"], ["ENABLED", "true"], ["EMPTY", ""]]) assert.deepEqual(value(result, name), { datatype: "string", value: raw });
    normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
  }
});

test("F002 dotenv quoted hashes spacing multiline CRLF and Unicode map to actual source ranges", () => {
  const text = '# comment\r\n  export TITLE = "根😀\r\n 第二行 # 文字" # trailing\r\nPLAIN = one # comment\r\n';
  const result = compile(text); assert.deepEqual(value(result, "TITLE"), { datatype: "string", value: "根😀\r\n 第二行 # 文字" });
  assert.deepEqual(value(result, "PLAIN"), { datatype: "string", value: "one" });
  const key = object(result, "TITLE"); assert.equal(key.anchor.lineStart, 2); assert.equal(key.anchor.columnStart, 10);
  const literal = result.facts.find(fact => fact.subjectId === key.objectId && fact.predicate === "literalValue");
  const evidence = result.evidence.find(item => literal.evidenceIds.includes(item.evidenceId));
  assert.equal(evidence.anchor.lineStart, 2); assert.equal(evidence.anchor.lineEnd, 3);
  assert.equal(Buffer.from(text).subarray(evidence.anchor.byteStart, evidence.anchor.byteEnd).toString(), '"根😀\r\n 第二行 # 文字"');
});

test("F002 dotenv keeps single-quoted and unquoted backslashes distinct from double-quoted newline syntax", () => {
  const result = compile('SINGLE=\'one\\ntwo\'\nPLAIN=one\\ntwo\nDOUBLE="one\\ntwo"\n');
  assert.deepEqual(value(result, "SINGLE"), { datatype: "string", value: "one\\ntwo" });
  assert.deepEqual(value(result, "PLAIN"), { datatype: "string", value: "one\\ntwo" });
  assert.deepEqual(value(result, "DOUBLE"), { datatype: "string", value: "one\ntwo" });
});

test("F002 dotenv duplicate declarations remain distinct with visible ambiguity and no winning runtime value", () => {
  const result = compile('PORT=first\nPORT=second\n');
  assert.equal(result.objects.filter(item => item.kind === "CONFIG_KEY" && item.name === "PORT").length, 2);
  assert.ok(result.gaps.some(gap => gap.code === "CONFIG_DUPLICATE_KEY"));
  assert.deepEqual(result.facts.filter(fact => fact.predicate === "literalValue").map(fact => fact.value.value).sort(), ["first", "second"]);
});

test("F002 dotenv malformed names unclosed quotes and trailing tokens never publish partial declarations", () => {
  for (const text of ['GOOD=ok\n1_BAD=value\n', 'GOOD=ok\nTITLE="missing\n', 'GOOD=ok\nTITLE="ok" trailing\n', 'GOOD=ok\nTITLE=`unsupported`\n']) {
    const result = compile(text); assert.equal(result.facts.length, 0); assert.equal(result.objects.length, 1); assert.ok(result.gaps.length > 0);
  }
});

test("F002 dotenv does not execute interpolation or command substitution and records its unresolved runtime meaning", () => {
  const result = compile('PORT=${BASE}\nCOMMAND=$(touch NEVER_EXECUTED)\n');
  assert.deepEqual(value(result, "PORT"), { datatype: "string", value: "${BASE}" });
  assert.deepEqual(value(result, "COMMAND"), { datatype: "string", value: "$(touch NEVER_EXECUTED)" });
  assert.equal(result.gaps.filter(gap => gap.code === "CONFIG_RUNTIME_INTERPOLATION_UNRESOLVED").length, 2);
});

test("F002 dotenv sensitive export keys retire multiline quoted values from objects facts and evidence metadata", () => {
  const result = compile('export API_TOKEN="FIRST_SENTINEL\nSECOND_SENTINEL # inner"\nSAFE=visible\n');
  const serialized = JSON.stringify(canonicalRecords(result));
  for (const marker of ["FIRST_SENTINEL", "SECOND_SENTINEL", "API_TOKEN"]) assert.equal(serialized.includes(marker), false);
  assert.ok(result.gaps.some(gap => gap.code === "CONFIG_SENSITIVE_DECLARATION_RESTRICTED"));
  assert.deepEqual(value(result, "SAFE"), { datatype: "string", value: "visible" });
});

test("F002 dotenv fixed entry and logical-byte budgets reject the full extraction rather than truncating", () => {
  for (const [text, limits] of [['A=1\nB=2\n', { maxConfigEntries: 1 }], ['TITLE="very long value"\n', { maxConfigLineBytes: 8 }]]) {
    const result = compile(text, { limits }); assert.equal(result.facts.length, 0);
    assert.ok(result.gaps.some(gap => gap.code === "CONFIG_STRUCTURE_LIMIT"));
  }
});

test("F002 dotenv presentation redacts exported multiline secrets without changing safe lines or CRLF layout", () => {
  const text = 'SAFE="visible # text"\r\nexport API_TOKEN="FIRST_SENTINEL\r\nSECOND_SENTINEL" # comment\r\nPORT=8080\r\n';
  const display = redactDisplayBytes(Buffer.from(text), { format: "DOTENV" });
  assert.equal(display.redacted, true); assert.equal(display.transform, "CONFIG_SECRET_VALUE_REDACTION");
  const output = display.bytes.toString();
  for (const marker of ["FIRST_SENTINEL", "SECOND_SENTINEL"]) assert.equal(output.includes(marker), false);
  assert.ok(output.startsWith('SAFE="visible # text"\r\n')); assert.ok(output.endsWith('PORT=8080\r\n'));
  assert.equal(output.split("\r\n").length, text.split("\r\n").length);
});

test("F002 dotenv presentation refuses unparseable or non-UTF8 sensitive material without leaking fragments", () => {
  for (const bytes of [Buffer.from('export API_TOKEN="FIRST_SENTINEL\n'), Buffer.from([0xff, ...Buffer.from('API_TOKEN=FIRST_SENTINEL')])]) {
    const display = redactDisplayBytes(bytes, { format: "DOTENV" });
    assert.equal(display.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL"); assert.equal(display.bytes.includes(Buffer.from("FIRST_SENTINEL")), false);
  }
});

test("F002 dotenv benign text retains every original byte and never receives unrelated YAML or properties rewrites", () => {
  const bytes = Buffer.from('TITLE="http://example.invalid:8080 # text"\nexport PORT=8080\n');
  const display = redactDisplayBytes(bytes, { format: "DOTENV" }); assert.deepEqual(display.bytes, bytes); assert.equal(display.redacted, false);
});

test("F002 historical properties profiles without a dotenv dialect never acquire new declarations", () => {
  const oldProfile = profile(); delete oldProfile.extractionLimits.dotenvSyntax;
  for (const entryPath of [".env", "settings.env"]) {
    const result = compileDeterministicFacts({ workspaceId, bundleId, profile: oldProfile, materials: [{ componentId: "a".repeat(64),
      pathBytes: Buffer.from(entryPath).toString("base64url"), mediaType: "application/octet-stream", bytes: Buffer.from("PORT=8080\n") }] });
    assert.equal(result.facts.length, 0);
    assert.equal(result.materials[0].kind, entryPath === ".env" ? "UNSUPPORTED" : "PROPERTIES");
    assert.ok(result.gaps.some(gap => gap.code === (entryPath === ".env" ? "FORMAT_UNSUPPORTED" : "DOTENV_DECLARATIONS_NOT_CONFIGURED")));
  }
});

test("F002 controlled dotenv reads select syntax from canonical path bytes and audit current display policy independently of old extraction", async () => {
  const materialId = "d".repeat(64), graphVersionId = "e".repeat(64), events = [];
  const bytes = Buffer.from('export API_TOKEN="FIRST_SENTINEL\r\nSECOND_SENTINEL"\r\nPORT=8080\r\n');
  const repository = { withAuthorizedWorkspace: async (_actor, _workspace, action) => action({ query: async () => ({ rows: [{ run_id: "run", scope_id: "scope",
    payload: { materialId, componentId: "a".repeat(64), pathBytes: Buffer.from(".env.prod").toString("base64url"), displayPath: "misleading.properties", mediaType: "application/octet-stream" } }] }) }),
    appendEvent: async (_actor, _workspace, _run, _scope, kind, payload) => { events.push({ kind, payload }); } };
  const admission = { readFile: async function* () { yield bytes; } };
  const result = await new F002MaterialService(repository, admission).read({ actorId: "owner" }, workspaceId, graphVersionId, materialId);
  assert.equal(result.policyRevision, "policy-v3-format-aware"); assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("FIRST_SENTINEL"), false); assert.equal(result.bytes.includes("SECOND_SENTINEL"), false);
  assert.ok(result.bytes.includes("PORT=8080")); assert.ok(bytes.includes("FIRST_SENTINEL"));
  assert.deepEqual(events.map(event => event.kind), ["READ_INTENT", "READ_COMPLETED"]);
  assert.ok(events.every(event => event.payload.policyRevision === result.policyRevision));
  assert.equal(JSON.stringify(events).includes("FIRST_SENTINEL"), false);
});

test("F002 dotenv safety recognizes an ASCII filename even under a non-UTF8 admitted parent path", async () => {
  const materialId = "d".repeat(64), bytes = Buffer.from('export API_TOKEN="FIRST_SENTINEL\nSECOND_SENTINEL"\n');
  const rawPath = Buffer.from([0xff, 47, ...Buffer.from(".env.prod")]);
  const repository = { withAuthorizedWorkspace: async (_actor, _workspace, action) => action({ query: async () => ({ rows: [{ run_id: "run", scope_id: "scope",
    payload: { materialId, componentId: "a".repeat(64), pathBytes: rawPath.toString("base64url"), mediaType: "application/octet-stream" } }] }) }), appendEvent: async () => {} };
  const result = await new F002MaterialService(repository, { readFile: async function* () { yield bytes; } }).read({ actorId: "owner" }, workspaceId, "e".repeat(64), materialId);
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("FIRST_SENTINEL"), false); assert.equal(result.bytes.includes("SECOND_SENTINEL"), false);
});
