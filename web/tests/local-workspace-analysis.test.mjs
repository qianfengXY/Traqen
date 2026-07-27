import assert from "node:assert/strict";
import test from "node:test";

import { analyzeLocalWorkspace, analyzeLocalWorkspaceRecords, applyLocalModelEnrichment, createLocalWorkspaceAnalysisAccumulator, localWorkspaceAnalysisForTreeMode, localWorkspaceScannerVersion, planLocalWorkspaceCheckpointResume, scanLocalWorkspaceFile } from "../app/local-workspace-analysis.ts";
import { createLocalWorkspaceCandidateGraph } from "../app/local-workspace-graph.ts";
import { calculateLocalWorkspaceStatistics, localWorkspaceStatisticsForNode } from "../app/local-workspace-statistics.ts";

test("resumes a local checkpoint from only the unfinished or changed files", () => {
  const unchanged = scanLocalWorkspaceFile({ path: "src/unchanged.ts", size: 20, lastModified: 10, content: "export function unchanged() {}" });
  const changed = scanLocalWorkspaceFile({ path: "src/changed.ts", size: 20, lastModified: 10, content: "export function before() {}" });
  const partial = planLocalWorkspaceCheckpointResume([
    { path: "src/unchanged.ts", size: 20, lastModified: 10 },
    { path: "src/changed.ts", size: 24, lastModified: 20 },
    { path: "src/new.ts", size: 12, lastModified: 30 },
  ], [unchanged, changed]);

  assert.deepEqual(partial.reusableRecords.map((record) => record.path), ["src/unchanged.ts"]);
  assert.deepEqual(partial.remainingPaths, ["src/changed.ts", "src/new.ts"]);
  assert.equal(partial.exactMatch, false);

  const exact = planLocalWorkspaceCheckpointResume([
    { path: "src/unchanged.ts", size: 20, lastModified: 10 },
    { path: "src/changed.ts", size: 20, lastModified: 10 },
  ], [unchanged, changed]);
  assert.equal(exact.exactMatch, true);
  assert.deepEqual(exact.remainingPaths, []);
});

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
        path: "src/api/__tests__/customer.test.js",
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
        path: "src/api/config/settings.json",
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
  assert.ok(capability.tests.some((item) => item.path === "src/api/__tests__/customer.test.js"));
  assert.ok(capability.configurations.some((item) => item.value.includes("<redacted>")));
  assert.ok(capability.configurations.every((item) => !item.value.includes("must-not-render") && !item.value.includes("must-not-be-read")));
  assert.equal(analysis.skippedFileCount, 1);
  assert.ok(capability.gaps.some((gap) => gap.type === "MISSING_AUTHORITY"));
  assert.ok(capability.gaps.some((gap) => gap.type === "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT"));
  assert.equal(analysis.tree.kind, "WORKSPACE");
  assert.equal(analysis.tree.featureCount, analysis.features.length);
  assert.ok(analysis.tree.children.some((node) => node.kind === "MODULE"));
  assert.ok(analysis.tree.children.flatMap((node) => node.children).some((node) => node.kind === "DOMAIN"));
  assert.ok(analysis.tree.children.flatMap((node) => node.children).flatMap((node) => node.children).some((node) => node.label === "API_SERVICE"));
  assert.ok(analysis.tree.children.flatMap((node) => node.children).flatMap((node) => node.children).some((node) => node.label === "BUSINESS_CAPABILITY"));
  assert.ok(analysis.tree.children.every((node) => node.featureCount === node.children.reduce((sum, child) => sum + child.featureCount, 0)));
});

test("binds local Candidate evidence to a deterministic Snapshot without minting a governed Feature identity", () => {
  const firstRecord = scanLocalWorkspaceFile({
    path: "src/orders.ts",
    size: 120,
    lastModified: 1,
    content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);",
  });
  const repeated = analyzeLocalWorkspaceRecords({
    workspaceName: "Orders",
    projectId: "PROJECT-ORDERS",
    records: [firstRecord],
    now: new Date("2026-07-25T10:00:00.000Z"),
  });
  const sameSnapshot = analyzeLocalWorkspaceRecords({
    workspaceName: "Orders",
    projectId: "PROJECT-ORDERS",
    records: [firstRecord],
    now: new Date("2026-07-25T11:00:00.000Z"),
  });
  const changedRecord = scanLocalWorkspaceFile({
    path: "src/orders.ts",
    size: 140,
    lastModified: 2,
    content: "export function submitOrder() { return validateOrder(); }\nrouter.post('/orders', submitOrder);",
  });
  const changed = analyzeLocalWorkspaceRecords({
    workspaceName: "Orders",
    projectId: "PROJECT-ORDERS",
    records: [changedRecord],
  });

  assert.equal(repeated.snapshotManifestId, sameSnapshot.snapshotManifestId);
  assert.notEqual(repeated.snapshotManifestId, changed.snapshotManifestId);
  assert.equal(repeated.features[0].nodeType, "CANDIDATE_FEATURE");
  assert.equal(repeated.features[0].governedFeatureId, null);
  assert.ok(repeated.features[0].id.startsWith("CANDIDATE-DISCOVERED-"));
  assert.ok(repeated.features[0].evidenceFactIds.length > 0);
  assert.deepEqual(repeated.features[0].evidenceFactIds, sameSnapshot.features[0].evidenceFactIds);
  assert.notDeepEqual(repeated.features[0].evidenceFactIds, changed.features[0].evidenceFactIds);
});

