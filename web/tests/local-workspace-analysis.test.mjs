import assert from "node:assert/strict";
import test from "node:test";

import { analyzeLocalWorkspace, analyzeLocalWorkspaceRecords, createLocalWorkspaceAnalysisAccumulator, localWorkspaceScannerVersion, scanLocalWorkspaceFile } from "../app/local-workspace-analysis.ts";
import { calculateLocalWorkspaceStatistics, localWorkspaceStatisticsForNode } from "../app/local-workspace-statistics.ts";

test("discovers a complete local Feature tree without promoting candidates to business truth", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Customer Portal",
    projectId: "PROJECT-CUSTOMER-PORTAL",
    now: new Date("2026-07-17T04:00:00.000Z"),
    files: [
      {
        path: "src/api/customer.js",
        size: 180,
        content: [
          "export async function loadCustomerProfile(id) { return { id }; }",
          "router.get('/v1/customers/:id', loadCustomerProfile);",
        ].join("\n"),
      },
      {
        path: "tests/customer.test.js",
        size: 120,
        content: "import { loadCustomerProfile } from '../src/api/customer.js';\ntest('profile', () => loadCustomerProfile('1'));",
      },
      {
        path: ".env.example",
        size: 30,
        content: "CUSTOMER_API_URL=http://localhost",
      },
      {
        path: "package.json",
        size: 70,
        content: JSON.stringify({ name: "customer-portal", scripts: { test: "node --test" } }),
      },
      {
        path: "services/billing.py",
        size: 80,
        content: "def calculate_invoice_total(lines):\n    return sum(lines)",
      },
      {
        path: "config/settings.json",
        size: 50,
        content: "{\"apiToken\":\"must-not-render\"}",
      },
      {
        path: ".env",
        size: 40,
        content: "PRODUCTION_SECRET=must-not-be-read",
      },
    ],
  });

  assert.equal(analysis.workspaceName, "Customer Portal");
  assert.equal(analysis.scannedAt, "2026-07-17T04:00:00.000Z");
  assert.ok(analysis.features.some((feature) => feature.kind === "ENDPOINT" && feature.name === "GET /v1/customers/:id"));
  assert.ok(analysis.features.some((feature) => feature.kind === "CODE_SYMBOL" && feature.name === "Load Customer Profile"));
  assert.ok(analysis.features.some((feature) => feature.kind === "COMMAND" && feature.name === "npm run test"));
  assert.ok(analysis.features.some((feature) => feature.kind === "CODE_SYMBOL" && feature.name === "Calculate invoice total"));
  const capability = analysis.features.find((feature) => feature.kind === "CODE_SYMBOL");
  assert.equal(capability.dimensions.authority, "PENDING");
  assert.equal(capability.dimensions.verification, "NOT_RUN");
  assert.ok(capability.tests.some((item) => item.path === "tests/customer.test.js"));
  assert.ok(capability.configurations.some((item) => item.value.includes("<redacted>")));
  assert.ok(capability.configurations.every((item) => !item.value.includes("must-not-render") && !item.value.includes("must-not-be-read")));
  assert.equal(analysis.skippedFileCount, 1);
  assert.ok(capability.gaps.some((gap) => gap.type === "MISSING_AUTHORITY"));
  assert.ok(capability.gaps.some((gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT"));
  assert.equal(analysis.tree.kind, "WORKSPACE");
  assert.ok(analysis.tree.children.some((node) => node.kind === "MODULE"));
});

test("accepts a 100,000-file project in batches and skips only oversized files", () => {
  const accumulator = createLocalWorkspaceAnalysisAccumulator({ workspaceName: "Large Project", projectId: "PROJECT-LARGE" });
  for (let offset = 0; offset < 100_000; offset += 400) {
    accumulator.addFiles(Array.from({ length: 400 }, (_, index) => {
      const sequence = offset + index;
      return sequence < 2_400
        ? { path: `src/main/java/com/acme/capability/Capability${sequence}.java`, size: 120, content: `package com.acme.capability; public class Capability${sequence} {\n  public void executeCapability${sequence}() {}\n}` }
        : { path: `docs/file-${sequence}.md`, size: 16, content: `# File ${sequence}` };
    }));
  }
  accumulator.addFiles([{ path: "src/generated.js", size: 769 * 1024, content: "" }]);

  const analysis = accumulator.finish();
  assert.equal(analysis.fileCount, 100_001);
  assert.equal(analysis.supportedFileCount, 100_000);
  assert.equal(analysis.skippedFileCount, 1);
  assert.equal(analysis.features.length, 2_400);
});

test("discovers Spring, JAX-RS, Java backend, interface, listener, config, and test traces", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Java Commerce",
    projectId: "PROJECT-JAVA-COMMERCE",
    files: [
      {
        path: "order-service/src/main/java/com/acme/orders/controller/OrderController.java",
        size: 900,
        content: [
          "package com.acme.orders.controller;",
          "@RestController",
          "@RequestMapping(path = \"/api/orders\")",
          "public class OrderController {",
          "  @GetMapping(path = \"/{id}\", produces = \"application/json\")",
          "  public ResponseEntity<Order> findOrder(@PathVariable String id) { return null; }",
          "  @GetMapping(produces = \"application/json\")",
          "  public ResponseEntity<List<Order>> listOrders() { return null; }",
          "  @RequestMapping(value = {\"\", \"/\"}, method = {RequestMethod.POST, RequestMethod.PUT})",
          "  public ResponseEntity<Order> saveOrder(@RequestBody Order order) { return null; }",
          "}",
        ].join("\n"),
      },
      {
        path: "order-service/src/main/java/com/acme/orders/service/OrderService.java",
        size: 500,
        content: [
          "package com.acme.orders.service;",
          "@Service",
          "public class OrderService {",
          "  public Order submitOrder(Order order) { return order; }",
          "  protected void validateOrder(Order order) {}",
          "  private void auditInternally() {}",
          "  @KafkaListener(topics = \"orders\")",
          "  public void consumeOrder(OrderCreated event) {}",
          "  public String getName() { return \"orders\"; }",
          "}",
        ].join("\n"),
      },
      {
        path: "order-service/src/main/java/com/acme/orders/port/OrderPort.java",
        size: 180,
        content: "package com.acme.orders.port;\npublic interface OrderPort {\n  Order loadOrder(String id);\n}",
      },
      {
        path: "customer-service/src/main/java/com/acme/customers/resource/CustomerResource.java",
        size: 350,
        content: [
          "package com.acme.customers.resource;",
          "@Path(\"/v1/customers\")",
          "public class CustomerResource {",
          "  @GET",
          "  @Path(\"/{id}\")",
          "  public Customer getCustomer(String id) { return null; }",
          "}",
        ].join("\n"),
      },
      {
        path: "order-service/src/test/java/com/acme/orders/controller/OrderControllerTest.java",
        size: 220,
        content: "class OrderControllerTest { @Test void findOrderReturnsOrder() { new OrderController().findOrder(\"1\"); } }",
      },
      { path: "order-service/src/main/resources/application.yml", size: 50, content: "spring:\n  application:\n    name: orders" },
      { path: "order-service/pom.xml", size: 80, content: "<project><artifactId>order-service</artifactId></project>" },
      { path: "order-service/target/generated/Generated.java", size: 80, content: "public class Generated { public void ignoreMe() {} }" },
    ],
  });

  const endpoints = analysis.features.filter((feature) => feature.kind === "ENDPOINT");
  assert.ok(endpoints.some((feature) => feature.name === "GET /api/orders/{id}"));
  assert.ok(endpoints.some((feature) => feature.name === "GET /api/orders"));
  assert.ok(endpoints.every((feature) => !feature.name.includes("application/json")));
  assert.ok(endpoints.some((feature) => feature.name === "POST /api/orders"));
  assert.ok(endpoints.some((feature) => feature.name === "PUT /api/orders"));
  assert.ok(endpoints.some((feature) => feature.name === "GET /v1/customers/{id}"));
  assert.ok(analysis.features.some((feature) => feature.name === "Submit Order" && feature.description.includes("Service")));
  assert.ok(analysis.features.some((feature) => feature.name === "Validate Order"));
  assert.ok(analysis.features.some((feature) => feature.name === "Kafka Listener · Consume Order"));
  assert.ok(analysis.features.some((feature) => feature.name === "Load Order" && feature.description.includes("interface")));
  assert.ok(analysis.features.every((feature) => feature.name !== "Audit Internally" && feature.name !== "Ignore Me"));
  assert.ok(analysis.features.some((feature) => feature.modulePath.includes("order-service") && feature.modulePath.includes("com.acme.orders")));
  const findOrder = endpoints.find((feature) => feature.name === "GET /api/orders/{id}");
  assert.ok(findOrder.tests.some((item) => item.path.includes("OrderControllerTest.java")));
  assert.ok(findOrder.configurations.some((item) => item.path.endsWith("application.yml")));
  assert.ok(findOrder.configurations.some((item) => item.path.endsWith("pom.xml")));
  assert.equal(analysis.skippedFileCount, 1);
});

