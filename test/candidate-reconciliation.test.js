import assert from "node:assert/strict";
import test from "node:test";

import { reconcileCandidates, recordCandidateAbsence } from "../src/analysis/candidate-reconciliation.js";

test("reconciliation preserves duplicates, evidence conflicts, and absence without governance mutation", () => {
  const result = reconcileCandidates({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R",
    candidates: [
      { id: "C1", kind: "CLAIM", subjectKey: "order", proposal: { statement: "allowed" }, evidenceFactIds: ["F1"] },
      { id: "C2", kind: "CLAIM", subjectKey: "order", proposal: { statement: "denied" }, sourceSliceIds: ["SL1"] },
      { id: "C3", kind: "CLAIM", subjectKey: "order", proposal: { statement: "allowed" }, evidenceFactIds: ["F1"] },
    ],
    candidateAbsences: [recordCandidateAbsence("OLD", "S")],
  });
  assert.ok(result.candidates.some(({ disposition }) => disposition === "DUPLICATE"));
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.candidateAbsences[0].status, "NO_CURRENT_OBSERVATION");
  assert.equal(result.candidateAbsences[0].retiresGovernedFeature, false);
});