test("projects Candidate and test-asset semantics without fabricating governed truth or execution", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Orders",
    projectId: "PROJECT-ORDERS",
    files: [
      { path: "orders/src/orders.ts", size: 120, content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);" },
      { path: "orders/test/orders.test.ts", size: 90, content: "test('submit order', () => submitOrder());" },
    ],
  });
  const graph = createLocalWorkspaceCandidateGraph(analysis, analysis.features[0].id, "traceability");
  const nodeTypes = new Set(graph.nodes.map((node) => node.type));

  assert.equal(graph.snapshotManifestId, analysis.snapshotManifestId);
  assert.ok(nodeTypes.has("CANDIDATE_FEATURE"));
  assert.ok(nodeTypes.has("CANDIDATE_CLAIM"));
  assert.ok(nodeTypes.has("TEST_ASSET"));
  assert.equal(nodeTypes.has("FEATURE"), false);
  assert.equal(nodeTypes.has("CLAIM"), false);
  assert.equal(nodeTypes.has("TEST_SPEC"), false);
  assert.equal(nodeTypes.has("TEST_EXECUTION"), false);
  assert.equal(graph.edges.some((edge) => edge.type === "EXECUTED_AS"), false);
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
  assert.equal(endpoints.find((feature) => feature.name === "GET /api/orders/{id}").displayName, "Find Order");
  assert.ok(analysis.features.some((feature) => feature.name === "Submit Order" && feature.description.includes("Service")));
  assert.ok(analysis.features.some((feature) => feature.name === "Validate Order"));
  assert.ok(analysis.features.some((feature) => feature.name === "Kafka Listener · Consume Order"));
  assert.ok(analysis.features.some((feature) => feature.name === "Load Order" && feature.description.includes("interface")));
  assert.ok(analysis.features.every((feature) => feature.name !== "Audit Internally" && feature.name !== "Ignore Me" && feature.name !== "Get Name"));
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

test("rebuilds readable endpoint labels from legacy scan records", () => {
  const record = scanLocalWorkspaceFile({ path: "src/customer.js", size: 100, content: "router.get('/customers/:id', loadCustomer);" });
  delete record.candidates[0].displayName;
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Legacy", projectId: "PROJECT-LEGACY", records: [record] });
  const endpoint = analysis.features.find((feature) => feature.kind === "ENDPOINT");
  assert.equal(endpoint.displayName, "Load Customer");
  assert.equal(analysis.tree.children[0].children[0].children[0].children[0].label, "Load Customer");
});

test("keeps Clowder-style async routes readable and excludes support artifacts from Feature candidates", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Clowder-shaped project",
    projectId: "PROJECT-CLOWDER-SHAPED",
    files: [
      {
        path: "packages/api/src/routes/accounts.ts",
        size: 500,
        content: [
          "export const APP_HEARTBEAT_MS = 1000;",
          "export const accountSchema = z.object({ id: z.string() });",
          "export function clearAccountsForTest() {}",
          "export async function loadAccounts() { return []; }",
          "export const accountsRoutes: FastifyPluginAsync = async (app) => {",
          "  app.get('/api/accounts', async (_request, reply) => reply.send(await loadAccounts()));",
          "};",
        ].join("\n"),
      },
      { path: "packages/api/test/accounts.test.ts", size: 120, content: "test('loads accounts', async () => loadAccounts());" },
      { path: "packages/api/test/__fixtures__/plugin.yaml", size: 40, content: "token: must-not-attach" },
      { path: "packages/api/package.json", size: 100, content: JSON.stringify({ scripts: { test: "node --test" } }) },
    ],
  });

  const endpoint = analysis.features.find((feature) => feature.kind === "ENDPOINT");
  assert.equal(endpoint.name, "GET /api/accounts");
  assert.notEqual(endpoint.displayName, "Async");
  assert.ok(endpoint.tests.some((item) => item.path.endsWith("accounts.test.ts")));
  assert.ok(analysis.features.some((feature) => feature.name === "Load Accounts"));
  assert.ok(analysis.features.some((feature) => feature.name === "Accounts Routes"));
  assert.ok(analysis.features.every((feature) => !["APP HEARTBEAT MS", "Account Schema", "Clear Accounts For Test"].includes(feature.name)));
  assert.ok(analysis.features.every((feature) => feature.configurations.every((configuration) => !configuration.path.includes("__fixtures__"))));
  assert.equal(analysis.tree.children.find((node) => node.label === "API").children.find((node) => node.label === "Accounts").kind, "DOMAIN");
});