test("rebuilds an incremental Workspace from reused, changed, added, and deleted file records", () => {
  const unchanged = scanLocalWorkspaceFile({ path: "src/unchanged.js", size: 40, lastModified: 10, content: "export function unchangedFeature() {}" });
  const deleted = scanLocalWorkspaceFile({ path: "src/deleted.js", size: 40, lastModified: 10, content: "export function deletedFeature() {}" });
  const changed = scanLocalWorkspaceFile({ path: "src/changed.js", size: 50, lastModified: 20, content: "export function changedFeatureV2() {}" });
  const added = scanLocalWorkspaceFile({ path: "src/added.js", size: 40, lastModified: 20, content: "export function addedFeature() {}" });

  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Incremental", projectId: "PROJECT-INCREMENTAL", records: [unchanged, changed, added] });
  assert.equal(unchanged.scannerVersion, localWorkspaceScannerVersion);
  assert.equal(unchanged.lastModified, 10);
  assert.ok(analysis.features.some((feature) => feature.name === "Unchanged Feature"));
  assert.ok(analysis.features.some((feature) => feature.name === "Changed Feature V2"));
  assert.ok(analysis.features.some((feature) => feature.name === "Added Feature"));
  assert.ok(analysis.features.every((feature) => feature.name !== "Deleted Feature"));
  assert.ok(deleted.candidates.length > 0);
});

