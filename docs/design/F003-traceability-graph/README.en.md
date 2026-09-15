> Language: **English reference** · [简体中文（规范文本）](README.md)

---
feature_ids: [F003]
related_features: [F001, F002, F004, F006]
topics: [traceability-graph, agent-analysis, functional-panorama, evidence, human-review]
doc_kind: feature-design
created: 2026-09-09
updated: 2026-09-15
version: "2.0"
status: functional-panorama-final
---

# F003 Functional Panorama Design V2.0

## 1. Finalized scope

This document replaces the V1.0 primary image with the accepted **F003 Functional Panorama V2.0 (HTML edition)** as the current baseline for further functional elaboration. The eight functional groups, five routing outcomes, and governance boundaries are unchanged. Diagram acceptance does not mean F003 is implemented, all technical interfaces are settled, or the feature has passed acceptance.

- **Artifact:** Xianxian's self-contained HTML with inline SVG and its PNG render preserve the V1.3 structure while correcting raster-text drift.
- **Independent acceptance:** on 2026-09-15 at 04:01 UTC, Kimi passed terminology, connection, layout, and same-environment rendering-reproduction checks.
- **Replacement and write authorization:** on 2026-09-15 at 06:53 UTC, the operator requested that this edition be placed in the design documentation, replacing the previous edition.
- **Version rule:** this update adopts the accepted V2.0 HTML/PNG unchanged, without text edits or rerendering. V1.0 and candidate images remain historical rather than current primary images.

## 2. Functional panorama

![F003 Functional Panorama V2.0: F001 primary materials, F002 reference results, Main and Child Agent investigation, five routing outcomes, exception-based human review, and a traceable graph](assets/f003-functional-panorama-v2.0.zh-CN.png)

[Open the V2.0 diagram source](assets/f003-functional-panorama-v2.0.zh-CN.html) · [Open the V2.0 high-resolution image](assets/f003-functional-panorama-v2.0.zh-CN.png) · [SHA-256 manifest](assets/f003-functional-panorama-v2.0.sha256) · [Provenance and acceptance record](assets/f003-functional-panorama-v2.0.provenance.json)

HTML is the maintenance source for this diagram's text and layout. The PNG is a 2896 × 2924 render (1448 × 1462 CSS pixels at 2×). The image retains its original “V2.0 candidate · awaiting confirmation” badge from acceptance; the replacement authorization recorded here establishes its current design-baseline status without altering the accepted artifact merely to change a badge. Both language editions use the same Chinese diagram.

This edition corrects two occurrences of “覆盖版本” to “覆盖账本”, “参议” to “争议”, and the malformed “语义” text. It preserves the task/evidence loop for every Child Agent and provenance, state, evidence, and applicability on nodes and edges. “版本混用”, “不按模型投票”, and F006's fixed-context note align with existing constraints in this document rather than adding functionality.

## 3. Goal, inputs, and outputs

### Goal

A Main Agent and one or more Child Agents investigate scattered documentation, code, configuration, data structures, and test materials in a legacy system to organize traceable relationships between business functions, rules, and engineering assets. F001 source materials are the primary analysis input. F002 technical facts, relationships, and extraction gaps support reference and verification; neither their quality nor exhaustive coverage is assumed without validation.

### Input conditions

| Input | Conditions and purpose |
|---|---|
| Sealed F001 materials | Pin the source version, preserve original-text access, and inherit the inventory and known gaps. Blocking permission, identity, integrity, or version checks cannot be bypassed. |
| F002 reference results | Verify alignment with this source version and retain facts, relationships, and extraction gaps. Not extracted does not mean not analyzable; do not mix reference results from another version. |
| F006 execution configuration | Bind the active Main/Child models, tool permissions, and configuration version. Running and resumed work retains its fixed context without hot-swapping authority. |
| Investigation focus | The user declares the questions for this run. Uninvestigated or unassociated materials remain in the coverage ledger. |

“Reading F001 materials” means controlled investigation of sealed, authorized material, not bypassing admission to read a live repository, an original upload directory, or an unaccounted source. The specific access interface remains an alignment item in section 8.

### Output conditions

- Provide business, implementation, and coverage views over one graph, with function-to-material and material-to-function navigation.
- Retain provenance, applicability, evidence references, analysis state, and uncertainty for conclusions and relationships; original text remains traceable.
- Distinguish automatically admitted Agent analysis from human confirmation; do not hide disputes, missing evidence, or unassociated materials.
- Preserve runs, tasks, human decisions, and graph versions. A finished run does not imply complete understanding of the project.
- Supply structured relationships and evidence to F004; the presence of a test file does not substitute for execution evidence.

## 4. Eight functional groups