test("does not promote scanner-only observations into business or API Feature trees", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Two-mode tree",
    projectId: "PROJECT-TWO-MODE-TREE",
    files: [
      { path: "src/orders.ts", size: 160, content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);" },
      { path: "package.json", size: 80, content: JSON.stringify({ scripts: { start: "node src/orders.ts" } }) },
    ],
  });

  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");
  const api = localWorkspaceAnalysisForTreeMode(analysis, "API");
  assert.deepEqual(business.features, []);
  assert.deepEqual(api.features, []);
  assert.equal(business.tree.featureCount, 0);
  assert.equal(api.tree.featureCount, 0);
  assert.equal(analysis.features.filter((feature) => feature.kind === "COMMAND").length, 1);
});

test("hides legacy model classifications that predate the business hierarchy policy", () => {
  const record = scanLocalWorkspaceFile({ path: "src/orders.ts", size: 80, content: "export function submitOrder() {}" });
  record.candidates[0].modelClassification = {
    profileId: "legacy-model",
    evidencePolicyVersion: 1,
    businessFeature: true,
    domain: "Orders",
    group: "BUSINESS_CAPABILITY",
    confidence: "HIGH",
    rationale: "Legacy classification without business hierarchy.",
  };
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Orders", projectId: "PROJECT-ORDERS", records: [record] });
  assert.deepEqual(localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS").features, []);
});

test("does not turn generic exported symbols from a large agent repository into business Candidates", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Agent repository",
    projectId: "PROJECT-AGENT-REPOSITORY",
    files: [
      { path: "src/agents/control-plane.ts", size: 300, content: "export function resolveBackendCandidatePlan() {}\nexport function markTurnActive() {}\nexport function createBackgroundTaskRecord() {}" },
      { path: "src/agents/control-plane.test-helpers.ts", size: 100, content: "export function expectRejectedRecord() {}" },
      { path: "src/orders/service.ts", size: 100, content: "export function submitOrder() {}" },
    ],
  });
  assert.equal(analysis.features.some((feature) => feature.name === "Expect Rejected Record"), false);
  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");
  assert.deepEqual(business.features, []);
});

test("discovers OpenClaw-style Gateway RPC design and links handler logic", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "OpenClaw-shaped Gateway",
    projectId: "PROJECT-OPENCLAW-GATEWAY",
    files: [
      {
        path: "src/gateway/methods/core-descriptors.ts",
        size: 220,
        content: [
          "type CoreGatewayMethodSpec = GatewayMethodDescriptorInput & { since: string };",
          "const CORE_GATEWAY_METHOD_SPECS: readonly CoreGatewayMethodSpec[] = [",
          "  { name: \"sessions.list\", scope: \"operator.read\", since: \"2026.7\" },",
          "];",
        ].join("\n"),
      },
      {
        path: "src/gateway/server-methods/sessions.ts",
        size: 260,
        content: [
          "import type { GatewayRequestHandlers } from './types.js';",
          "export const sessionsHandlers: GatewayRequestHandlers = {",
          "  \"sessions.list\": async ({ params, respond }) => {",
          "    const sessions = await loadSessions(params);",
          "    respond(true, { sessions });",
          "  },",
          "};",
        ].join("\n"),
      },
    ],
  });

  const endpoint = analysis.features.find((feature) => feature.name === "RPC sessions.list");
  assert.ok(endpoint);
  assert.equal(endpoint.apiDesign.protocol, "Gateway RPC");
  assert.equal(endpoint.apiDesign.method, "RPC");
  assert.equal(endpoint.apiDesign.path, "sessions.list");
  assert.ok(endpoint.implementationBlocks.some((block) => block.path.endsWith("sessions.ts") && block.code.includes("loadSessions")));
});

