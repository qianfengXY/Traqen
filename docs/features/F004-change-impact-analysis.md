> Language: **English** · [简体中文](F004-change-impact-analysis.zh-CN.md)

---
feature_ids: [F004]
topics: [test-execution, change-impact, revalidation, traceability, advisory]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-29
description: Connect test execution evidence and versioned traceability to bounded, advisory change-impact and revalidation guidance.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-29T03:18:18Z
---

# F004 — Change Impact Analysis

**Status:** Spec
**Owner:** TBD
**Depends on:** F001, F002, F003

## Why

The value of legacy understanding is a safer next change. But a link from code to a test asset is not proof that the test ran, passed, or covered the changed behavior. Impact analysis must separate structural evidence, reviewed semantic claims, execution results, and unknown coverage so teams can make an informed decision without being misled by a false "no impact" result.

## Outcome

F004 records snapshot-bound test and execution evidence, compares a declared change against the evidence graph, and produces advisory revalidation guidance. Results are classified as `CONFIRMED`, `POSSIBLE`, or `UNKNOWN`, with the exact evidence and coverage boundary behind each classification.

The first release is decision support only: it neither merges, deploys, nor blocks work automatically.

## Scope

### In scope

- Distinguish test assets, declared test cases, and executed test runs.
- `TestExecution` provenance: runner, environment, command or workflow, result, relevant logs/artifacts, source snapshot, and execution time.
- Versioned `ChangeSet` comparison between source snapshots.
- Advisory impact paths across code, configuration, APIs, reviewed business claims, test assets, and actual execution evidence.
- Revalidation recommendations with a classification, rationale, evidence links, and stated coverage gaps.
- A change review view that shows both the business-function and API projections affected by a change.

### Out of scope

- Claiming a test passed from a static test reference.
- Claiming "no impact" when a gap, unsupported extractor, unobserved runtime behavior, or stale execution prevents that conclusion.
- Mandatory CI, merge, release, or production enforcement in the initial release.

## Impact semantics

| Classification | Meaning |
| --- | --- |
| `CONFIRMED` | Snapshot-bound evidence establishes the relationship or executed result. |
| `POSSIBLE` | A traceable path or reviewed claim suggests a relationship, but evidence is incomplete. |
| `UNKNOWN` | A declared gap, stale run, unsupported behavior, or missing evidence prevents a bounded conclusion. |

An empty impact list is not a pass result. It must name the coverage proof that justifies the conclusion; otherwise the result is `UNKNOWN`.

## User journey

1. An engineer selects the before and after source snapshots for a proposed or completed change.
2. Traqen identifies changed artifacts and traverses deterministic facts, reviewed claims, and available execution evidence.
3. The engineer sees affected business functions and APIs, recommended revalidation, and the explicit unknowns.
4. The engineer records or links new execution evidence; the next analysis remains tied to its exact snapshots and run context.

## Acceptance criteria

- [ ] A test execution record cannot be created without runner, environment, result, timestamp, and source snapshot provenance.
- [ ] A reference-pilot change produces a `ChangeSet` and shows direct evidence paths to affected API and business-tree projections where present.
- [ ] Every revalidation recommendation contains a classification, rationale, evidence links, and coverage state.
- [ ] Static test references and executed test results are visibly distinct.
- [ ] A missing runtime observation, unsupported analysis, or stale run yields `UNKNOWN`, not "no impact".
- [ ] The initial workflow is advisory and has no automatic merge, deployment, or CI-blocking action.

## Open questions

- What staleness policy applies when a test execution predates the compared source snapshot?
- Which CI systems and test-report formats join the first integration set?
- When evidence quality has been validated, which narrow policy decisions—if any—may later opt into enforcement?

## Dependencies and handoff

F004 consumes F001 source identity, F002 facts/gaps, and F003 reviewed claims. It adds execution truth without conflating it with static analysis. A reference pilot must demonstrate bounded advice before any proposal to make impact results enforceable.

**Next:** validate the F001–F004 slice against a controlled repository change, then decide which adapters and review workflow deserve implementation.
