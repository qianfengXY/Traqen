import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { redactDisplayBytes } from "../src/deterministic-facts/policy.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { createFactId } from "../src/deterministic-facts/identity.js";

const workspaceId = "workspace", bundleId = "b".repeat(64), profile = structuredF002Profile();
const compile = (name, text) => compileDeterministicFacts({ workspaceId, bundleId, profile, materials: [{
  componentId: "a".repeat(64), pathBytes: Buffer.from(name).toString("base64url"), bytes: Buffer.from(text), mediaType: "text/plain",
}] });
const sentinel = "SYNTHETIC_PRIVATE_MATERIAL_20261021";
const pem = `-----BEGIN RSA PRIVATE KEY-----\n${sentinel}\n-----END RSA PRIVATE KEY-----`;

for (const key of ["private_key", "privateKey", "PRIVATEKEY", "signing.private-key", "passphrase", "credentials", "credential", "AWS_ACCESS_KEY_ID", "accessKey", "clientSecret", "apiKey", "authToken", "DBPASSWORD", "password1", "MYSECRET", "APITOKEN", "MYAPIKEY"]) {
  test(`F002 ${key} never becomes an indexed declaration or a displayed secret`, () => {
    for (const [name, format, source] of [
      ["app.properties", "PROPERTIES", `${key}=${sentinel}\nsafe=retained\n`],
      [".env", "DOTENV", `${key.replaceAll(/[.-]/g, "_")}=${sentinel}\nSAFE=retained\n`],
      ["app.json", "JSON", JSON.stringify({ [key]: { child: sentinel }, safe: "retained" })],
      ["app.yaml", "YAML", `${key}: ${sentinel}\nsafe: retained\n`],
    ]) {
      const serialized = JSON.stringify(canonicalRecords(compile(name, source)));
      assert.equal(serialized.includes(sentinel), false, `${name} indexed a secret`);
      const display = redactDisplayBytes(Buffer.from(source), { format });
      assert.equal(display.bytes.includes(sentinel), false, `${name} displayed a secret`);
      assert.ok(display.bytes.includes("retained"), "unrelated sibling must remain usable");
    }
  });
}

test("F002 PEM values are restricted even under innocent keys, escaped JSON, code and ordinary documents", () => {
  for (const [name, format, source] of [
    ["app.properties", "PROPERTIES", `certificate=${pem.replaceAll("\n", "\\n")}\n`],
    ["app.json", "JSON", JSON.stringify({ certificate: pem }).replaceAll("-", "\\u002d")],
    [".env", "DOTENV", `CERTIFICATE="${pem}"\n`],
    ["app.yaml", "YAML", `certificate: |\n  ${pem.replaceAll("\n", "\n  ")}\n`],
    ["key.md", null, `# Key\n\n${pem}\n`],
    ["key.js", null, `export const certificate = ${JSON.stringify(pem)};\n`],
  ]) {
    assert.equal(JSON.stringify(canonicalRecords(compile(name, source))).includes(sentinel), false, name);
    const display = redactDisplayBytes(Buffer.from(source), { format });
    assert.equal(display.bytes.includes(sentinel), false, name);
    assert.equal(display.redacted, true, name);
  }
});

test("F002 harmless tokens and tokenizer remain extractable and readable", () => {
  const source = "tokens=128\ntokenizer=cl100k_base\nmaxTokens=256\n";
  const result = compile("app.properties", source);
  assert.deepEqual(result.objects.filter(o => o.kind === "CONFIG_KEY").map(o => o.name).sort(), ["maxTokens", "tokenizer", "tokens"]);
  assert.deepEqual(redactDisplayBytes(Buffer.from(source), { format: "PROPERTIES" }).bytes, Buffer.from(source));
});

test("F002 private key markers do not pass through opaque invalid UTF8 display bytes", () => {
  const bytes = Buffer.concat([Buffer.from([0xff]), Buffer.from(pem)]);
  const display = redactDisplayBytes(bytes, { format: null });
  assert.equal(display.bytes.includes(sentinel), false);
  assert.equal(display.redacted, true);
});

test("F002 publication independently refuses PEM payloads even if a parser is bypassed", () => {
  const records = canonicalRecords(compile("app.properties", "safe=retained\n"));
  const injected = records.map(record => {
    if (record.kind !== "FACT" || record.payload.predicate !== "literalValue") return record;
    const payload = { ...record.payload, value: { datatype: "string", value: pem } };
    payload.factId = createFactId({ ...payload, typedValue: payload.value });
    return { kind: "FACT", id: payload.factId, payload };
  });
  assert.throws(() => normalizeCanonicalRecords(injected, { workspaceId, bundleId, profile }), { code: "F002_RECORD_SENSITIVE" });
});

test("F002 sensitive publication checks retain the invalid-payload schema boundary", () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => normalizeCanonicalRecords([{ kind: "FACT", id: "f".repeat(64), payload: cyclic }], { workspaceId, bundleId }), { code: "F002_RECORD_SCHEMA_INVALID" });
});
