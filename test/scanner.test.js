import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JavaScriptProjectScanner } from "../src/scanner/index.js";

const fixedClock = () => new Date("2026-07-14T08:30:00.000Z");

async function fixtureProject() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "traqen-scanner-"));
  await Promise.all([
    mkdir(path.join(rootPath, "contracts")),
    mkdir(path.join(rootPath, "db")),
    mkdir(path.join(rootPath, "src")),
    mkdir(path.join(rootPath, "test")),
  ]);
  await Promise.all([
    writeFile(path.join(rootPath, "package.json"), JSON.stringify({
      name: "orders-service",
      version: "1.2.3",
      scripts: { test: "node --test" },
      dependencies: { express: "5.1.0" },
    })),
    writeFile(path.join(rootPath, ".env.example"), "DATABASE_URL=postgres://example\nFEATURE_ORDERS=true\n"),
    writeFile(path.join(rootPath, "contracts", "openapi.json"), JSON.stringify({
      openapi: "3.1.0",
      paths: { "/orders/{id}": { get: { operationId: "getOrder" } } },
    })),
    writeFile(path.join(rootPath, "db", "001_orders.sql"), [
      "CREATE TABLE orders (",
      "  id uuid PRIMARY KEY,",
      "  status text NOT NULL",
      ");",
    ].join("\n")),
    writeFile(path.join(rootPath, "src", "server.js"), [
      'import express from "express";',
      "const app = express();",
      'const OrderStatus = enumValues(["DRAFT", "SUBMITTED"]);',
      "function loadOrder() { return null; }",
      "export async function getOrder(req, res) {",
      '  requireRole("customer");',
      '  if (req.actorRole !== "customer") throw new Error("FORBIDDEN");',
      '  if (req.order.status !== "DRAFT") throw new Error("INVALID_STATE");',
      '  await db.query("SELECT id, status FROM orders");',
      '  req.order.status = "SUBMITTED";',
      "  return loadOrder();",
      "}",
      'app.get("/orders/:id", getOrder);',
    ].join("\n")),
    writeFile(path.join(rootPath, "test", "server.test.js"), 'import test from "node:test";\nimport { getOrder } from "../src/server.js";\ntest("order", () => getOrder);\n'),
  ]);
  await symlink(path.join(rootPath, "src"), path.join(rootPath, "linked-src"));
  return rootPath;
}

test("scanner produces locatable code, API, SQL, config, dependency, and test facts", async () => {
  const rootPath = await fixtureProject();
  const scanner = new JavaScriptProjectScanner({ clock: fixedClock });
  const bundle = await scanner.scan({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    rootPath,
  });

  assert.equal(bundle.complete, true);
  assert.deepEqual(
    new Set(bundle.nodes.map((node) => node.type)),
    new Set([
      "ARTIFACT",
      "MODULE",
      "CODE_SYMBOL",
      "ENDPOINT",
      "DATA_OBJECT",
      "CONFIGURATION",
      "EXTERNAL_DEPENDENCY",
      "TEST_ASSET",
    ]),
  );
  assert.ok(bundle.nodes.some((node) => node.type === "ENDPOINT" && node.name === "GET /orders/{id}"));
  assert.ok(bundle.nodes.some((node) => node.type === "DATA_OBJECT" && node.naturalKey === "table:orders"));
  assert.ok(bundle.nodes.some((node) => node.type === "DATA_OBJECT" && node.naturalKey === "column:orders.status"));
  assert.ok(bundle.nodes.some((node) => node.type === "CONFIGURATION" && node.name === "DATABASE_URL"));
  assert.ok(bundle.nodes.every((node) => /^sha256:[a-f0-9]{64}$/.test(node.source.contentHash)));
  assert.ok(bundle.nodes.every((node) => node.source.startLine <= node.source.endLine));
  assert.equal(bundle.nodes.some((node) => node.source.artifact.startsWith("linked-src/")), false);

  const symbolId = (name) => bundle.nodes.find((node) => node.type === "CODE_SYMBOL" && node.name === name)?.id;
  const endpointId = bundle.nodes.find((node) => node.name === "GET /orders/:id")?.id;
  const tableId = bundle.nodes.find((node) => node.naturalKey === "table:orders")?.id;
  assert.ok(bundle.edges.some((edge) => edge.subjectId === endpointId && edge.predicate === "IMPLEMENTED_BY" && edge.objectId === symbolId("getOrder")));
  assert.ok(bundle.edges.some((edge) => edge.subjectId === symbolId("getOrder") && edge.predicate === "CALLS" && edge.objectId === symbolId("loadOrder")));
  assert.ok(bundle.edges.some((edge) => edge.subjectId === symbolId("getOrder") && edge.predicate === "READS" && edge.objectId === tableId));
  const semanticSymbols = bundle.nodes.filter((node) => node.type === "CODE_SYMBOL");
  assert.deepEqual(semanticSymbols.find((node) => node.name === "OrderStatus")?.attributes.values, ["DRAFT", "SUBMITTED"]);
  assert.ok(semanticSymbols.some((node) => node.attributes.kind === "condition-branch" && node.attributes.classifications.includes("PERMISSION_GUARD")));
  assert.ok(semanticSymbols.some((node) => node.attributes.kind === "condition-branch" && node.attributes.classifications.includes("STATE_GUARD")));
  assert.ok(semanticSymbols.some((node) => node.attributes.kind === "state-transition" && node.attributes.toState === "SUBMITTED"));
  assert.equal(semanticSymbols.filter((node) => node.attributes.kind === "exception-path").length, 2);
  assert.ok(semanticSymbols.some((node) => node.attributes.kind === "permission-check" && node.attributes.declaredArguments.includes("customer")));
  const testAssetId = bundle.nodes.find((node) => node.type === "TEST_ASSET")?.id;
  assert.ok(bundle.edges.some((edge) => edge.subjectId === testAssetId && edge.predicate === "EXERCISES" && edge.objectId === symbolId("getOrder")));

  const fingerprint = await scanner.fingerprint({ rootPath });
  assert.equal(fingerprint.sourceDigest, bundle.sourceDigest);
  assert.equal(fingerprint.fileCount, 6);

  const repeated = await scanner.scan({
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    sourceComponentId: "SOURCE-001",
    rootPath,
  });
  assert.equal(repeated.sourceDigest, bundle.sourceDigest);
  assert.equal(repeated.id, bundle.id);
});

