> Language: **English** · [简体中文](traqen-system-requirements.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-requirements, legacy-system, traceability, evidence, governance]
doc_kind: product-requirements
created: 2026-07-29
updated: 2026-08-29
---

# Traqen System Requirements: Evidence-Based Legacy-System Understanding

## 1. Mission

Traqen must let a responsible architect understand a legacy system from its available documents, code, tests, configuration, and execution evidence; preserve how each conclusion was reached; and use that understanding to guide the next change safely.

The system's answer is trustworthy only to the extent that its source version, evidence, authority, uncertainty, and coverage are visible.

## 2. Core requirements

### R1 — Versioned source truth

The system shall register a source under an explicit access policy and create an immutable source snapshot before analysis. Every discovered artifact shall be inventoried and assigned one explicit disposition, including material that is excluded, unsupported, unreadable, redacted, or failed.

### R2 — Reproducible technical evidence

The system shall derive deterministic facts only through versioned extractors and shall retain source location, derivation, and reproducibility data. It shall record a coverage gap whenever it cannot establish a fact or relation.

### R3 — Separate API and business authority

The system shall publish an API-structure tree from deterministic endpoint/operation/handler/contract evidence where available. It shall publish a business-function tree only from human-reviewed claims. Neither tree may silently absorb an assertion created at a lower authority level.

### R4 — Bounded Agent reasoning

The system may use one or more analysis Agents to create semantic candidates, but every candidate shall retain run provenance, source/evidence boundary, uncertainty, and review state. Model agreement, confidence, or a majority count shall not promote a candidate to a claim.

### R5 — Human publication decision

The system shall support review decisions that approve, reject, request additional evidence, supersede, or mark a candidate stale. A rejected, superseded, or stale candidate shall remain auditable without appearing as current business truth.

### R6 — Execution is not a source reference

The system shall distinguish static test assets, test specifications, and actual test executions. An execution record shall identify at least the source snapshot, runner, environment, time, outcome, and linked run evidence. A static reference cannot be displayed as a passed execution.

### R7 — Bounded impact guidance

For a declared change between source snapshots, the system shall produce advisory paths through deterministic facts, reviewed claims, and execution evidence. Each finding shall be `CONFIRMED`, `POSSIBLE`, or `UNKNOWN`, with source-bound support and coverage limits. No-impact may be stated only with relevant coverage proof; otherwise the result is `UNKNOWN`.

### R8 — Safe source handling

Raw source content shall remain inside the workspace access boundary unless an F006 configuration explicitly authorizes the actor and egress path. The system shall preserve the policy and retention context that governed an Agent or extractor run.

### R9 — No hidden enforcement

The initial impact workflow shall be advisory. It shall not automatically block CI, merge, release, deployment, or production data operations.

## 3. Required information model

| Record | Required provenance |
| --- | --- |
| `Workspace` | registered source locator, access policy, responsible owner |
| `SourceSnapshot` | immutable ID, source revision where available, content digest, capture time, scanner version |
| `ArtifactInventoryItem` | snapshot, artifact locator, kind, digest, disposition and reason |
| `Fact` / `EvidenceLink` | snapshot, source range, extractor derivation, reproducibility token |
| `Candidate` | Agent/run identity, evidence boundary, assumptions, uncertainty, review state |
| `Claim` | review decision, reviewer authority, linked candidate(s) and evidence |
| `TestExecution` | snapshot, runner, environment, time, result, run evidence |
| `ChangeSet` / impact finding | compared snapshots, classification, path, gaps, recommendation |
| `CoverageGap` | affected scope, discovered limitation, follow-up state |

All records are append-only or versioned. Corrections create a new derivation, decision, or revision; they do not erase the prior basis.

## 4. User-visible behavior

An architect must be able to:

1. register a source and inspect exactly what was or was not analyzed;
2. inspect the API tree and trace every displayed structural node to source evidence;
3. run approved analysis Agents and compare their candidates without losing independent outputs;
4. review a candidate before it becomes business truth;
5. inspect the business tree together with its claims, APIs, code, documentation, tests, configuration, and known gaps; and
6. compare two snapshots and obtain explicit revalidation advice rather than an unsupported assurance.

## 5. Quality constraints

- **Traceability:** A published node, edge, recommendation, or execution result must link to its source-bound provenance.
- **Reproducibility:** Identical deterministic inputs and extractor versions must yield identical facts or an explicit deterministic failure/gap.
- **Honesty of incompleteness:** Unknown, excluded, unsupported, stale, and failed areas must remain visible in tree and impact views.
- **Reviewability:** A human reviewer can reproduce the evidence path for every business claim.
- **Security:** Secret-bearing or regulated source material must not leave the approved workspace boundary through unapproved prompts, logs, exports, or integrations.
- **Reversibility:** Initial advice is decision support; no automated irreversible action is part of the F001–F004 acceptance scope.

## 6. Delivery sequence

1. **F006 and F001:** capability isolation plus immutable source snapshot and inventory.
2. **F002:** deterministic facts, evidence links, gaps, and API-structure projection.
3. **F003:** authorized Agent candidates, human review, and business-function projection.
4. **F004:** execution provenance, snapshot comparison, advisory impact, and revalidation.
5. **Reference pilot:** prove the end-to-end slice against a controlled repository change before expanding adapters or considering enforcement.

## 7. Acceptance status

This specification is **approved for the F001–F004 design baseline**. It does not claim that the checked-in implementation already satisfies the requirements. F006 remains an independent implementation track and is not replaced by this redesign.
