---
feature_ids: [F001]
topics:
  - legacy-system-understanding
  - implementation-review
  - second-round
doc_kind: review
created: 2026-07-30
reviewer: Kimi/Kimi 3 (@kimi)
target_branch: codex/f001-legacy-system-understanding
target_sha: 1682d7dac9270fb5849bd1d5cfe719b4361b3f24
---

# F001 Implementation Review — Kimi Second Round

> Review of `codex/f001-legacy-system-understanding` at `1682d7d` after Codex fix commit.

## Verification performed

| Gate | Result |
|---|---|
| Backend tests | 257/257 pass |
| Web build + tests | 41/41 pass |
| Web lint | pass |
| `git diff --check` | clean |

## First-round findings that are now closed

| Finding | Status | Evidence |
|---|---|---|
| Production F001 pipeline not wired | ✅ Fixed | `src/application/legacy-understanding-runtime.js` implements all seven phases; `src/api/application-bootstrap.js:69-77` registers it; HTTP endpoints for source-registrations and workspace-analysis-jobs exist (`src/api/http-server.js:921-978`). |
| Traqen self-acceptance circular | ✅ Fixed | `test/traqen-self-acceptance.test.js:45-117` now runs real `FULL → INCREMENTAL → independent FULL` through the runtime on copied source. |
| Empty denominators pass evaluation | ✅ Fixed | `src/application/understanding-evaluator.js:3-5` returns `null` for zero denominators; `NOT_EVALUATED` status enforced; `test/understanding-evaluation.test.js:49-66` covers it. |
| Incremental invalidation one-level | ✅ Fixed | `src/application/incremental-understanding.js:29-46` computes reverse dependency closure transitively; `test/incremental-understanding.test.js:33-48` verifies three-level invalidation. |
| SourceSlice evidence escape | ✅ Fixed | `src/analysis/candidate-reconciliation.js:23-49` validates candidates against immutable evidence allowset; `test/source-slice-broker.test.js:58-77` rejects foreign slices. |
| Snapshot scan/copy race | ✅ Fixed | `src/scanner/artifact-inventory-scanner.js:109-119` opens file descriptor, checks before/after stat; `src/application/local-source-snapshot.js:25-56` stages and verifies digests before sealing; `test/local-source-snapshot.test.js:44-72` covers mutation during capture. |
| GraphRevision without graph payload | ✅ Fixed | New `contracts/immutable-graph-artifact.schema.json`; `GraphRevision` includes `graphArtifactId`/`graphArtifactDigest`; `/graph/current` resolves artifact (`src/application/traceability-application.js:2403-2424`). |
| UI only status card | ✅ Fixed | `web/app/traqen-product.tsx:378-413` converts `graphArtifact` to Cytoscape graph; `web/app/traqen-product.tsx:3044-3059` loads and renders published graph. |
| Contract/design drift | ✅ Fixed | `artifact-inventory.schema.json` now uses `artifactKinds`, `mediaType`, `relativePath`, `EXCLUDED_BY_POLICY`; `source-slice.schema.json` uses `selectors: Array`. |

## Remaining gaps and observations

### R1 — Runtime evaluation is an invariant gate, not a reviewed correctness evaluation

`src/application/legacy-understanding-runtime.js:488-555` computes synthetic denominators from the produced candidates/facts and hardcodes most metrics to `1` when `status === PASSED`. It does not load or compare against the held-out `traqen-self-calibration-v1` truth set.

Impact: the publication gate verifies "something was produced" and "no unresolved conflicts exist", but it does not measure anchor recall, candidate precision, required/forbidden relation correctness, or gap honesty against reviewed truth. AC-D1/D2 and AC-F2's correctness thresholds are not actually enforced.

Suggestion: after the production run completes, load the external truth set (excluded from production inputs) and run `evaluateUnderstanding` with real observed values; require `PASSED` and all `traqen-self-v1` denominators before publication.

### R2 — Analysis phase is deterministic regex, not model/Skill producers

The runtime registers three `ExtractorCapability` records (`src/application/legacy-understanding-runtime.js:198-217`) and one hardcoded `LOCAL-DETERMINISTIC-PROFILE` + `legacy-understanding-runtime` skill (`src/application/legacy-understanding-runtime.js:326-374`). It never invokes real model adapters or independent producer groups. `routeAnalysisWorkUnit` is called but always has exactly one eligible route.

Impact: AC-B7 (verified model capability/calibration profiles, independent producer groups, critic routing) is not exercised in the runnable path. The system cannot discover capabilities that the regex extractors miss.

