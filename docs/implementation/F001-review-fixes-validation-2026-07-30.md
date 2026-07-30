> Language: **English** · [简体中文](F001-review-fixes-validation-2026-07-30.zh-CN.md)

# F001 Review Fixes Validation — 2026-07-30

## Scope

This validation closes the consensus findings recorded for F001 after commit `433a2d0`.

- The production bootstrap now owns one durable seven-phase legacy-understanding job.
- Source registrations are allowlisted and snapshot bytes are captured once, staged, verified, sealed, and then published.
- Candidate reconciliation uses an immutable evidence allowset bound to project, Snapshot, run, and WorkUnit.
- Evaluation fails closed when any required denominator is absent.
- Incremental invalidation follows the complete reverse-dependency closure.
- Graph revisions reference immutable graph artifacts resolved by CurrentGraphHead.
- The Web graph defaults to the CurrentGraphHead artifact when one is available and keeps Candidate authority visually distinct.
- Design, domain, JSON Schema, OpenAPI, store, and client vocabulary use the same ArtifactInventory and SourceSlice contract.

## Acceptance evidence

- Backend: 257 tests passed.
- Web: production build and 41 tests passed.
- Web lint: passed.
- Contract JSON parsing and contract tests: passed.
- Traqen-on-Traqen: a real source copy completed `FULL(snapshot-1) → INCREMENTAL(snapshot-2) → independent FULL(snapshot-2)` with equivalent semantic graph output.
- Regression coverage includes foreign SourceSlice evidence, snapshot mutation during capture, zero denominators, and a three-level dependency DAG.
- `git diff --check`: passed.

The implementation remains on the review branch and is not merged into `main`.