test("business projection suppresses technical symbols while API projection links design to implementation blocks", () => {
  const analysis = analyzeLocalWorkspace({
    workspaceName: "Readable Agent output",
    projectId: "PROJECT-READABLE",
    files: [
      { path: "src/orders/service.ts", size: 180, content: "export function submitOrder() { return persistOrder(); }\nrouter.post('/orders', submitOrder);" },
      { path: "src/orders/repository.ts", size: 100, content: "export function persistOrder() { return db.save(); }" },
      { path: "src/utils/parser.ts", size: 80, content: "export function parsePayload() {}" },
    ],
  });

  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");
  const api = localWorkspaceAnalysisForTreeMode(analysis, "API");
  assert.deepEqual(business.features, []);
  assert.deepEqual(api.features, []);
  const endpoint = analysis.features.find((feature) => feature.kind === "ENDPOINT");
  assert.equal(endpoint.apiDesign.method, "POST");
  assert.equal(endpoint.apiDesign.path, "/orders");
  assert.ok(endpoint.implementationBlocks.some((block) => block.symbol === "Submit Order"));
});

test("model enrichment preserves scanner provenance behind a stable semantic business identity", () => {
  const service = scanLocalWorkspaceFile({ path: "src/technical/processor.ts", size: 90, content: "export function execute() { return issueRefund(); }" });
  const candidate = service.candidates[0];
  const records = applyLocalModelEnrichment([service], "workspace-default", [{
    id: candidate.id,
    displayName: "Issue customer refund",
    description: "Issues a customer refund through the discovered processor.",
    businessFeature: true,
    businessKey: "payment.refund.issue",
    businessModule: "Payment management",
    businessSubmodule: "Customer refunds",
    domain: "Customer refunds",
    group: "BUSINESS_CAPABILITY",
    confidence: "HIGH",
    rationale: "The implementation invokes the refund operation.",
    evidenceFactIds: ["FACT-REFUND"],
  }]);
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Payments", projectId: "PROJECT-PAYMENTS", records });
  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");

  assert.equal(business.features.length, 1);
  assert.notEqual(business.features[0].id, candidate.id);
  assert.deepEqual(business.features[0].evidenceCandidateIds, [candidate.id]);
  assert.equal(business.features[0].displayName, "Issue customer refund");
  assert.equal(business.features[0].modelClassification.profileId, "workspace-default");
  assert.equal(business.features[0].modelClassification.evidencePolicyVersion, 4);
  assert.equal(business.tree.children[0].label, "Payment management");
  assert.equal(business.tree.children[0].children[0].label, "Customer refunds");
});

test("rejects a local model conclusion that omits its evidence Fact references", () => {
  const record = scanLocalWorkspaceFile({
    path: "src/workspaces/service.ts",
    size: 80,
    content: "export function createWorkspace() {}",
  });
  assert.throws(() => applyLocalModelEnrichment([record], "workspace-default", [{
    id: record.candidates[0].id,
    displayName: "Create workspace",
    description: "Creates a workspace.",
    businessFeature: true,
    businessKey: "workspace.create",
    businessModule: "Workspace management",
    businessSubmodule: "Workspace lifecycle",
    domain: "Workspaces",
    group: "BUSINESS_CAPABILITY",
    confidence: "LOW",
    rationale: "One observed source symbol.",
  }]), /evidenceFactIds/);
});

