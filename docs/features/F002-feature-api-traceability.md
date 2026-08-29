> Language: **English** · [简体中文](F002-feature-api-traceability.zh-CN.md)

---
feature_ids: [F002]
topics: [deterministic-analysis, evidence-facts, api-tree, traceability, gaps]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-29
description: Derive reproducible source facts and an evidence-backed API-structure tree from a versioned workspace snapshot.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-29T03:18:18Z
---

# F002 — Deterministic Evidence & API Structure

**Status:** Spec
**Owner:** TBD
**Depends on:** F001

## Why

Legacy-system analysis needs a reproducible base that is not a model opinion. Before asking an agent to explain a feature, Traqen must expose what can be deterministically observed in the registered snapshot: artifacts, declarations, imports, routes, handlers, configuration references, and test references.

## Outcome

F002 turns an F001 snapshot into versioned `Fact` and `EvidenceLink` records. It publishes an API-structure tree whose route, method, declared contract, and source handler are direct observations when the language adapter can prove them. It also publishes gaps where the extractor cannot establish a relationship.

The API tree is an evidence projection, not a claim that an endpoint belongs to a particular business capability. Business naming and ownership are F003 work.

## Scope

### In scope

- Deterministic extractors for supported source languages and frameworks.
- Normalized `Fact` records with extractor version, source snapshot, source range, and reproducibility token.
- `EvidenceLink` records from facts to artifact ranges and supporting configuration or tests.
- API-structure projection: route, HTTP method or transport operation, declared request/response contract where statically available, and handler linkage.
- Explicit `CoverageGap` records for unsupported syntax, unresolved dynamic behavior, and missing evidence.

### Out of scope

- Inferring a business function, user intent, or API ownership from naming conventions.
- LLM-generated semantic conclusions and review decisions (F003).
- Recording whether a test actually passed in a particular environment (F004).

## Evidence model

| Record | Meaning |
| --- | --- |
| `Fact` | A reproducible observation emitted by a deterministic extractor. |
| `EvidenceLink` | A precise link from a record to snapshot-bound artifact ranges. |
| `Derivation` | Extractor name, version, parameters, and reproducibility token used to produce a fact. |
| `CoverageGap` | A declared limit that prevents a fact or edge from being established. |

Facts may be corrected by an improved extractor, but the prior derivation remains inspectable. Absence of an edge is not evidence of no impact unless the relevant coverage has been proven.

## User journey

1. The architect selects an F001 source snapshot.
2. Traqen runs only the supported deterministic extractors.
3. The architect opens the API tree and follows every visible endpoint or handler back to evidence.
4. Unsupported or unresolved areas appear as gaps, not as silently missing branches.

## Acceptance criteria

- [ ] A reference-pilot snapshot yields reproducible facts across two identical runs.
- [ ] Every published fact has a snapshot ID, extractor derivation, and at least one evidence link.
- [ ] Each discovered supported endpoint shows its route/operation, handler evidence, and declared contract evidence when available.
- [ ] The API tree labels unavailable evidence and unresolved dynamic routes as gaps.
- [ ] Facts can link code, configuration, documentation, and test assets without asserting semantic ownership.
- [ ] The published API tree never promotes a heuristic business classification to a deterministic fact.

## Open questions

- Which frameworks form the first supported extractor set?
- How should protocol adapters represent asynchronous events and non-HTTP APIs in the common tree?
- What source-range format remains stable across generated or vendored files?

## Dependencies and handoff

F002 requires F001's immutable snapshot and complete inventory. F003 may use facts as evidence but must preserve the distinction between deterministic facts and semantic candidates. F004 uses facts and gaps to calculate bounded, advisory impact.

**Next:** F003 proposes and reviews business semantics over this evidence base.
