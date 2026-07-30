---
feature_ids: [F001]
topics:
  - legacy-system-understanding
  - implementation-review
  - common-findings
  - cross-check
doc_kind: review
created: 2026-07-30
reviewers:
  - Kimi/Kimi 3 (@kimi)
  - CodeX / ChatGPT (GPT-5)
target_branch: codex/f001-legacy-system-understanding
target_sha: 433a2d043f3f9f6bff77a0768d67e063b32173b9
---

# F001 Implementation Review — Common Findings

> Cross-checked review of `codex/f001-legacy-system-understanding` at `433a2d0`.
> Individual reviews:
> - [Kimi Review](./2026-07-29-f001-legacy-system-understanding-kimi-review.md)
> - [ChatGPT / CodeX Review](./2026-07-30-F001-chatgpt-codex-review.md)
>
> This document contains only findings that both reviewers independently reached and agree should block or materially shape the next implementation round.

## Joint Outcome

The implementation adds valuable contracts, domain objects, storage primitives, and focused unit tests, but **cannot yet be treated as delivery of F001's core product requirement**. Both reviewers found the same fundamental gap: the new F001 components are not wired into a runnable end-to-end pipeline, and the committed acceptance test does not prove that Traqen actually understands Traqen.

## Common Findings

### CF-1 — P1 — The F001 production pipeline is not wired end to end

Both reviewers independently confirmed that:

- `LocalSourceSnapshotCapture`, `createUnderstandingPlan`, `routeAnalysisWorkUnit`, `reconcileCandidates`, `evaluateUnderstanding`, and `WorkspaceAnalysisJobRunner` are implemented and exported, but **no production code composes or invokes them**.
- `src/api/application-bootstrap.js` only registers the `SourceSliceBroker`; it does not instantiate the job runner or connect the phase handlers.
- The existing HTTP `/analysis-runs` endpoints still use the old `AnalysisAgent` path, which requires deterministic Facts and never uses the new Inventory/planner/router/reconciler/evaluator flow (`src/application/traceability-application.js:1309-1372`).
- The browser still executes `scanLocalWorkspaceFile()` and `analyzeLocalWorkspaceRecords()` before uploading observations.
- The new `/graph/current` endpoint returns only head and revision metadata; `GraphRevision` carries no graph payload or immutable graph reference, and the Web UI renders only a status card, not the published Candidate or governed graph.

**Impact:** An operator cannot run the designed Snapshot → Inventory → lanes → planner → router → reconciliation → evaluation → projection → publishing journey. AC-B1–B7, AC-E1–E4, AC-F3, AC-F4, and AC-F7 have no runtime path.

**Joint recommendation:**
1. Compose the new runtime in the application bootstrap.
2. Expose durable start/read/pause/resume commands for the new job.
3. Make every phase handler persist and consume the preceding phase's typed output.
4. Persist an immutable graph artifact and make CurrentGraphHead-backed graph/tree/trace reads resolve that artifact.
5. Remove browser-owned authoritative scanning and semantic analysis after cutover.

---

### CF-2 — P1 — The Traqen self-acceptance test is circular

Both reviewers found that `test/traqen-self-acceptance.test.js` does not validate real extraction:

- It passes Truth Set anchors and required relationships directly into `observedAnchorIds` and `observedRelationships`.
- Candidate precision, source attribution, gap honesty, replay equivalence, and incremental equivalence are hand-written passing values.
- The second Snapshot is fabricated by mutating one Inventory digest; no source snapshot is captured, no WorkUnit runs, no reconciliation, CandidateGraph, TraceChain, or Impact path executes.
- The test publishes placeholder GraphRevision objects without exercising the required GraphRevision fields and gates.

**Impact:** The test proves only that the evaluator can compare values supplied by the test itself. It does not prove AC-F1–F7, and the implementation validation document's “implemented” claim is not supported by product evidence.

**Joint recommendation:**
1. Generate observations exclusively from the production F001 pipeline.
2. Load held-out acceptance truth from an external governed path with no calibration fallback.
3. Capture two real immutable Traqen Snapshots and run FULL followed by INCREMENTAL plus the required FULL comparison.
4. Assert the produced graph, TraceChain, ChangeSet, ImpactAssessment, revalidation plan, and UI.

---

### CF-3 — P1 — Empty evaluation denominators can pass

Both reviewers identified that `src/application/understanding-evaluator.js:3-5` returns `1` for zero-denominator ratios. Only anchor and required-relationship minimums are enforced. A counterexample with zero Candidate samples, zero forbidden relationships, zero source attributions, and zero gap samples can still yield `status: "PASSED"`.

**Impact:** An empty or unevaluated graph can satisfy the evaluation gate and become CurrentGraphHead, contradicting AC-D1, AC-D2, AC-D6, and AC-F2.

**Joint recommendation:**
- Version all minimum denominators in `EvaluationPolicy`.
- Distinguish `NOT_EVALUATED` from a perfect score.
- Require the complete `traqen-self-v1` denominator contract before `PASSED`.
- Make graph publication validate policy/version and required denominators, not only `evaluation.status`.