test("builds user-facing module, submodule, and feature levels only from Agent-validated evidence", () => {
  const record = scanLocalWorkspaceFile({
    path: "src/workspaces/service.ts",
    size: 160,
    content: "export function createWorkspace() {}\nrouter.post('/workspaces', createWorkspace);",
  });
  const businessCandidate = record.candidates.find((candidate) => candidate.kind === "CODE_SYMBOL");
  const endpointCandidate = record.candidates.find((candidate) => candidate.kind === "ENDPOINT");
  const enriched = applyLocalModelEnrichment([record], "workspace-default", [
    {
      id: businessCandidate.id,
      displayName: "Create workspace",
      description: "Creates a workspace for organizing one analyzed project.",
      businessFeature: true,
      businessKey: "workspace.create",
      businessModule: "Workspace management",
      businessSubmodule: "Workspace lifecycle",
      domain: "Workspaces",
      group: "BUSINESS_CAPABILITY",
      confidence: "HIGH",
      rationale: "The exported behavior and route corroborate workspace creation.",
      evidenceFactIds: ["FACT-WORKSPACE-SYMBOL"],
    },
    {
      id: endpointCandidate.id,
      displayName: "Create workspace API",
      description: "Accepts a request to create a workspace.",
      businessFeature: false,
      businessKey: "workspace.api.create",
      businessModule: "Workspace management",
      businessSubmodule: "Workspace APIs",
      domain: "Workspaces",
      group: "API_SERVICE",
      confidence: "HIGH",
      rationale: "The route declaration is directly observed.",
      evidenceFactIds: ["FACT-WORKSPACE-ENDPOINT"],
    },
  ]);
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Traqen", projectId: "PROJECT-TRAQEN", records: enriched });
  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");
  const api = localWorkspaceAnalysisForTreeMode(analysis, "API");

  assert.equal(enriched[0].candidates[0].modelClassification.reconciliationStatus, "EVIDENCE_VALIDATED");
  assert.deepEqual(business.tree.children.map((node) => node.label), ["Workspace management"]);
  assert.deepEqual(business.tree.children[0].children.map((node) => node.label), ["Workspace lifecycle"]);
  assert.deepEqual(business.tree.children[0].children[0].children.map((node) => node.label), ["Create workspace"]);
  assert.equal(business.tree.children[0].children[0].children[0].detail.includes("service.ts"), false);
  assert.deepEqual(api.tree.children[0].children[0].children.map((node) => node.label), ["Create workspace API"]);
});

test("admits an evidence-validated Candidate endpoint to both business and API projections", () => {
  const record = scanLocalWorkspaceFile({
    path: "src/orders.ts",
    size: 120,
    content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);",
  });
  const endpoint = record.candidates.find((candidate) => candidate.kind === "ENDPOINT");
  const records = applyLocalModelEnrichment([record], "workspace-default", [{
    id: endpoint.id,
    displayName: "Submit order",
    description: "Accepts and submits a customer order.",
    businessFeature: true,
    businessKey: "order.submit",
    businessModule: "Order management",
    businessSubmodule: "Order submission",
    domain: "Orders",
    group: "API_SERVICE",
    confidence: "MEDIUM",
    rationale: "The endpoint and handler describe a user-recognizable order submission.",
    evidenceFactIds: ["FACT-ORDER-ENDPOINT"],
  }]);
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Orders", projectId: "PROJECT-ORDERS", records });
  assert.equal(localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS").features.length, 1);
  assert.equal(localWorkspaceAnalysisForTreeMode(analysis, "API").features.length, 1);
});

test("merges corroborating scanner candidates into one Agent business function", () => {
  const service = scanLocalWorkspaceFile({ path: "src/workspaces/service.ts", size: 80, content: "export function createWorkspace() {}" });
  const controller = scanLocalWorkspaceFile({ path: "src/workspaces/controller.ts", size: 90, content: "export function createWorkspace() { return service(); }" });
  const records = applyLocalModelEnrichment([service, controller], "workspace-default", [service, controller].map((record) => ({
    id: record.candidates[0].id,
    displayName: "Create workspace",
    description: `Creates a workspace based on ${record.path}.`,
    businessFeature: true,
    businessKey: "workspace.create",
    businessModule: "Workspace management",
    businessSubmodule: "Workspace lifecycle",
    domain: "Workspaces",
    group: "BUSINESS_CAPABILITY",
    confidence: "MEDIUM",
    rationale: `Evidence observed at ${record.path}.`,
    evidenceFactIds: [`FACT-${record.path}`],
  })));
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Traqen", projectId: "PROJECT-TRAQEN", records });
  const business = localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS");

  assert.equal(business.features.length, 1);
  assert.equal(business.features[0].displayName, "Create workspace");
  assert.equal(business.features[0].evidenceCandidateIds.length, 2);
  assert.equal(business.features[0].implementationBlocks.length, 2);
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

  const orders = analysis.tree.children.find((node) => node.label === "Orders");
  assert.ok(orders);
  const ordersScope = localWorkspaceStatisticsForNode(analysis, orders.id);
  assert.ok(ordersScope.statistics.featureCount > 0);
  assert.ok(ordersScope.statistics.featureCount < workspace.statistics.featureCount);
  assert.ok(ordersScope.statistics.configurationItemCount > 0);
  const customers = analysis.tree.children.find((node) => node.label === "Customers");
  assert.ok(customers);
  assert.equal(localWorkspaceStatisticsForNode(analysis, customers.id).statistics.configurationItemCount, 0);
  const explicitViolation = structuredClone(analysis.features[0]);
  explicitViolation.dimensions.conformance = "NON_CONFORMING";
  assert.equal(calculateLocalWorkspaceStatistics([explicitViolation]).nonconformingFeatureCount, 1);
});