Suggestion: keep the deterministic runtime as a baseline, but wire at least one optional model-backed lane and demonstrate independent producer/critic routing before claiming AC-B7 complete.

### R3 — TraceChain generation is a placeholder

`src/application/legacy-understanding-runtime.js:607-615` creates trace chains for only `bundle.candidates.slice(0, 1)` and marks them `CANDIDATE_REVIEW_REQUIRED`. It does not construct requirement → design → code → test → execution → evidence chains.

Impact: AC-F4 (complete reviewed TraceChain) is not delivered.

### R4 — Incremental delta is node-ID based, not semantic

`src/application/legacy-understanding-runtime.js:654-691` compares only node ID sets between base and current graphs. A semantic change that keeps the same candidate ID (e.g., a function renamed inside the same file) will not be detected.

Impact: AC-D7 change impact and AC-D4 FULL/INCREMENTAL equivalence may miss semantic changes that preserve IDs.

### R5 — Impact assessment is shallow

The impact assessment produced in `#incrementalDelta` only lists `affectedNodeIds` and generic actions `REVIEW_CHANGED_CANDIDATES`, `RERUN_AFFECTED_TESTS`. It does not map affected nodes to Features, Claims, TestSpecs, or Decisions.

Impact: AC-D7's affected Feature/Claim/TestSpec/dependency set is not produced.

### R6 — Database schema still has cross-type ID collision risk

`db/migrations/0014_legacy_understanding_engine.sql:16-17` keeps both `PRIMARY KEY (project_id, record_type, id)` and `UNIQUE (project_id, id)`. Different `record_type`s with the same `id` will violate the unique constraint.

Impact: potential runtime conflict when, for example, a `GAP` record and a `WORK_UNIT` record happen to share an ID.

Suggestion: drop `UNIQUE (project_id, id)` or make it include `record_type`.

### R7 — Dead code remains in candidate reconciliation

`src/analysis/candidate-reconciliation.js:60-62` checks `summaryEvidence` after the previous line already threw for empty evidence. This branch is unreachable.

### R8 — No tests for pause/resume/cancel of workspace understanding jobs

`WorkspaceAnalysisJobRunner` now supports `pause`, `resume`, `fail`, `cancel` (`src/application/workspace-analysis-job-runner.js:133-189`), but neither `test/workspace-analysis-job-runner.test.js` nor `test/http-understanding-runtime.test.js` exercises these transitions.

### R9 — Browser still owns fallback scanning path

`web/app/traqen-product.tsx` still executes `scanLocalWorkspaceFile` and `analyzeLocalWorkspaceRecords` in the browser. The new server-owned endpoints exist, but the browser path has not been removed or clearly demoted to a non-authoritative cache.

Impact: AC-E4 (browser contains no authoritative scanning or model loop after cutover) is not yet satisfied.

### R10 — Publication minimums are very low

`src/application/legacy-understanding-runtime.js:47-57` sets `publicationMinimums` to `1` for every dimension. A repository with a single file, a single function, and a single candidate will pass.

Impact: AC-F2's requirement of 30 anchors / 60 required relations / 30 forbidden relations is not enforced by the runtime gate.

## Completion assessment

| F001 area | Assessment |
|---|---|
| Inventory and immutable Snapshot | ✅ Substantially complete; staging + digest verification works |
| Planner and capability routing | ⚠️ Planner complete; routing is a deterministic placeholder |
| Independent Agent/Skill understanding | ⚠️ Regex extractors only; no real model/Skill lane |
| Reconciliation and evidence boundary | ✅ Evidence allowset validation is in place |
| Correctness evaluation | ⚠️ Invariant gate only; truth-set evaluation not wired in runtime |
| FULL/INCREMENTAL | ⚠️ Runs end-to-end; delta is ID-based; equivalence function exists but not deeply exercised |
| Durable lifecycle | ✅ Wired; pause/resume/cancel exist but not tested |
| Canonical graph and UI | ✅ Published graph artifact rendered; trace chain placeholder |
| Traqen-on-Traqen acceptance | ⚠️ Real pipeline runs; truth-set correctness not evaluated |

## Overall

The fix commit is a major step forward: F001 now has a runnable, tested, seven-phase server-owned pipeline that addresses all six consensus P1 blockers. It is no longer "scaffolding without a runtime".

However, the pipeline is still a **deterministic baseline** rather than the full Agent/Skill understanding engine described in F001. The correctness evaluation, independent model routing, semantic incremental delta, complete TraceChain, and browser cutover remain incomplete. These should be treated as the next implementation slice before F001 can be considered fully delivered.

---

*Finding generator only; not merge approval authority.*

[Kimi 3/Kimi🐾]
