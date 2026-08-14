import assert from "node:assert/strict";
import test from "node:test";

import { reconcileWorkspaceAgentBatch, workspaceModelCandidateBatches, workspaceSourceManifest, workspaceSourceModule } from "../app/analysis-model-client.ts";
import { analyzeLocalWorkspaceRecords, applyLocalModelEnrichment, localWorkspaceAnalysisForTreeMode, scanLocalWorkspaceFile } from "../app/local-workspace-analysis.ts";

const workspaceContext = {
  projectId: "PROJECT-WEB",
  snapshotManifestId: "LOCAL-SNAPSHOT-WEB-001",
  analysisRunId: "ANALYSIS-WEB-001",
};

test("indexes evidence once and keeps large model batches bounded by count and serialized size", () => {
  const records = Array.from({ length: 5_000 }, (_, index) => {
    const candidate = {
      id: `FEATURE-${index}`, name: `Capability ${index}`, kind: "CODE_SYMBOL", method: null, modulePath: "src", sourcePath: `src/capability-${index}.ts`, startLine: 1,
      description: "Discovered exported capability.", code: `export function capability${index}() { return ${index}; }`,
    };
    return { scannerVersion: 4, path: candidate.sourcePath, size: 100, lastModified: 1, supported: true, candidates: [candidate], configuration: null, test: null };
  });
  const batches = workspaceModelCandidateBatches(records, "model-a", workspaceContext);
  assert.equal(batches.flat().length, 5_000);
  assert.equal(batches.every((batch) => batch.length <= 10 && JSON.stringify(batch).length <= 60_000), true);
});

test("does not enqueue model work already completed in the persisted checkpoint", () => {
  const completed = scanLocalWorkspaceFile({
    path: "src/completed.ts", size: 100, lastModified: 1, content: "export function completedCapability() {}",
  });
  const pending = scanLocalWorkspaceFile({
    path: "src/pending.ts", size: 100, lastModified: 1, content: "export function pendingCapability() {}",
  });
  const enriched = applyLocalModelEnrichment([completed, pending], "model-a", [{
    id: completed.candidates[0].id,
    displayName: "Completed capability",
    description: "Already analyzed in an earlier work unit.",
    businessFeature: true,
    businessKey: "completed.capability",
    businessModule: "Completed",
    businessSubmodule: "Completed",
    domain: "Completed",
    group: "BUSINESS_CAPABILITY",
    confidence: "LOW",
    rationale: "Persisted checkpoint result",
    evidenceFactIds: [completed.candidates[0].id],
  }]);

  const queued = workspaceModelCandidateBatches(enriched, "model-a", workspaceContext).flat();
  assert.deepEqual(queued.map((candidate) => candidate.id), [pending.candidates[0].id]);
});

test("Main Agent reconciles child results with scanner evidence and exposes provisional APIs immediately", () => {
  const record = scanLocalWorkspaceFile({
    path: "src/orders.ts",
    size: 120,
    content: "export function submitOrder() {}\nrouter.post('/orders', submitOrder);",
  });
  const batch = workspaceModelCandidateBatches([record], "model-a", workspaceContext).flat();
  const endpoint = batch.find((candidate) => candidate.kind === "ENDPOINT");
  const reconciliation = reconcileWorkspaceAgentBatch(batch, []);
  assert.equal(reconciliation.decisions.find((decision) => decision.candidateId === endpoint.id).outcome, "ADMITTED_API");
  assert.equal(reconciliation.enrichments.find((candidate) => candidate.id === endpoint.id).reconciliationStatus, "PROVISIONAL");

  const reconciledRecords = applyLocalModelEnrichment([record], "model-a", reconciliation.enrichments);
  const analysis = analyzeLocalWorkspaceRecords({ workspaceName: "Orders", projectId: "PROJECT-ORDERS", records: reconciledRecords });
  assert.equal(localWorkspaceAnalysisForTreeMode(analysis, "API").features.length, 1);
  assert.equal(localWorkspaceAnalysisForTreeMode(analysis, "BUSINESS").features.length, 0);
  assert.ok(workspaceModelCandidateBatches(reconciledRecords, "model-a", workspaceContext).flat().some((candidate) => candidate.id === endpoint.id));
});

test("builds Main Agent partitions from the repository source manifest rather than scanner candidates", () => {
  const manifest = workspaceSourceManifest([
    { path: "services/orders/src/OrderService.java", size: 800 },
    { path: "services/orders/src/OrderController.java", size: 500 },
    { path: "packages/web/app/page.tsx", size: 300 },
  ]);
  assert.equal(workspaceSourceModule("services/orders/src/OrderService.java"), "services/orders");
  assert.deepEqual(manifest, [
    { name: "services/orders", fileCount: 2, sourceBytes: 1300, languages: ["java"] },
    { name: "packages/web", fileCount: 1, sourceBytes: 300, languages: ["tsx"] },
  ]);
});
