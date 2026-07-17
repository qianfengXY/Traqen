import assert from "node:assert/strict";
import test from "node:test";

import { analyzeLocalWorkspace } from "../app/local-workspace-analysis.ts";

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

test("enforces bounded local-memory scanning", () => {
  assert.throws(
    () => analyzeLocalWorkspace({
      workspaceName: "Too Large",
      projectId: "PROJECT-TOO-LARGE",
      files: Array.from({ length: 23 }, (_, index) => ({ path: `src/file-${index}.js`, size: 768 * 1024, content: "export const value = 1;" })),
    }),
    /16 MB/,
  );
});
