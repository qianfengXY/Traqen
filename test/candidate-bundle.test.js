import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateKind,
  CandidateStatus,
  normalizeCandidateBundle,
  normalizeWorkUnit,
} from "../src/shared/candidate-bundle.js";

function workUnit(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    id: "WORK-UNIT-001",
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    analysisRunId: "ANALYSIS-001",
    factIds: ["FACT-001", "FACT-002"],
    rootFactIds: ["FACT-001"],
    ...overrides,
  };
}

function candidateBundle(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    id: "CANDIDATE-BUNDLE-001",
    projectId: "PROJECT-001",
    snapshotManifestId: "SNAPSHOT-001",
    analysisRunId: "ANALYSIS-001",
    workUnitId: "WORK-UNIT-001",
    producedAt: "2026-07-25T10:00:00.000Z",
    candidates: [{
      id: "CANDIDATE-001",
      kind: CandidateKind.FEATURE,
      status: CandidateStatus.PENDING_REVIEW,
      confidence: "MEDIUM",
      confidenceCap: "HIGH",
      evidenceFactIds: ["FACT-001"],
      proposal: { name: "Submit order", businessKey: "order.submit" },
      provenance: [{ producerType: "MODEL", producerId: "MODEL-001", producerVersion: "1.0.0" }],
    }],
    ...overrides,
  };
}

test("normalizes a Snapshot-bound CandidateBundle against its exact WorkUnit", () => {
  const unit = normalizeWorkUnit(workUnit());
  const bundle = normalizeCandidateBundle(candidateBundle(), unit);

  assert.deepEqual(unit.factIds, ["FACT-001", "FACT-002"]);
  assert.equal(bundle.candidates[0].kind, "CANDIDATE_FEATURE");
  assert.deepEqual(bundle.candidates[0].evidenceFactIds, ["FACT-001"]);
  assert.equal(Object.isFrozen(bundle), true);
});

test("rejects Candidate conclusions without evidenceFactIds", () => {
  const input = candidateBundle();
  delete input.candidates[0].evidenceFactIds;
  assert.throws(
    () => normalizeCandidateBundle(input, normalizeWorkUnit(workUnit())),
    /evidenceFactIds must contain at least one Fact/,
  );
});

test("rejects Candidate evidence outside the bounded WorkUnit", () => {
  const input = candidateBundle();
  input.candidates[0].evidenceFactIds = ["FACT-OUTSIDE"];
  assert.throws(
    () => normalizeCandidateBundle(input, normalizeWorkUnit(workUnit())),
    /outside WorkUnit WORK-UNIT-001: FACT-OUTSIDE/,
  );
});

test("rejects duplicate evidence instead of inflating support", () => {
  const input = candidateBundle();
  input.candidates[0].evidenceFactIds = ["FACT-001", "FACT-001"];
  assert.throws(
    () => normalizeCandidateBundle(input, normalizeWorkUnit(workUnit())),
    /evidenceFactIds must not contain duplicates/,
  );
});

test("rejects a CandidateBundle that crosses project, Snapshot, run, or WorkUnit identity", () => {
  const unit = normalizeWorkUnit(workUnit());
  for (const [field, value] of [
    ["projectId", "PROJECT-OTHER"],
    ["snapshotManifestId", "SNAPSHOT-OTHER"],
    ["analysisRunId", "ANALYSIS-OTHER"],
    ["workUnitId", "WORK-UNIT-OTHER"],
  ]) {
    assert.throws(
      () => normalizeCandidateBundle(candidateBundle({ [field]: value }), unit),
      new RegExp(`${field} must match WorkUnit`),
    );
  }
});

test("rejects WorkUnits with duplicate Facts or roots outside their Fact boundary", () => {
  assert.throws(
    () => normalizeWorkUnit(workUnit({ factIds: ["FACT-001", "FACT-001"] })),
    /factIds must not contain duplicates/,
  );
  assert.throws(
    () => normalizeWorkUnit(workUnit({ rootFactIds: ["FACT-OUTSIDE"] })),
    /rootFactIds must be members of factIds: FACT-OUTSIDE/,
  );
});

test("rejects model confidence above the deterministic evidence cap", () => {
  const input = candidateBundle();
  input.candidates[0].confidence = "HIGH";
  input.candidates[0].confidenceCap = "MEDIUM";
  assert.throws(
    () => normalizeCandidateBundle(input, normalizeWorkUnit(workUnit())),
    /confidence HIGH exceeds evidence cap MEDIUM/,
  );
});
