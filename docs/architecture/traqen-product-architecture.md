> Language: **English** · [简体中文](traqen-product-architecture.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-architecture, legacy-system, traceability, evidence, change-impact]
doc_kind: product-architecture
created: 2026-07-29
updated: 2026-08-30
---

# Traqen Product Architecture

## 1. Product promise

Traqen helps an architect take over an unfamiliar legacy system and make the next change safer. It does that by preserving a versioned evidence trail from a registered source to two understandable projections:

- a **business-function tree**, made only of human-reviewed claims; and
- an **API-structure tree**, made of deterministic source observations where available.

The product never hides what was not analyzed, what an extractor could not establish, or where a model made an uncertain interpretation.

## 2. Active design authority

The active delivery contract is the F001–F004 feature set:

| Feature | Architectural responsibility |
| --- | --- |
| F001 — Workspace & Source Truth | Register a permissioned source, capture an immutable `SourceSnapshot`, and inventory every artifact and coverage disposition. |
| F002 — Deterministic Evidence & API Structure | Derive reproducible `Fact`, `EvidenceLink`, `Derivation`, and `CoverageGap` records; publish the API-structure tree. |
| F003 — Agent Candidates & Reviewed Business Function Tree | Produce bounded semantic candidates and promote only human-approved candidates to business claims and the business-function tree. |
| F004 — Change Impact Analysis | Preserve actual execution context, compare source snapshots, and issue advisory impact and revalidation guidance. |
| F006 — Workspace Capability Settings | Supply explicit, versioned capability and Agent-access configuration without expanding the analysis source boundary. |

The canonical ontology and authority constraints remain in [ADR-0001](../decisions/ADR-0001-canonical-traceability-ontology.md). Workspace identity and capability-isolation rules remain in [ADR-0002](../decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md). F001's replayable source boundary and downstream-admission rule remain in [ADR-0003](../decisions/ADR-0003-source-truth-boundary.md). [F006's capability-resolution map](../diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) makes the Account-backed, allowlisted local-CLI boundary explicit: legacy direct-API profiles remain compatibility history and cannot be listed, selected, applied, verified, or started through F006. It also distinguishes global availability from Workspace-local state and Agent grants, then shows the separate Apply and Run-pinning boundaries.

## 3. Evidence flow

```text
registered source + access policy
        │
        ▼
F001 Workspace ──► SourceSnapshot ──► ArtifactInventory ──► CoverageGap
                                              │
                    ┌─────────────────────────┴──────────────────────────┐
                    ▼                                                    ▼
F002 deterministic extractors                                  F003 authorized agents
Fact + EvidenceLink + Derivation                                Candidate + inference provenance
        │                                                    │
        ▼                                                    ▼
API-structure tree                                    human ReviewDecision
                                                              │
                                                              ▼
                                                     Claim ──► business-function tree
                    └─────────────────────────┬──────────────────────────┘
                                              ▼
                                F004 ChangeSet + TestExecution evidence
                                              │
                                              ▼
                         advisory impact and revalidation guidance
```

All arrows are snapshot-bound. A downstream record names the source snapshot and exact evidence it relied on; it does not rely on a mutable filesystem, a remembered model conversation, or an unversioned report.

## 4. Truth and uncertainty rules

| Level | Created by | May state | Cannot do |
| --- | --- | --- | --- |
| `Fact` | deterministic extractor | direct, reproducible source observation | declare business intent or approval |
| `Candidate` | authorized Agent | bounded semantic hypothesis | publish a business truth |
| `Claim` | human review decision | approved current business meaning | erase its candidate/evidence history |
| `TestExecution` | controlled runner or integrated CI | what ran, where, and with what result | prove unobserved behavior |
| `CoverageGap` | inventory, extractor, review, or execution process | the known limit on confidence | silently disappear from a result |

Candidate agreement is corroboration, never a truth rule. A missing edge is not a no-impact finding until relevant coverage proves it. Rejected, stale, and superseded material remains auditable without being presented as current truth.

## 5. Source boundary and safety

F001 is the only entry point for analysis content. Each workspace declares its source locator, content policy, snapshot identity, and artifact dispositions. Source content may be read by approved local extractors or by an Agent configuration explicitly authorized through F006. Raw source must not be sent to an external model merely because an analysis feature exists.

The minimum immutable provenance carried by a published result is:

- source snapshot and artifact locator/range;
- producer identity and version (extractor, Agent, runner, or reviewer);
- derivation or inference inputs and reproducibility token;
- the access, egress, and retention policy that governed the run; and
- confidence and coverage state.

## 6. Two user-facing trees, one evidence graph

The trees are projections over the same evidence graph, not two disconnected stores.

| Projection | Nodes included | Publication rule |
| --- | --- | --- |
| Business-function tree | reviewed `Claim` nodes and their approved relationships | human review decision required |
| API-structure tree | deterministic endpoint/operation/handler/contract facts | extractor evidence required |

The business tree may link to APIs, code, documentation, tests, configuration, and executions, but those links retain their original level and provenance. The API tree may expose an unclassified endpoint; it must not invent a business owner or capability to make the display look complete.

## 7. Change and test evidence

F004 distinguishes three different records:

1. **Test asset:** a source artifact that appears to define or invoke a test.
2. **Test specification:** a governed description of what should be verified, where available.
3. **Test execution:** a run with runner, environment, time, source snapshot, result, and retained evidence.

For a `ChangeSet` between two snapshots, Traqen traverses facts, reviewed claims, and execution evidence. Each recommendation is `CONFIRMED`, `POSSIBLE`, or `UNKNOWN` and includes its supporting evidence and coverage limitation. The first release is advisory; it does not block CI, merge, deployment, or production work.

## 8. Architect journey

1. Register a source and confirm its analysis/egress policy.
2. Inspect the immutable snapshot and all inventory dispositions.
3. Explore reproducible technical facts and the API-structure tree.
4. Run one or more approved Agents; review their candidates and gaps.
5. Publish approved claims into the business-function tree.
6. Compare a proposed change to a prior snapshot; inspect affected business/API views, known execution evidence, and recommended revalidation.

Every stage can stop with a visible gap. The product favors an explicit incomplete answer over a persuasive but unsupported answer.

## 9. Delivery and pilot gate

Delivery order follows the evidence dependency:

1. F006 capability configuration and F001 source-truth contract.
2. F002 deterministic facts, evidence links, gaps, and API projection.
3. F003 candidate provenance, human review, and business-function projection.
4. F004 execution evidence, snapshot comparison, advisory impact, and revalidation.
5. A reference pilot on a controlled repository change.

The pilot passes only if it demonstrates a stable snapshot/inventory, reproducible facts, both projections with their different authority rules, explicit gaps, and bounded impact guidance. It must not use a demo fallback or an automatic enforcement gate to mask missing evidence.

## 10. Relationship to current implementation

Existing domain, scan, graph, history, execution, and model-profile code is an implementation baseline, not proof that this architecture is complete. Implementation must map each behavior to the F001–F004 contract and preserve F006's existing work; it must not promote legacy scanner outputs, Agent conversations, or UI state into authority without the provenance and review rules above.
