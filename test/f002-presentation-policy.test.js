import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "../src/deterministic-facts/policy.js";
const { CURRENT_DISPLAY_POLICY_REVISION, redactDisplayBytes } = policy;

const present = (source, format = "YAML") => redactDisplayBytes(Buffer.from(source), { format });
const refused = result => {
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
};

test("format-aware current presentation has a distinct auditable policy revision", () => {
  assert.equal(CURRENT_DISPLAY_POLICY_REVISION, "policy-v3-format-aware");
});

test("known presentation formats use the exact admitted filename bytes, including opaque parents", () => {
  assert.equal(typeof policy.displayFormatForPathBytes, "function");
  for (const [name, expected] of [["config.YAML", "YAML"], ["config.yml", "YAML"], ["config.JSON", "JSON"],
    ["application.properties", "PROPERTIES"], [".env.production", "DOTENV"], ["config.yaml.js", null]]) {
    assert.equal(policy.displayFormatForPathBytes(Buffer.from(name)), expected);
    assert.equal(policy.displayFormatForPathBytes(Buffer.from([0xff, 47, ...Buffer.from(name)])), expected);
  }
});

test("YAML scalar data never falls through into the properties grammar", () => {
  for (const text of ["password=SYNTHETIC_ROLE_SECRET\n", "'password: example'\n", "|\n  password=example\n"]) {
    const result = present(text);
    assert.equal(result.redacted, false);
    assert.deepEqual(result.bytes, Buffer.from(text));
  }
});

test("an explicitly unselected material grammar keeps ordinary document bytes inert", () => {
  const text = "# Heading\n\nA paragraph: without configuration.\n\n```yaml\npassword=example\n```\n";
  const result = redactDisplayBytes(Buffer.from(text), { format: null });
  assert.equal(result.redacted, false);
  assert.deepEqual(result.bytes, Buffer.from(text));
});

for (const [label, source] of [
  ["alias", "public: &data SYNTHETIC_ROLE_SECRET\npassword: *data\n"],
  ["cyclic alias", "root: &root {child: *root}\n"],
  ["unknown tag", "value: !external SYNTHETIC_ROLE_SECRET\n"],
  ["composite key", "? [password]\n: SYNTHETIC_ROLE_SECRET\n"],
  ["duplicate key", "password: first\npassword: SYNTHETIC_ROLE_SECRET\n"],
  ["malformed collection", "data: [SYNTHETIC_ROLE_SECRET\n"],
  ["broken encoding", Buffer.from([0xff, ...Buffer.from("password: SYNTHETIC_ROLE_SECRET")])],
]) test(`format-aware YAML refuses ${label} without presenting unconfirmed bytes`, () => refused(present(source)));

test("YAML redaction preserves physical CRLF lines and unrelated Unicode sibling bytes", () => {
  const text = "name: 订单😀\r\npassword: |\r\n  SYNTHETIC_ROLE_SECRET\r\n  second line\r\nnext: 保留\r\n";
  const original = Buffer.from(text), result = redactDisplayBytes(original, { format: "YAML" });
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
  assert.equal(result.bytes.includes("second line"), false);
  assert.equal(result.bytes.toString().split("\r\n").length, text.split("\r\n").length);
  assert.ok(result.bytes.includes("name: 订单😀\r\n")); assert.ok(result.bytes.includes("next: 保留\r\n"));
  assert.deepEqual(original, Buffer.from(text));
});

test("nested flow values are entirely masked without touching the following mapping", () => {
  const result = present("settings: {password: {one: SYNTHETIC_ROLE_SECRET, two: [private]}, name: orders}\n");
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false); assert.equal(result.bytes.includes("private"), false);
  assert.ok(result.bytes.includes("name: orders"));
});

test("explicit YAML selection rejects malformed JSON-looking YAML without trying properties", () => {
  refused(present('{"password": "SYNTHETIC_ROLE_SECRET"', "YAML"));
});

test("JSON format refuses invalid JSON rather than silently accepting another grammar", () => {
  refused(present("password: SYNTHETIC_ROLE_SECRET\n", "JSON"));
});

test("JSON display masks exact value ranges and retains physical line references", () => {
  const text = '{\r\n  "password": "SYNTHETIC_ROLE_SECRET",\r\n  "name": "orders"\r\n}\r\n';
  const result = present(text, "JSON");
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
  assert.equal(result.bytes.toString().split("\r\n").length, text.split("\r\n").length);
  assert.equal(JSON.parse(result.bytes.toString()).name, "orders");
});

test("properties format does not interpret values or comments as YAML nodes", () => {
  const text = "# unmatched '\r\npassword: SYNTHETIC_ROLE_SECRET\r\nname=orders\r\n";
  const result = present(text, "PROPERTIES");
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false); assert.ok(result.bytes.includes("name=orders\r\n"));
});

test("known properties encoding failure is refused while opaque unknown binary remains unchanged", () => {
  const bytes = Buffer.from([0xff, 0, 1]);
  refused(redactDisplayBytes(bytes, { format: "PROPERTIES" }));
  assert.deepEqual(redactDisplayBytes(bytes).bytes, bytes);
});

test("YAML depth is bounded before recursive semantic composition", () => {
  refused(present("[".repeat(65) + "SYNTHETIC_ROLE_SECRET" + "]".repeat(65)));
});

test("YAML source size and concrete syntax work are bounded", () => {
  refused(present("a".repeat(8 * 1024 * 1024 + 1)));
  refused(present("- item\n".repeat(30_000)));
});

test("YAML prototype-like keys are treated as inert nodes, not constructed objects", () => {
  const result = present("__proto__: {password: SYNTHETIC_ROLE_SECRET}\nname: orders\n");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
  assert.equal(Object.prototype.password, undefined);
});