test("scanner connects JavaScript calls and route handlers through named ESM imports", async () => {
  const rootPath = fileURLToPath(new URL("./fixtures/javascript-cross-file", import.meta.url));
  const scanner = new JavaScriptProjectScanner({ clock: fixedClock });
  const bundle = await scanner.scan({
    projectId: "PROJECT-JS-MODULES",
    snapshotManifestId: "SNAPSHOT-JS-MODULES",
    sourceComponentId: "SOURCE-JS-MODULES",
    rootPath,
  });

  const symbol = (artifact, name) =>
    bundle.nodes.find(
      (node) =>
        node.type === "CODE_SYMBOL" &&
        node.source.artifact === artifact &&
        node.name === name,
    );
  const loadOrder = symbol("src/order-service.js", "loadOrder");
  const getOrder = symbol("src/order-controller.js", "getOrder");
  const runAudit = symbol("src/audit-runner.js", "runAudit");
  const internalAudit = symbol("src/internal-audit.js", "auditOrder");
  const endpoint = bundle.nodes.find(
    (node) => node.type === "ENDPOINT" && node.name === "GET /orders/:id",
  );

  assert.ok(loadOrder);
  assert.ok(getOrder);
  assert.ok(runAudit);
  assert.ok(internalAudit);
  assert.ok(endpoint);
  assert.ok(
    bundle.edges.some(
      (edge) =>
        edge.subjectId === getOrder.id &&
        edge.predicate === "CALLS" &&
        edge.objectId === loadOrder.id,
    ),
    "an aliased named import should resolve to the exported implementation symbol",
  );
  assert.ok(
    bundle.edges.some(
      (edge) =>
        edge.subjectId === endpoint.id &&
        edge.predicate === "IMPLEMENTED_BY" &&
        edge.objectId === getOrder.id,
    ),
    "an imported route handler should resolve to its exported implementation symbol",
  );
  assert.equal(
    bundle.edges.some(
      (edge) =>
        edge.subjectId === runAudit.id &&
        edge.predicate === "CALLS" &&
        edge.objectId === internalAudit.id,
    ),
    false,
    "the scanner must not link an import to a same-named symbol that is not exported",
  );
});