| No. | Function | User actions | System behavior and outputs |
|---|---|---|---|
| 01 | Analysis preparation | Select a source version, declare investigation focus, and start. | Bind the F006 execution configuration; check permissions, integrity, and versions; expose blockers or gaps and recovery actions. |
| 02 | Materials and coverage | Search categories, read originals, and inspect investigated, uninvestigated, restricted, or unassociated materials. | Inherit the inventory and record analysis coverage and reasons. Materials are retained; having read them does not mean fully understanding them. |
| 03 | Main/Child Agent investigation | Inspect investigation tasks and progress. | The Main Agent plans, delegates, and rereads evidence. There is at least one Child Agent; each receives tasks and returns evidence, reading original materials, following relationships, examining conditions, and finding counterexamples across materials. |
| 04 | Candidate generation and reconciliation | Expand propositions, support, and disputes. | Candidates contain a concrete proposition, evidence, scope, and uncertainty. Deduplicate, organize hierarchy and many-to-many relationships, group conflicts, preserve sources, and recheck after reconciliation. |
| 05 | Evidence checking and routing | Inspect why a result was admitted or remains unresolved. | Check references, permissions, versions, and semantic support. Route by relationship type, not model votes or self-reported scores; supplementation and retries are bounded. |
| 06 | Human review and feedback | Confirm, narrow scope, correct, reject, supplement, or defer questions grouped by function. | One question per card, acting only on selected propositions or relationships. Record decisions; apply checked decisions to the graph and return evidence or answers to investigation. New files enter through a new F001 version. |
| 07 | Graph browsing and traceability | Switch business, implementation, and coverage views; search, filter, expand, and navigate both ways. | Show business functions/rules linked to documents, APIs/code, configuration/data, and test assets. Nodes and edges retain provenance, state, evidence, and applicability; structured relationships feed F004. |
| 08 | Run and version maintenance | Pause, resume, cancel, retry locally, select new versions, and inspect differences. | Persist tasks, isolate late results, automatically recheck affected areas, and preserve history. Check errors and omissions against human reference cases. |

## 5. Five routing outcomes

| Evidence-check result | Handling | Destination and constraints |
|---|---|---|
| Sufficient support, explicit conditions, no unresolved conflict | Automatic admission | Enter the graph in **Agent analysis** state, without claiming human confirmation. |
| Key evidence is missing | Automatic supplementation | Return to investigation in 03 within budget and stopping conditions. Raise a human question if uncertainty persists; never loop indefinitely. |
| Rules or ownership are ambiguous | Human review | Enter 06 with a concrete question, relevant original passages, investigated scope, and competing interpretations. |
| No reliable explanation yet | Retain materials for investigation | Keep materials in coverage or unassociated views; do not force them into candidate conclusions or established business branches. |
| Invalid references, unauthorized access, or mixed versions | Isolate; retry after repair | Exclude from the effective graph. Repair permissions or run conditions first; persistent failure becomes a run error, not a business question about whether an invalid reference is valid. |

A candidate is a specific, verifiable proposition, not an arbitrary prose summary or the only destination for material. Source materials, open questions, gaps, and invalid outputs each receive an explicit disposition; failing to produce a candidate does not make them disappear.

## 6. Main activity and feedback loops

1. **Prepare inputs:** select a fixed source and investigation focus, bind F006 configuration, and complete preflight in 01. Investigation cannot start while blocking conditions remain.
2. **Inventory and investigate:** 02 establishes the coverage ledger; Main/Child Agents in 03 investigate across materials and produce candidates and evidence.
3. **Reconcile and check:** 04 organizes duplicates, hierarchy, overlap, and conflict, then enters 05. Reconciled results cannot bypass checking to enter the graph.
4. **Route results:** automatic admission goes directly to 07, supplementation returns to 03, and human questions enter 06. Pending materials and invalid outputs are retained or isolated respectively.
5. **Apply human decisions:** checked decisions in 06 apply to selected propositions or relationships in 07; supplementary evidence and answers return to 03. Human explanations do not erase contradictory code evidence.
6. **Maintain traceability:** 07 exposes the current graph and gaps; 08 manages recovery, updates, differences, and quality checks. A new version first triggers automatic checking of affected areas; remaining ambiguity goes to people. Old confirmations do not automatically extend to new evidence.

The two graph-entry paths, **05 automatic admission → 07** and **06 checked human decisions → 07**, use solid arrows. The investigation loops, **05 supplementation → 03** and **06 evidence/answers → 03**, use destination labels `[03]`. Other numbered labels identify destinations, not necessarily automatic transitions: `[02]` retention is a valid resting state, `[08]` supports conditional recovery after isolation, and 08 is cross-cutting support rather than a final sequential step. Dashed arrows in 07's query-direction legend describe two-way navigation; semantic relationships retain their direction.

## 7. Presentation and governance boundaries

