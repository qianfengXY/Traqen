> Language: **English** · [简体中文](F001-legacy-system-understanding-validation-2026-07-29.zh-CN.md)

# F001 Legacy-System Understanding Implementation Validation

**Status:** implemented
**Feature truth:** `docs/features/F001-legacy-system-understanding.md`
**Implementation plan:** `feature-specs/2026-07-29-legacy-system-understanding-engine.md`

## Delivered

- Complete sealed `ArtifactInventory` with explicit included, excluded, unsupported, generated, binary, oversized, secret-redacted, and read-failed dispositions.
- Allowlisted local immutable Snapshot capture, symlink/path fencing, secret-safe capture, and Artifact-ID-only `SourceSlice` access.
- Deterministic Inventory-derived `UnderstandingPlan`, stable partitions, zero unassigned artifacts, bounded dynamic work-unit DAG, and explicit budget gaps.
- Versioned extractor and model capability contracts, Direct-source and Fact-dependent Skill modes, persisted route decisions, fail-closed producer selection, and independent Producer/Critic routing.
- Six separately observable understanding lanes, document/contract and test/config/result extractors, evidence-bounded Candidate reconciliation, ConflictLedger behavior, and explicit Candidate absence.
- Multi-dimensional reviewed evaluation with denominators, Truth Set leakage rejection, replay/incremental dimensions, and the `traqen-self-v1` calibration fixture.
- FULL-first and later AUTO-to-INCREMENTAL planning, affected/reused work-unit selection, equivalence checks, immutable GraphRevision history, evaluation-gated publication, and atomic CurrentGraphHead CAS in Memory and PostgreSQL.
- One durable server job phase sequence from source scan through publishing, pause/resume semantics, and fenced worker support.
- Current graph, graph revision history, Feature history, impact, publication, and SourceSlice APIs.
- GET-only Web reads for CurrentGraphHead and revision history, visually separated from local pre-governance Candidates.

## Validation

- Backend: 251/251 tests passed, including loopback HTTP, PostgreSQL migrations, controlled Runner, reference pilot, F001 adversarial cases, and Traqen two-Snapshot self-analysis.
- Web: production build and 41/41 tests passed.
- Web lint: passed.
- Diff whitespace check: passed.
- Traqen self-calibration: 30 anchors, 10 capabilities, 60 required relationships, 30 forbidden relationships, 100% Inventory disposition, FULL→INCREMENTAL head movement.

The committed Truth Set is calibration material. A production release may inject a separately controlled held-out Truth Set and independent reviewer identity without changing the runtime contract.
