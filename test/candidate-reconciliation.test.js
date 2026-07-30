import assert from "node:assert/strict";
import test from "node:test";

import { createCandidateEvidenceAllowset, reconcileCandidates, recordCandidateAbsence } from "../src/analysis/candidate-reconciliation.js";

test("reconciliation preserves duplicates, evidence conflicts, and absence without governance mutation", () => {
  const result = reconcileCandidates({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R",
    candidates: ["C1", "C2", "C3"].map((id) => ({
      id, projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
      kind: "CLAIM", subjectKey: "order",
      proposal: { statement: id === "C2" ? "denied" : "allowed" },
      evidenceFactIds: id === "C2" ? [] : ["F1"], sourceSliceIds: id === "C2" ? ["SL1"] : [],
      confidence: "LOW", producer: { modelCapabilityProfileId: "M", skillId: "K", skillVersion: "1" },
    })),
    evidenceAllowsets: {
      W: createCandidateEvidenceAllowset({
        projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
        factIds: ["F1"], sourceSliceIds: ["SL1"], confidenceCap: "LOW",
        routeDecision: { selected: [{ modelCapabilityProfileId: "M", skillId: "K", skillVersion: "1" }] },
      }),
    },
    candidateAbsences: [recordCandidateAbsence("OLD", "S")],
  });
  assert.ok(result.candidates.some(({ disposition }) => disposition === "DUPLICATE"));
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.candidateAbsences[0].status, "NO_CURRENT_OBSERVATION");
  assert.equal(result.candidateAbsences[0].retiresGovernedFeature, false);
});