- The business tree defaults to admitted Agent-analysis functions and human-confirmed functions, with textual state labels and a human-confirmed-only filter. Pending or disputed results remain inspectable but are not established branches; invalid outputs stay outside the effective graph.
- Human approval applies to a proposition or relationship, not an entire subgraph. Function grouping organizes questions without expanding approval scope.
- Check semantic support by relationship type. Model agreement, copied sources, and model confidence cannot substitute for evidence.
- Added or changed source files require a new F001 version. Human decisions are recorded separately and cannot bypass source admission.
- Test files do not mean tests passed. Without execution evidence, show “No linked execution record / Not yet verified” rather than inventing a test execution. Configuration defaults are not actual effective environment values.
- F004 preserves provenance, state, and uncertainty when consuming relationships and evidence. This panorama adds no automatic merge or deployment blocking.

## 8. Relationship to older documents and unsettled interfaces

This edition confirms the F003 functional panorama; it does not imply that other Features, architecture diagrams, or ADRs have automatically been synchronized.

| Difference | Treatment in this edition |
|---|---|
| The 2026-08-29 F003 spec requires human approval for every candidate before entering the business tree. | That functional description is superseded by automatic admission in Agent-analysis state plus exception-based human review. The older spec body is marked historical. Automatic admission does not grant human-baseline publication authority. |
| ADR-0003 and the product architecture make F002 the sole direct source-bundle consumer. | This edition establishes F001 material as primary analysis input and F002 as reference, but does not choose direct access versus a controlled evidence service. The access entry point, complete inventory/excerpt handoff, permission revalidation, and version binding need joint alignment. Nothing authorizes bypassing F001 sealing or admission. |
| Existing Candidate/Decision/Claim and publication interfaces | Diagram states and decision scope are functional requirements. Fields, interfaces, role permissions, and concurrent-revision protocols are not finalized by the image, and existing implementation is not claimed to satisfy them. |
| Exact automatic-admission evidence rules and quality acceptance values | Relationship-specific checking, bounded supplementation, and human reference cases are established. Rule versions, budget values, and measurable acceptance criteria need elaboration; this documentation pass does not invent them. |

Related documents: [F003 historical spec body and current entry point](../../features/F003-traceability-graph.md), [current F001 Chinese design](../../../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.zh-CN.md), [F002](../../features/F002-feature-api-traceability.md), [F006](../../features/F006-workspace-capability-settings.md), [F004](../../features/F004-change-impact-analysis.md), [ADR-0003](../../decisions/ADR-0003-source-truth-boundary.md), and [product architecture](../../architecture/traqen-product-architecture.md).

## 9. Version and acceptance provenance

### Current V2.0

| Item | Evidence |
|---|---|
| Discussion thread | `thread_mtgypu3cay1bysab` |
| HTML remake and asset-write authorization | `0001789443495478-000034-934cc8b0` |
| Xianxian's delivery | `0001789443497700-000062-33969791`: HTML/PNG, text corrections, and documentation-alignment items. |
| Kimi's independent acceptance | `0001789444862182-000071-33780f79`: 27 terminology checks, 7 drift-word regressions, layout and connections passed; the PNG rerendered in that environment matched the archived hash. |
| Operator replacement and write authorization | `0001789455231575-000268-ec300784` |
| Diagram HTML SHA-256 | `56dae9d67570295ea232135ed76291b2b858fd6f85f06e8a9f4557325b96a2d8` |
| Rendered PNG SHA-256 | `ba2c5e746b02772e95ec8024088c7804a697a3ca69323f6a6fb997f308215018` |
| Hash resolution | Use the current on-disk HTML hash, independently consistent with Kimi's value, rather than the author's earlier `8357bf20…27fc0` report. |
| Equivalent wording | Diagram “冲突编组” and Chinese section 4 “编组冲突” both mean grouping conflicts. Preserve their wording; this is not a new routing rule. |

This documentation update reuses that independent diagram acceptance and freshly verifies artifact hashes and documentation links; it does not claim a new browser acceptance run. Author and independent-review records establish byte equality in the tested environment, not across different browser, font, or operating-system versions.

### Historical versions (not current primary images)

| Version | Record |
|---|---|
| [V1.0 first final edition](assets/f003-functional-panorama-v1.0.zh-CN.png) | Superseded by V2.0. Earlier confirmation `0001788935356126-000087-3385a3f2`, write authorization `0001788937652971-000112-fea57317`, and Kimi's polished-image check `0001788923474475-000083-4ca85833`. Original artifact `exec-e651da11-3710-4f73-9ecc-d276d6645dbe.png`; SHA-256 `380002bce7bded27588afcae8c1a3f86e1c620e0f7bdd57bd56f7a3cc344a28b`. |
| [V1.3 raster candidate](assets/f003-functional-panorama-v1.3-candidate.zh-CN.png) | Structural reference for V2.0, retaining known text defects as historical evidence, not effective wording. SHA-256 `92db9c60a49a10de902e71e061c5f39ebb7718b1b20712eb1028a805edd45ab7`. |

This text-dense diagram requires exact wording: maintain HTML text and deliver the rendered PNG. Verification covers all text and every connection's source, destination, and meaning, not only the previous round's fixes. This record concerns diagrams and design documentation, not code review, Feature completion, or deployment acceptance.
