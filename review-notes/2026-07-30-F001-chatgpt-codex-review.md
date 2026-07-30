---
feature_ids: [F001]
topics:
  - legacy-system-understanding
  - implementation-review
  - correctness
  - security
  - incremental-analysis
  - dogfood
doc_kind: review
created: 2026-07-30
reviewer: CodeX / ChatGPT (GPT-5)
reviewed_sha: 433a2d043f3f9f6bff77a0768d67e063b32173b9
design_sha: 0855e39c2de565bf2031aebdcc733e7453187bb6
---

# F001 Implementation Review — ChatGPT / CodeX

> Reviewer identity: **CodeX / ChatGPT (GPT-5)**
> Implementation: `codex/f001-legacy-system-understanding` at `433a2d0`
> Design baseline: `design/f001-legacy-system-understanding` at `0855e39`
> Review mode: independent finding generation; this document is distinct from Kimi's review.

## Outcome

The implementation cannot yet be treated as delivery of F001's core product requirement.
It adds useful contracts, domain objects, storage primitives, and focused unit tests, but the
production pipeline is not wired end to end and the committed acceptance test does not prove
that Traqen actually understands Traqen.

## Findings

### CX-1 — P1 — The production F001 journey is not wired

Repository-wide call-site inspection found no production composition of:

- `LocalSourceSnapshotCapture`;
- `createUnderstandingPlan`;
- `routeAnalysisWorkUnit`;
- `reconcileCandidates`;
- `evaluateUnderstanding`;
- `WorkspaceAnalysisJobRunner`.

`src/api/application-bootstrap.js:51-95` only adds the SourceSlice Broker. The existing
AnalysisRun path still requires deterministic Facts and passes only a FactGraph to the old
Analysis Agent (`src/application/traceability-application.js:1278-1317`). The browser still
executes `scanLocalWorkspaceFile()` and `analyzeLocalWorkspaceRecords()` before uploading
derived observations (`web/app/traqen-product.tsx:2653-2763`).

The new current-graph endpoint returns only `{ head, revision }`
(`src/application/traceability-application.js:2346-2358`), while
`contracts/graph-revision.schema.json` contains no graph payload or immutable graph reference.
The Web change renders only a CurrentGraphHead status card, not the published Candidate or
governed graph.

Impact: an operator cannot start the designed Snapshot → Inventory → lanes → planner → router
→ reconciliation → evaluation → projection → publishing journey, and AC-B1–B7, AC-E1–E4,
AC-F3, AC-F4, and AC-F7 have no runtime path.

Required correction:

1. Compose the new runtime in the application bootstrap.
2. Expose durable start/read/pause/resume commands for the new job.
3. Make every phase handler persist and consume the preceding phase's typed output.
4. Persist an immutable graph artifact and make CurrentGraphHead-backed graph/tree/trace reads
   resolve that artifact.
5. Remove browser-owned authoritative scanning and semantic analysis after cutover.

### CX-2 — P1 — The Traqen self-acceptance test copies its answer key

`test/traqen-self-acceptance.test.js:60-80` passes Truth Set anchors and required relationships
directly into `observedAnchorIds` and `observedRelationships`. Candidate precision, source
attribution, gap honesty, replay equivalence, and incremental equivalence are also hand-written
passing values.

The second Snapshot is fabricated by changing one Inventory digest
(`test/traqen-self-acceptance.test.js:84-109`); no source snapshot is captured and no WorkUnit,
model/Skill, reconciliation, CandidateGraph, TraceChain, or Impact path runs. The test then
publishes placeholder GraphRevision objects without the required GraphRevision contract fields
(`test/traqen-self-acceptance.test.js:111-124`).

Impact: the test proves only that an evaluator can compare values supplied by the test itself.
It does not prove AC-F1–F7, and the implementation validation document's “implemented” claim is
not supported.

Required correction:

1. Generate observations exclusively from the production F001 pipeline.
2. Load held-out acceptance truth from the governed external path, with no calibration fallback.
3. Capture two real immutable Traqen Snapshots and run FULL followed by INCREMENTAL plus the
   required FULL comparison.
4. Assert the produced graph, TraceChain, ChangeSet, ImpactAssessment, revalidation plan, and UI.

### CX-3 — P1 — Empty evaluation denominators pass

`src/application/understanding-evaluator.js:3-5` defines a zero-denominator ratio as `1`.
Only anchor and required-relationship minimums are enforced
(`src/application/understanding-evaluator.js:41-46`).

A focused counterexample with 30 anchors and 60 required relationships, but zero Candidate
samples, zero forbidden relationships, zero source attributions, and zero gap samples returned:

