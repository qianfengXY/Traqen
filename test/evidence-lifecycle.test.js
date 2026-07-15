import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import {
  createEvidenceLifecycleEvent,
  createEvidenceRetentionPolicy,
  evaluateEvidenceLifecycle,
} from "../src/domain/index.js";
import { PersistenceConflictError } from "../src/storage/index.js";

let now = Date.parse("2026-07-15T12:00:00.000Z");
const clock = () => new Date(now);

function policy(overrides = {}) {
  return createEvidenceRetentionPolicy({
    id: "POLICY-001",
    version: 1,
    dataClassification: "INTERNAL",
    evidenceTypes: ["TRACE", "LOG"],
    retentionDays: 30,
    archiveAfterDays: 7,
    legalHoldDefault: false,
    allowedAccessRoles: ["quality-owner", "auditor"],
    actorId: "GOVERNANCE-001",
    actorRole: "governance-owner",
    ...overrides,
  }, clock);
}

function event(id, action, overrides = {}) {
  return createEvidenceLifecycleEvent({
    id,
    evidenceId: "EVIDENCE-001",
    policyId: "POLICY-001",
    policyVersion: 1,
    action,
    reason: `${action} for policy validation`,
    actorId: "GOVERNANCE-001",
    actorRole: "governance-owner",
    ...overrides,
  }, clock);
}

const evidence = {
  id: "EVIDENCE-001",
  type: "TRACE",
  createdAt: "2026-07-01T00:00:00.000Z",
  contentHash: `sha256:${"a".repeat(64)}`,
};

test("Evidence retention keeps archive, deletion, and Legal Hold states independent", () => {
  let result = evaluateEvidenceLifecycle(evidence, policy(), [], clock);
  assert.equal(result.status, "ARCHIVE_DUE");
  const events = [
    event("EVENT-ARCHIVE", "ARCHIVED"),
    event("EVENT-HOLD", "LEGAL_HOLD_PLACED"),
    event("EVENT-DELETE-REQUEST", "DELETION_REQUESTED"),
  ];
  result = evaluateEvidenceLifecycle(evidence, policy(), events, clock);
  assert.equal(result.status, "DELETION_BLOCKED_LEGAL_HOLD");
  assert.equal(result.archived, true);
  assert.equal(result.deleted, false);

  events.push(event("EVENT-HOLD-RELEASE", "LEGAL_HOLD_RELEASED"));
  events.push(event("EVENT-DELETED", "DELETED", {
    deletionProof: {
      proofHash: `sha256:${"b".repeat(64)}`,
      storageProvider: "enterprise-object-store",
    },
  }));
  result = evaluateEvidenceLifecycle(evidence, policy(), events, clock);
  assert.equal(result.status, "DELETED");
  assert.equal(result.deletionProof.storageProvider, "enterprise-object-store");
  assert.equal(result.evidenceId, evidence.id);
});

test("retention policy rejects impossible windows and deletion events require irreversible proof", () => {
  assert.throws(() => policy({ archiveAfterDays: 31 }), /must not exceed retentionDays/);
  assert.throws(() => event("EVENT-DELETED", "DELETED"), /requires deletionProof/);
  assert.throws(
    () => event("EVENT-ACCESS", "ACCESSED", { deletionProof: { proofHash: `sha256:${"c".repeat(64)}`, storageProvider: "store" } }),
    /only valid for DELETED/,
  );
});

test("application policy blocks deletion under Legal Hold and audits allowed access roles", async () => {
  const retentionPolicy = policy();
  const events = [];
  let reviewer = { actorId: "GOVERNANCE-001", actorRole: "governance-owner" };
  const store = {
    async getEvidence() { return evidence; },
    async getEvidenceRetentionPolicy() { return retentionPolicy; },
    async listEvidenceLifecycleEvents() { return structuredClone(events); },
    async appendEvidenceLifecycleEvent(_projectId, value) { events.push(value); return value; },
  };
  const application = new TraceabilityApplication({
    store,
    clock,
    reviewerResolver: () => reviewer,
    reviewPolicyResolver: () => ({ allowedEvidenceLifecycleRoles: ["governance-owner"] }),
  });
  await application.appendEvidenceLifecycleEvent("PROJECT-001", evidence.id, {
    id: "EVENT-REQUEST-APP",
    policyId: retentionPolicy.id,
    policyVersion: retentionPolicy.version,
    action: "DELETION_REQUESTED",
    reason: "Retention period completed.",
  });
  await application.appendEvidenceLifecycleEvent("PROJECT-001", evidence.id, {
    id: "EVENT-HOLD-APP",
    policyId: retentionPolicy.id,
    policyVersion: retentionPolicy.version,
    action: "LEGAL_HOLD_PLACED",
    reason: "Active legal discovery.",
  });
  await assert.rejects(
    application.appendEvidenceLifecycleEvent("PROJECT-001", evidence.id, {
      id: "EVENT-DELETE-BLOCKED",
      policyId: retentionPolicy.id,
      policyVersion: retentionPolicy.version,
      action: "DELETED",
      reason: "Must be blocked.",
      deletionProof: { proofHash: `sha256:${"d".repeat(64)}`, storageProvider: "store" },
    }),
    PersistenceConflictError,
  );
  reviewer = { actorId: "AUDITOR-001", actorRole: "auditor" };
  const accessed = await application.appendEvidenceLifecycleEvent("PROJECT-001", evidence.id, {
    id: "EVENT-ACCESS-APP",
    policyId: retentionPolicy.id,
    policyVersion: retentionPolicy.version,
    action: "ACCESSED",
    reason: "Auditor inspected the derived Evidence manifest.",
  });
  assert.equal(accessed.accessEventCount, 1);
});