---

### CF-4 — P1 — Incremental invalidation only propagates one dependency level

Both reviewers confirmed that `src/application/incremental-understanding.js:24-32` checks changed Artifact IDs on the WorkUnit itself and one direct dependency only. It does not traverse the dependency DAG transitively. A real planner counterexample showed a changed leaf marking the Leaf and `MODULE_SYNTHESIS` as affected, while `PROJECT_SYNTHESIS` was incorrectly listed as reused.

**Impact:** An incremental GraphRevision can publish stale cross-module/project knowledge and fail FULL/INCREMENTAL equivalence, violating AC-D4, AC-D7, and AC-F7.

**Joint recommendation:** Compute the reverse dependency closure from every changed/removed Artifact through all dependent WorkUnits, then generate the revalidation plan and reuse set from that closure.

---

### CF-5 — P1 — Direct-source evidence can escape its authorized boundary

Both reviewers found that `src/analysis/skill-adapters.js:70-85` returns model-supplied `sourceSliceIds` without validating them against the slices actually returned by the broker, and `src/analysis/candidate-reconciliation.js:7-16` only checks that some evidence identifier exists. A counterexample showed the broker returning `SLICE-ALLOWED` while the producer cited `SLICE-FOREIGN`, which was accepted.

**Impact:** A producer can cite another WorkUnit, another Snapshot, or a nonexistent SourceSlice, violating AC-B3 and the core evidence boundary.

**Joint recommendation:** Validate Candidate identity, Snapshot, WorkUnit, Fact IDs, SourceSlice IDs, confidence caps, and producer route against an immutable allowed-evidence set before reconciliation.

---

### CF-6 — P1 — Snapshot capture has a scan/copy race

Both reviewers independently identified that `LocalSourceSnapshotCapture.capture()` scans the live root and later copies those files (`src/application/local-source-snapshot.js:16-40`) without reopening through a fenced handle or revalidating content digest. A deterministic counterexample changed a source file after the scan returned but before `copyFile()`, producing a Snapshot whose bytes differ from the sealed Inventory digest.

**Impact:** SourceSlices, Candidates, and evaluation can operate on bytes different from the sealed Inventory/Manifest. Symlink or file-replacement races can also cross the checked source boundary after enumeration.

**Joint recommendation:** Capture bytes once through descriptor-based fencing, compute the digest from the captured bytes, atomically install them into a staging Snapshot, verify the full Inventory, and only then seal/rename the Snapshot.

---

## Additional Joint Observations

These items were noted by at least one reviewer and not contradicted by the other:

- **Reconciliation incompleteness:** It implements exact duplicate grouping and simple statement conflicts only; hierarchy, alternative explanations, and cross-Snapshot lineage are not implemented.
- **Job runner tests are shallow:** They use dummy handlers for every phase and do not exercise the actual F001 components; pause/resume semantics are not covered.
- **Checkpoint schema mismatch:** Job checkpoints are stored as `WORK_UNIT` records despite not satisfying the `UnderstandingWorkUnit` schema.
- **Graph publication metadata gaps:** INCREMENTAL revision publication does not require a real ChangeSet, ImpactAssessment, equivalence report, or revalidation plan; publisher identity and reason are not recorded.
- **OpenAPI response schemas missing:** Several new success responses (e.g., `/graph/current`, `/graph/revisions`, `/analysis-runs/{id}/source-slices`) have descriptions but no response schema.
- **Design/contract/implementation drift:** Disposition naming (`EXCLUDED` vs design's `EXCLUDED_BY_POLICY`), single `kind` vs design's `artifactKinds` array, and SourceSlice single-artifact vs design's `selectors: Array` are inconsistent.

## Verification Performed by Both Reviewers

| Gate | Result |
|---|---|
| Backend tests | 251/251 pass (after explicit dev dependency install) |
| Web build + tests | 41/41 pass |
| Web lint | pass |
| `git diff --check` | clean |

The green test suite demonstrates component-level consistency. The focused counterexamples above demonstrate missing invariant coverage.

## Completion Assessment

| F001 area | Joint assessment |
|---|---|
| Inventory and contracts | partial foundation; Snapshot race remains |
| Planner and capability routing | standalone components, not executed in production |
| Independent Agent/Skill source understanding | no end-to-end runtime; evidence escape exists |
| Reconciliation and correctness evaluation | incomplete and false-pass capable |
| FULL/INCREMENTAL | metadata primitives exist; transitive invalidation/equivalence journey absent |
| Durable lifecycle | generic runner skeleton, not wired |
| Canonical graph and UI | no published graph artifact or CurrentGraphHead-backed graph view |
| Traqen-on-Traqen acceptance | not performed; current test is circular |

---

*Common finding generator — not merge approval authority. For reviewer-specific wording and additional individual findings, see the linked individual review files.*

[Kimi 3/Kimi🐾] + [CodeX/GPT-5🐾]