test("scanner uses the Java AST to connect Spring API design, implementation, configuration, and calls", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "traqen-java-scanner-"));
  await mkdir(path.join(rootPath, "src", "main", "java", "com", "example", "orders"), { recursive: true });
  await Promise.all([
    writeFile(path.join(rootPath, "src", "main", "java", "com", "example", "orders", "OrderController.java"), [
      "package com.example.orders;",
      "@RestController",
      '@RequestMapping("/orders")',
      "@PreAuthorize(\"hasRole('CUSTOMER')\")",
      "public class OrderController {",
      "  private final OrderService service;",
      "  @GetMapping(\"/{id}\")",
      "  public OrderResponse getOrder(@Valid OrderRequest request) {",
      "    return service.loadOrder(request.id());",
      "  }",
      "}",
    ].join("\n")),
    writeFile(path.join(rootPath, "src", "main", "java", "com", "example", "orders", "OrderService.java"), [
      "package com.example.orders;",
      "@Service",
      "public class OrderService {",
      "  public OrderResponse loadOrder(String id) {",
      '    String region = getProperty("orders.region");',
      "    return new OrderResponse(id, region);",
      "  }",
      "}",
      "record OrderRequest(String id) {}",
      "record OrderResponse(String id, String region) {}",
    ].join("\n")),
  ]);

  const scanner = new JavaScriptProjectScanner({ clock: fixedClock });
  const bundle = await scanner.scan({ projectId: "PROJECT-JAVA", snapshotManifestId: "SNAPSHOT-JAVA", sourceComponentId: "SOURCE-JAVA", rootPath });
  const endpoint = bundle.nodes.find((node) => node.type === "ENDPOINT" && node.name === "GET /orders/{id}");
  const handler = bundle.nodes.find((node) => node.type === "CODE_SYMBOL" && node.attributes.methodName === "getOrder");
  const service = bundle.nodes.find((node) => node.type === "CODE_SYMBOL" && node.attributes.methodName === "loadOrder");

  assert.equal(bundle.complete, true);
  assert.equal(endpoint?.attributes.protocol, "Spring");
  assert.equal(endpoint?.attributes.returnType, "OrderResponse");
  assert.deepEqual(endpoint?.attributes.securityAnnotations, ["PreAuthorize"]);
  assert.ok(bundle.edges.some((edge) => edge.subjectId === endpoint?.id && edge.predicate === "IMPLEMENTED_BY" && edge.objectId === handler?.id));
  assert.ok(bundle.edges.some((edge) => edge.subjectId === handler?.id && edge.predicate === "CALLS" && edge.objectId === service?.id));
  assert.ok(bundle.nodes.some((node) => node.type === "CONFIGURATION" && node.name === "orders.region"));
  assert.ok(bundle.nodes.some((node) => node.type === "DATA_OBJECT" && node.name === "OrderResponse"));
  assert.ok(bundle.nodes.some((node) => node.type === "CODE_SYMBOL" && node.attributes.kind === "permission-check"));
});

test("scanner reports parser failures instead of presenting an incomplete scan as complete", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "traqen-scanner-broken-"));
  await writeFile(path.join(rootPath, "broken.js"), "function broken( {");
  const scanner = new JavaScriptProjectScanner({ clock: fixedClock });
  const bundle = await scanner.scan({ projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001", rootPath });

  assert.equal(bundle.complete, false);
  assert.equal(bundle.diagnostics[0].severity, "ERROR");
  assert.equal(bundle.diagnostics[0].artifact, "broken.js");
});

test("scanner enforces bounded traversal limits", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "traqen-scanner-limits-"));
  await writeFile(path.join(rootPath, "large.js"), "x".repeat(32));
  const scanner = new JavaScriptProjectScanner({ clock: fixedClock, maxFileBytes: 16 });
  const bundle = await scanner.scan({ projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001", rootPath });

  assert.equal(bundle.nodes.length, 0);
  assert.equal(bundle.complete, false);
  assert.match(bundle.diagnostics[0].message, /maxFileBytes/);
});

test("scanner never hides unsupported source or OpenAPI formats behind a complete result", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "traqen-scanner-capability-"));
  await writeFile(path.join(rootPath, "service.ts"), "export const value: string = 'x';");
  await writeFile(path.join(rootPath, "openapi.yaml"), "openapi: 3.1.0\npaths: {}\n");
  const scanner = new JavaScriptProjectScanner({ clock: fixedClock });
  const bundle = await scanner.scan({ projectId: "PROJECT-001", snapshotManifestId: "SNAPSHOT-001", sourceComponentId: "SOURCE-001", rootPath });

  assert.equal(bundle.complete, false);
  assert.equal(bundle.diagnostics.length, 2);
  assert.ok(bundle.diagnostics.every((diagnostic) => diagnostic.severity === "ERROR"));
});
