import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";

const componentId = "a".repeat(64);
const bundleId = "b".repeat(64);
const workspaceId = "workspace";

function material(path, content, mediaType = "text/plain") {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return { componentId, pathBytes: Buffer.from(path, "utf8").toString("base64url"), mediaType, bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex") };
}

function compile(materials) {
  return compileDeterministicFacts({ workspaceId, bundleId, profile: { id: "c".repeat(64), version: "1" }, materials });
}

const names = (result) => result.objects.map((object) => object.name);
const relations = (result, predicate) => result.facts.filter((fact) => fact.kind === "RELATION" && fact.predicate === predicate);

test("F002 extracts only lexically proven JavaScript declarations, static calls, and Express routes", () => {
  const result = compile([material("src/orders.js", `import express from "express";\nconst router = express.Router();\nexport function save() { return 1; }\nexport function cancel() { return save(); }\nfunction shadow(save) { return save(); }\nrouter.post("/orders", cancel);\n`)]);

  assert.deepEqual(names(result).filter((name) => ["save", "cancel", "shadow", "POST /orders"].includes(name)).sort(), ["POST /orders", "cancel", "save", "shadow"]);
  const calls = relations(result, "staticCalls");
  assert.equal(calls.length, 1, "a parameter-shadowed call must not become a static relationship");
  assert.equal(result.objects.find((object) => object.objectId === calls[0].subjectId).name, "cancel");
  assert.equal(result.objects.find((object) => object.objectId === calls[0].targetId).name, "save");
  const route = relations(result, "handlesRoute")[0];
  assert.equal(result.objects.find((object) => object.objectId === route.subjectId).name, "cancel");
  assert.equal(result.objects.find((object) => object.objectId === route.targetId).name, "POST /orders");
  assert.equal(result.gaps.length, 0);
});

test("F002 resolves an explicit same-component JavaScript import but never a lookalike cross-component symbol", () => {
  const otherComponent = "e".repeat(64);
  const source = material("src/use.js", "import { helper } from './helper.js';\nexport function use() { return helper(); }\n");
  const helper = material("src/helper.js", "export function helper() { return true; }\n");
  const unrelated = { ...material("src/helper.js", "export function helper() { return false; }\n"), componentId: otherComponent };
  const result = compile([source, helper, unrelated]);
  const call = relations(result, "staticCalls").find((fact) => result.objects.find((object) => object.objectId === fact.subjectId)?.name === "use");
  assert.ok(call);
  assert.equal(result.objects.find((object) => object.objectId === call.targetId).materialId, result.materials.find((item) => Buffer.from(item.pathBytes, "base64url").toString("utf8") === "src/helper.js" && item.componentId === componentId).materialId);
});

test("F002 extracts explicit document, JSON/OpenAPI, config, and image evidence without inventing semantics", () => {
  const png = Buffer.alloc(24);
  png.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  png.writeUInt32BE(2, 16); png.writeUInt32BE(3, 20);
  const result = compile([
    material("docs/readme.md", "# Orders\r\n\r\n[Config](../config/app.properties)\r\n```md\n# not a heading\n```\r\n", "text/markdown"),
    material("config/app.properties", "orders.enabled=true\norders.secret=not-indexed\n"),
    material("config/app.yaml", "server:\n  port: 8080\nshared: &defaults\n", "application/yaml"),
    material("api/openapi.json", JSON.stringify({ openapi: "3.0.0", paths: { "/orders": { get: { operationId: "listOrders", responses: { 200: { description: "ok" } } } } } }), "application/json"),
    material("images/order.png", png, "image/png"),
  ]);

  assert.ok(names(result).includes("Orders"));
  assert.equal(names(result).filter((name) => name === "not a heading").length, 0, "code fences do not create document headings");
  assert.ok(names(result).includes("GET /orders"));
  assert.ok(names(result).includes("orders.enabled"));
  assert.ok(names(result).includes("server.port"));
  assert.equal(JSON.stringify(result).includes("not-indexed"), false, "secret configuration values cannot become facts or evidence metadata");
  assert.ok(result.evidence.some((item) => item.anchor.kind === "IMAGE" && item.anchor.width === 2 && item.anchor.height === 3));
  assert.equal(relations(result, "refersTo").length, 1, "a same-component explicit relative link is the only document cross-material relation");
  assert.ok(result.facts.some((fact) => fact.predicate === "declaresResponse"));
  assert.ok(result.gaps.some((gap) => gap.code === "YAML_COMPLEX_STRUCTURE_UNSUPPORTED"));
});

test("F002 extracts Spring MVC declarations from an AST and keeps unresolved invocations as limitations", () => {
  const result = compile([material("src/OrdersController.java", `package sample;\nimport org.springframework.web.bind.annotation.*;\n@RestController\n@RequestMapping("/orders")\nclass OrdersController {\n  @GetMapping("/{id}")\n  public Order get(String id) { return service.find(id); }\n}\n`)]);
  assert.ok(names(result).includes("OrdersController"));
  assert.ok(names(result).includes("OrdersController#get"));
  assert.ok(names(result).includes("GET /orders/{id}"));
  assert.equal(relations(result, "handlesRoute").length, 1);
  assert.ok(result.gaps.some((gap) => gap.code === "JAVA_INVOCATION_UNRESOLVED"));
});

test("F002 treats malformed or unsupported content as explicit limitations, never as a successful empty extraction", () => {
  const result = compile([
    material("src/bad.js", "export function {"),
    material("docs/diagram.svg", "<svg><script>alert(1)</script></svg>", "image/svg+xml"),
  ]);
  assert.ok(result.gaps.some((gap) => gap.code === "JAVASCRIPT_PARSE_FAILED"));
  assert.ok(result.gaps.some((gap) => gap.code === "FORMAT_UNSUPPORTED"));
  assert.equal(result.facts.length, 0);
});

test("F002 records framework-bound tests and report declarations without claiming they executed", () => {
  const result = compile([
    material("test/orders.test.js", "import test from 'node:test';\ntest('submits order', () => {});\n"),
    material("reports/results.json", JSON.stringify({ tests: [{ name: "submits order", status: "PASS" }] }), "application/json"),
    material("reports/junit.xml", "<testsuite><testcase name='cancels order'><failure/></testcase></testsuite>", "application/xml"),
  ]);
  assert.ok(names(result).includes("submits order"));
  assert.ok(names(result).includes("cancels order"));
  const reports = result.facts.filter((fact) => fact.predicate === "reportsResult");
  assert.deepEqual(reports.map((fact) => fact.value.value).sort(), ["FAIL", "PASS"]);
  assert.equal(result.facts.some((fact) => fact.predicate === "verifiedExecution"), false);
});

test("F002 rejects extraction from a material whose actual bytes do not match the frozen Inventory digest", () => {
  const source = material("src/orders.js", "export function orders() {};");
  const result = compileDeterministicFacts({ workspaceId, bundleId, profile: { id: "c".repeat(64), version: "1" }, materials: [{ ...source, contentDigest: "d".repeat(64) }] });
  assert.deepEqual(result.facts, []);
  assert.ok(result.gaps.some((gap) => gap.code === "CONTENT_DIGEST_MISMATCH"));
});

test("F002 refuses a profile that names an unavailable rule version", () => {
  assert.throws(() => compileDeterministicFacts({ workspaceId, bundleId, profile: {
    id: "c".repeat(64), version: "999", ruleVersions: ["javascript@999"],
  }, materials: [material("src/orders.js", "export function orders() {};", "text/javascript")] }), { code: "RULE_VERSION_UNAVAILABLE" });
});

test("F002 converts JavaScript UTF-16 parser offsets into UTF-8 byte anchors across CRLF and emoji", () => {
  const source = "const 名称 = '😀';\r\nexport function go() { return 名称; }\r\n";
  const result = compile([material("src/unicode.js", source)]);
  const go = result.objects.find((object) => object.name === "go");
  assert.equal(go.anchor.byteStart, Buffer.byteLength(source.slice(0, source.indexOf("function go")), "utf8"));
  assert.equal(go.anchor.lineStart, 2);
  assert.equal(go.anchor.columnStart, 8);
  assert.equal(go.anchor.byteEnd, Buffer.byteLength(source.slice(0, source.indexOf("}\r\n") + 1), "utf8"));
});

test("F002 never turns lexical shadows or lookalike routers into proven JavaScript relations", () => {
  const result = compile([material("src/shadows.js", `import express from "express";
function target() {}
function localShadow() { const target = () => {}; return target(); }
const parameterShadow = (target) => target();
const fake = { Router() { return { get() {} }; } };
const router = fake.Router();
function handler() {}
router.get("/not-http", handler);
const real = express.Router();
real.get("/real", handler);
`)]);
  assert.equal(relations(result, "staticCalls").length, 0, "local and parameter bindings must not resolve to a global declaration");
  assert.equal(names(result).includes("GET /not-http"), false, "a lookalike Router() is not an Express router");
  assert.equal(names(result).includes("GET /real"), true, "a source-bound Express router remains supported");
});

test("F002 records non-literal Spring mappings as limitations rather than root routes", () => {
  const result = compile([material("src/OrdersController.java", `import org.springframework.web.bind.annotation.*;
@RestController
class OrdersController {
  @GetMapping(PATH)
  public String get() { return "ok"; }
  @GetMapping
  public String defaultPath() { return "ok"; }
}
`)]);
  assert.equal(names(result).includes("GET /"), true, "a truly absent mapping value still has Spring's root default");
  assert.equal(names(result).filter((name) => name === "GET /").length, 1,
    "an unresolved mapping expression must not become a second root route");
  assert.ok(result.gaps.some((gap) => gap.code === "SPRING_MAPPING_UNRESOLVED"));
});

test("F002 keeps OpenAPI operations distinct for different methods at one path", () => {
  const result = compile([material("api/openapi.json", JSON.stringify({ openapi: "3.0.0", paths: { "/orders": {
    get: { responses: { 200: { description: "ok" } } },
    post: { responses: { 201: { description: "created" } } },
  } } }), "application/json")]);
  assert.deepEqual(names(result).filter((name) => / \/orders$/.test(name)).sort(), ["GET /orders", "POST /orders"]);
  const operations = result.objects.filter((object) => ["GET /orders", "POST /orders"].includes(object.name));
  assert.notEqual(operations[0].objectId, operations[1].objectId);
});