test("calculates hierarchical Workspace statistics without treating unknown states as nonconforming", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Statistics",
    projectId: "PROJECT-STATISTICS",
    files: [
      { path: "orders/src/order.js", size: 100, content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);" },
      { path: "orders/tests/order.test.js", size: 80, content: "test('submit order', () => submitOrder());" },
      { path: "orders/config/application.yml", size: 30, content: "orders:\n  enabled: true" },
      { path: "customers/src/customer.js", size: 60, content: "export function loadCustomer() {}" },
    ],
  });

  const workspace = localWorkspaceStatisticsForNode(analysis, analysis.tree.id);
  assert.equal(workspace.statistics.featureCount, analysis.features.length);
  assert.equal(workspace.statistics.designImplementationCount, analysis.features.length);
  assert.equal(workspace.statistics.pendingHumanConfirmationCount, analysis.features.length);
  assert.equal(workspace.statistics.incompleteEvidenceChainCount, analysis.features.length);
  assert.equal(workspace.statistics.execution.notRun, analysis.features.length);
  assert.equal(workspace.statistics.nonconformingFeatureCount, 0);
  assert.ok(workspace.statistics.configurationItemCount > 0);
  assert.ok(workspace.statistics.testCaseCount > 0);
  assert.ok(workspace.statistics.blockingGapCount >= analysis.features.length);

  const orders = analysis.tree.children.find((node) => node.label === "orders");
  assert.ok(orders);
  const ordersScope = localWorkspaceStatisticsForNode(analysis, orders.id);
  assert.ok(ordersScope.statistics.featureCount > 0);
  assert.ok(ordersScope.statistics.featureCount < workspace.statistics.featureCount);
  assert.ok(ordersScope.statistics.configurationItemCount > 0);
  const customers = analysis.tree.children.find((node) => node.label === "customers");
  assert.ok(customers);
  assert.equal(localWorkspaceStatisticsForNode(analysis, customers.id).statistics.configurationItemCount, 0);
  const explicitViolation = structuredClone(analysis.features[0]);
  explicitViolation.dimensions.conformance = "NON_CONFORMING";
  assert.equal(calculateLocalWorkspaceStatistics([explicitViolation]).nonconformingFeatureCount, 1);
});