```json
{
  "status": "PASSED",
  "candidateSample": 0,
  "forbiddenRelationships": 0,
  "sourceAttributions": 0,
  "gaps": 0
}
```

Impact: an empty or unevaluated graph can satisfy the evaluation gate and become
CurrentGraphHead, contradicting AC-D1, AC-D2, AC-D6, and AC-F2.

Required correction:

- version all minimum denominators in EvaluationPolicy;
- distinguish `NOT_EVALUATED` from a perfect score;
- require the complete `traqen-self-v1` denominator contract before `PASSED`;
- make graph publication validate the policy/version and required denominators, not only
  `evaluation.status`.

### CX-4 — P1 — Incremental invalidation stops after one dependency level

`src/application/incremental-understanding.js:24-32` checks changed Artifact IDs on the WorkUnit
itself and one direct dependency only. It does not traverse the dependency DAG transitively.

Using the real planner, a changed leaf produced:

```json
{
  "affected": ["LEAF", "MODULE_SYNTHESIS"],
  "reused": ["PROJECT_SYNTHESIS"]
}
```

`PROJECT_SYNTHESIS` depends on `MODULE_SYNTHESIS`, whose `artifactIds` are empty, so the stale
project conclusion is reused.

Impact: an incremental GraphRevision can publish stale cross-module/project knowledge and fail
FULL/INCREMENTAL equivalence, violating AC-D4, AC-D7, and AC-F7.

Required correction: compute the reverse dependency closure from every changed/removed Artifact
through all dependent WorkUnits, then generate the revalidation plan and reuse set from that
closure.

### CX-5 — P1 — Direct-source evidence can escape its WorkUnit

`src/analysis/skill-adapters.js:70-85` returns model/Skill-supplied `sourceSliceIds` after
deduplication but never checks them against the SourceSlices actually returned by the Broker.
`src/analysis/candidate-reconciliation.js:7-16` checks only that some evidence identifier exists.

A focused counterexample had the Broker return `SLICE-ALLOWED`, while the producer cited
`SLICE-FOREIGN`; both the adapter and reconciliation accepted `SLICE-FOREIGN`.

Impact: a producer can cite another WorkUnit/Snapshot or a nonexistent SourceSlice, violating
AC-B3, SR-005, and the core evidence boundary.

Required correction: validate Candidate identity, Snapshot, WorkUnit, Fact IDs, SourceSlice IDs,
confidence caps, and producer route against an immutable allowed-evidence set before
reconciliation.

### CX-6 — P1 — Snapshot capture has a scan/copy race

`LocalSourceSnapshotCapture.capture()` scans the live root and later copies those files
(`src/application/local-source-snapshot.js:16-40`) without reopening through a fenced handle or
revalidating content digest.

A deterministic counterexample changed a source file after the scan returned but before
`copyFile()`. The resulting Snapshot contained the new bytes while ArtifactInventory retained
the old digest:

```json
{
  "snapshotContent": "NEW",
  "matches": false
}
```

Impact: SourceSlices, Candidates, and evaluation can operate on bytes different from the sealed
Inventory/Manifest. Symlink or file-replacement races can also cross the checked source
boundary after enumeration.

Required correction: capture bytes once through descriptor-based fencing, compute the digest
from the captured bytes, atomically install them into a staging Snapshot, verify the full
Inventory, and only then seal/rename the Snapshot.

## Additional incompleteness

- Reconciliation implements exact duplicate grouping and simple statement conflicts only; it
  does not implement hierarchy, alternative explanations, or cross-Snapshot lineage.
- Job runner tests use dummy handlers for every phase and do not exercise the actual F001
  components.
- An aborted `WorkspaceAnalysisJobRunner.run()` returns `PAUSED` without persisting that state.
- Job checkpoints are stored as `WORK_UNIT` records despite not satisfying the
  `UnderstandingWorkUnit` schema.
- Graph publication does not require an INCREMENTAL revision to reference a real ChangeSet,
  ImpactAssessment, equivalence report, or revalidation plan.
- The publish endpoint records neither publisher identity nor reason.
- Several new OpenAPI success responses have descriptions but no response schema.

## Verification performed

After explicitly installing development dependencies:

| Gate | Result |
|---|---|
| `env -u NODE_ENV npm test` | 251/251 pass |
| `npm --prefix web test` | production build + 41/41 pass |
| `npm --prefix web run lint` | pass |
| `git diff --check origin/design/f001-legacy-system-understanding..433a2d0` | pass |

The green suite demonstrates component-level consistency. The focused counterexamples above
demonstrate missing invariant coverage.

## Completion assessment

| F001 area | Assessment |
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

*Finding generator only — not merge approval authority. Kimi's independent review is stored
separately and must retain Kimi's own identity and wording.*

[CodeX/GPT-5🐾]
