> Language: **English** · [简体中文](traqen-product-architecture.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-architecture, business-architecture, application-architecture, information-architecture, technical-architecture, traceability, change-impact]
doc_kind: product-architecture
created: 2026-07-29
updated: 2026-09-06
---

# Traqen Product Architecture

**Traqen treats business capabilities as core assets, linking intent, design, implementation, configuration, tests, and deployment evidence. It continuously manages their changes and quality gaps so software knowledge can be inherited, quality explained, and delivery verified.**

The architecture comprises **seven business capabilities, one Workspace governance boundary, one versioned evidence model, and a quality loop connecting knowledge, baselines, verification, change, and delivery.**

This document remains the entry point for ongoing architecture updates. Four diagrams are generated with [tt-a1i/archify](https://github.com/tt-a1i/archify) and embedded in their respective sections. Each retains an interactive HTML, vector export, and editable JSON source. The shared figures use Chinese labels; this English text defines the same responsibilities. Interactive versions support focus, zoom, light/dark themes, and guided views. Diagrams are derived from this document. The business and information views reuse Archify color categories for capabilities and information objects; actual deployment is defined by the technical view.

| View | Core question | Reading entry |
| --- | --- | --- |
| Business | Which capabilities fulfill the vision, for whom, and with what value? | [Capabilities and value](#1-business-architecture-lifecycle-quality-traceability) |
| Application | Which modules produce, approve, and consume the required evidence? | [Responsibilities and coverage](#2-application-architecture-separate-evidence-responsibilities) |
| Information | How do business objects, facts, claims, and execution evidence remain connected and trustworthy? | [Versions and authority](#3-information-architecture-versioned-conclusions-and-evidence) |
| Technology | How are these capabilities run, persisted, constrained, and recovered? | [Deployment and tradeoffs](#4-technical-architecture-modular-application-and-bounded-execution) |

**Reading status:** The business view describes the full capability framework; the application view distinguishes current design coverage from areas requiring elaboration; the technical view is a recommended deployment shape. Design boundaries, implementation foundations, and validation needs remain distinct. Neither diagrams nor existing code prove acceptance.

## 1. Business architecture: lifecycle quality traceability

![Traqen business architecture: seven capabilities and their relationships](../diagrams/traqen-product-architecture/product-overview.architecture.png)

[Interactive view](../diagrams/traqen-product-architecture/product-overview.architecture.html) · [Vector image](../diagrams/traqen-product-architecture/product-overview.architecture.svg) · [Editable source](../diagrams/traqen-product-architecture/product-overview.architecture.json)

The core objects are business capabilities and their supporting records. For example, order submission should connect its rules, design, implementation, configuration, test specifications, actual results, and version history. Arrows emphasize primary collaboration relationships; work can enter at different capabilities. Quality reporting combines traceability, verification, and disposition records; gap resolution returns to evidence collection, correction, and revalidation.

| Business capability | Required functions | Business value |
| --- | --- | --- |
| **Knowledge reconstruction and asset management** | Identify capabilities, processes, rules, interfaces, and related assets in legacy materials; retain provenance, ambiguity, and missing information; browse by capability | Preserve shared, transferable knowledge and reduce repeated investigation and handover losses. |
| **Business definition and baseline governance** | Confirm purpose, rules, scope, and responsibility; maintain stable identity, versions, splits/merges, and decision history | Establish a shared business/engineering baseline without confusing current implementation with normative requirements. |
| **End-to-end linking and quality traceability** | Connect requirements, design, code, APIs, data, configuration, tests, and deployment evidence; navigate both directions and locate breaks | Explain implementation and verification of each requirement and expose missing implementation, tests, or valid support. |
| **Test design and quality verification** | Assist test design from confirmed rules, reuse existing tests, and associate actual executions, assertions, environments, and results | Identify which requirements were verified and expose unverified rules, exceptions, and boundaries. |
| **Change impact and continuous regression** | Compare requirement, implementation, and configuration changes; identify affected capabilities and stale support; recommend review/revalidation; preserve evolution history | Bound investigation and verification, reduce omissions, and keep knowledge and evidence applicable. |
| **Quality gaps and collaborative resolution** | Distinguish missing, stale, conflicting, and failed links; assign responsibility and corrective actions; record acceptance rationale and outcomes | Make quality work accountable, trackable, and verifiably resolved. |
| **Quality reporting and delivery proof** | Show quality, coverage, and residual risks by capability, version, and deployment; support historical inspection and evidence export | Provide verifiable support for acceptance, delivery, retrospectives, and audits, and help prioritize quality work. |

**Two construction paths:** Legacy reconstruction fills historical gaps; timely registration and linking of new requirements and designs maintains future work. The latter belongs to the full capability framework; its detailed registration and integration contracts still need design. It does not introduce automatic source synchronization or an analysis path bypassing F001.

| Participant | Responsibility and use of value |
| --- | --- |
| Product and business owners | Confirm goals, rules, and acceptance criteria; maintain a shared business baseline. |
| Architects and developers | Maintain design/implementation relationships, understand systems, and handle change impact. |
| Test and quality personnel | Define verification scope, inspect actual execution evidence, and drive gap resolution. |
| Delivery, operations, and management | Inspect the quality evidence, residual risk, and history of a specific version or deployment. |

Workspace permissions, human approval, versioning, evidence retention, and audit span every capability. Existing requirements, development, and test systems are potential integration partners; Traqen continuously links business capabilities with quality evidence. Specific integration scope remains to be defined.

**Value validation:** Direct outputs are reusable capability knowledge, explicit trace relationships, actionable verification scope, and verifiable delivery evidence. Expected improvements in handover cost, communication rework, change omissions, and acceptance efficiency require real-team pilots. Graph node counts or test pass rates cannot substitute for those outcomes.

System handover, change assessment, and verification planning remain one typical journey. Business architecture defines the full capability set; F001–F004 and F006 are current delivery slices, mapped below. Initial analysis remains advisory and adds no automatic merge, CI, or deployment blocks.

## 2. Application architecture: separate evidence responsibilities

![Traqen application architecture: current responsibilities and capabilities requiring elaboration](../diagrams/traqen-product-architecture/application.architecture.png)

[Interactive view](../diagrams/traqen-product-architecture/application.architecture.html) · [Vector image](../diagrams/traqen-product-architecture/application.architecture.svg) · [Editable source](../diagrams/traqen-product-architecture/application.architecture.json)

| Module | Owned responsibilities and outputs | Handoff boundary |
| --- | --- | --- |
| F001 Workspace & Source Truth | Source registrations, capture tasks, immutable components/bundles, manifests, inventory, gaps, receipts, and current admission | `SourceTruthAdmission` supplies `QualifiedSourceInput` only to F002, never mutable paths, refs, upload sessions, or credentials. |
| F002 Deterministic Evidence & API Structure | `Fact`, `EvidenceLink`, `Derivation`, inherited/new gaps, and API tree | Supplies persisted, snapshot-bound evidence to F003/F004; does not turn guessed business names or ownership into facts. |
| F003 Agent Candidates & Business Tree | Bounded candidates, human review, approved claims, and business tree | Agents interpret evidence; authorized people decide publication. Model agreement and confidence are supporting information only. |
| F004 Change Impact Analysis | `ChangeSet`, actual execution context, impact classifications, and revalidation guidance | Combines F002/F003 and execution evidence; initially advisory only. |
| F006 Workspace Capability Settings | Global capability assets, Workspace drafts/active configurations, explicit Agent grants, and pinned run configurations | Global availability is not an Agent grant; configuration cannot expand source scope. v1 uses allowlisted local CLIs. |

F001 is the only entry point for analysis content, and F002 is the only direct consumer of qualified source bundles. F003/F004 inherit source provenance and gaps through F002 outputs; they cannot return to the original repository or upload directory to collect materials independently. The application diagram preserves this boundary.

**Handoff recommendation requiring elaboration:** F002 outputs should retain snapshot-bound evidence references and controlled reading of documentation, configuration, and other materials, rather than AST nodes alone. This preserves context for Agent investigation across materials while respecting admission and egress policy. The exact reading protocol, excerpt bounds, and authorization checks belong in F002/F003 design; this document does not claim that interface already exists.

Workspace is the canonical aggregate root. Legacy `Project.id` is a migration compatibility identity only. Modules share Workspace context and reject late responses from old contexts. Responsibilities do not map directly to navigation pages: F001's eight stations remain one source workbench, and this iteration does not redefine global navigation.

### 2.1 Full business capabilities and current delivery coverage

| Business capability | Main current design support | Scope still requiring elaboration or acceptance |
| --- | --- | --- |
| Knowledge reconstruction and assets | F001 sources, F002 facts/APIs, F003 candidates/publication | Complete knowledge reconstruction and use across materials. |
| Business definition and baselines | F003 human decisions/business tree; existing Feature/Claim identity and version models | Complete new-requirement registration, rule-baseline, and identity-evolution workflows. |
| End-to-end linking and traceability | F002/F003 relationships and support; F004 execution links | Complete intent-to-deployment coverage and explanation of breaks. |
| Test design and verification | Existing TestSpec/execution models; F004 revalidation support | Rule-based test design, reuse, and actual verification workflows. |
| Change impact and regression | F004 ChangeSet, impact classifications, and recommendations | Continuous review and revalidation across multiple kinds of change. |
| Gaps and collaborative resolution | Stage-specific gaps, decisions, and invalidation records | Responsibility, evidence collection, correction, risk acceptance, and verified closure workflows. |
| Quality reporting and delivery proof | Traceability, impact, and metric projections from the shared model | Acceptance, history, and evidence-export experiences by capability/version/deployment. |

“Main support” maps responsibilities and existing models; it does not claim a complete implemented capability. F006 provides crosscutting run capabilities and grant boundaries. The lower diagram row shows capability allocation requiring elaboration, not new Feature IDs, navigation structure, or committed delivery phases.

## 3. Information architecture: versioned conclusions and evidence

![Traqen information architecture: sources, facts, candidates, decisions, claims, and execution evidence](../diagrams/traqen-product-architecture/information.architecture.png)

[Interactive view](../diagrams/traqen-product-architecture/information.architecture.html) · [Vector image](../diagrams/traqen-product-architecture/information.architecture.svg) · [Editable source](../diagrams/traqen-product-architecture/information.architecture.json)

The diagram shows evidence and governance dependencies, not automatic creation of every downstream record on each analysis. `CoverageGap` can arise during capture, extraction, review, or execution and propagates along relevant dependencies. All records belong to one Workspace and retain exact versions, producers, policies, scopes, and history. Corrections create new derivations, decisions, or revisions.

### 3.1 Separate authority, conformance, and verification

| Dimension | Question answered | What it cannot replace |
| --- | --- | --- |
| Authority | Who confirmed the business claim, and within which scope? | Human approval cannot prove implementation conformance or passing tests. |
| Conformance | Does the current implementation satisfy the relevant business requirement? | Observed behavior cannot establish that the business should behave that way. |
| Verification | Which execution verified what, on which version and environment? | Passing tests cannot grant business authority or prove unobserved behavior. |
| Freshness, conflict, and coverage | Is evidence still applicable, contradictory, or incomplete? | A green state in one dimension cannot remove gaps in others. |

A `Fact` is a deterministic observation, a `Candidate` is a semantic hypothesis, and a `Claim` requires human publication. Claims distinguish current implementation behavior, normative business requirements, design intent, and quality expectations. Rejected, superseded, or stale candidates remain auditable without appearing as current business truth.

Discovering test source creates a test asset, not an approved TestSpec or actual TestExecution. Missing execution results appear as gaps. Trusted Evidence supports an associated Claim through TestExecution and verification results, preserving the business authorization chain.

### 3.2 Two trees, one evidence model

| Projection | Publication basis | Preserved boundary |
| --- | --- | --- |
| Business tree | Human-reviewed claims and approved relationships | API, code, documentation, configuration, and test links retain their types and provenance. |
| API tree | Deterministic endpoint, operation, handler, and contract observations | Unclassified endpoints are valid; do not invent business ownership for visual completeness. |
| Impact, trace chains, and metrics | Facts, decisions, and executions at the relevant versions | Projections are rebuildable and cannot own another editable business truth. |

Business `Feature.id` is a stable identity assigned through governance, not calculated from names, paths, or taxonomy positions. `FeatureVersion` carries changes. Stable Fact entity identity is separate from snapshot-specific fact identity. Engineering roadmap IDs such as F001 are not business Feature identities.

Code changes can require renewed implementation mapping, conformance checks, or verification while preserving business intent, human decisions, and historical evidence. Dependencies also need source, extractor, capability configuration, decision, and execution-context versions. Each Feature must validate the exact recomputation scope; renaming or reclassification must not imply disappearance of a business identity.

## 4. Technical architecture: modular application and bounded execution

![Traqen technical architecture: modular application, bounded execution, persistence, and coordinated recovery](../diagrams/traqen-product-architecture/technology.architecture.png)

[Interactive view](../diagrams/traqen-product-architecture/technology.architecture.html) · [Vector image](../diagrams/traqen-product-architecture/technology.architecture.svg) · [Editable source](../diagrams/traqen-product-architecture/technology.architecture.json)

**Recommended deployment shape:** Reuse domain rules, application services, PostgreSQL adapters, and CLI adapters in a modular application. Bounded Workers perform lengthy capture, extraction, and model analysis separately from interactive requests. The server persists jobs, checkpoints, and results. The diagram shows responsibilities and data relationships, not proof that every process-isolation boundary is implemented.

| Technical choice | Reason | Tradeoff and validation boundary |
| --- | --- | --- |
| Modular application with isolated lengthy execution | Reuse existing foundations and concentrate version, authorization, and publication contracts | Validate recovery, resource bounds, and isolation; module names do not automatically imply independent services. |
| PostgreSQL + dedicated persistent volume | Matches confirmed F001 storage: authoritative records in the database, source bytes in the volume | Files and database are not one transaction; persist bytes and protect references before transactional publication. |
| Unified evidence graph model | Share identities and relationships across business/API/impact views | The model does not mandate a dedicated graph database; measure actual path queries and incremental workloads before extending storage. |
| Allowlisted CLIs and pinned run configuration | Follow F006 v1 and preserve exact capability/grant provenance | An executable allowlist is not isolation; file, network, tool, and credential permissions still require validation. |
| Initial single node with coordinated recovery | Focus on one verifiable persistence, backup, and recovery chain | Outages may pause service; no claim of high availability, fixed throughput, or unmeasured recovery objectives. |

Source content follows approved access paths and is not automatically sent externally merely because a model is available. Runs retain nonsensitive configuration snapshots and Secret references. Raw source, prompts, outputs, logs, and exports are subject to Workspace access and egress policies. Active and paused jobs never hot-switch to later configurations.

### 4.1 Express four states separately

The latest F001 design B separates four questions; the overall product should preserve this distinction:

| State | Meaning |
| --- | --- |
| Task progress | Current step, whom it awaits, and how to resume. |
| Content freezing | Whether an immutable, queryable bundle and issuance record exist. |
| Current admission | Whether current permission, integrity, and gap-acceptance expiry permit new analysis. |
| Backup coverage | Which coordinated backup actually covers this version. |

Published receipts are only `READY` or `READY_WITH_ACCEPTED_GAPS`. `BLOCKED` belongs to diagnostics for an unsuccessful publication attempt, which issues no receipt. Expired acceptance does not rewrite an old receipt; current admission rejects new analysis. Renewed acceptance of the same content can append a new receipt. Successful freezing does not imply backup coverage.

Tasks, frozen history, and audit records persist by default (TTL=0). Insufficient capacity blocks new writes and provides recovery actions instead of automatically deleting history. Database and referenced bytes are backed up together, with reference integrity checked after isolated recovery. Retained content must remain usable when original sources cannot be fetched again.

## 5. Key difficulties and validation

| Difficulty | Architectural response | Required evidence |
| --- | --- | --- |
| Incomplete static relationships | Determinism guarantees reproducible observations only; dynamic calls, reflection, and configuration gaps propagate into impact findings | Unsupported behavior and missing-edge cases remain `UNKNOWN`, never unsupported no-impact conclusions. |
| Human review cost | Recommend grouping candidates by business capability and emphasizing evidence/version differences; confidence can aid ordering but never grant authority | Real tasks allow evidence inspection, candidate correction, and explicit publication; observe review burden in the pilot. |
| Trust across version changes | Preserve stable business identity and distinguish recomputation, re-review, and history retention through dependencies | Code, configuration, extractor, or environment changes invalidate the right scope without deleting business intent. |
| Persistence and recovery | Bounded streaming capture, checkpoints, reference protection, atomic publication, and coordinated recovery | Interruptions, retries, lost responses, full disks, and missing restored bytes never expose partial bundles or false availability. |
| Agent execution boundary | Pin inputs/capabilities and verify actual file/network/tool/credential permissions | Unauthorized materials and capabilities remain inaccessible; logs, outputs, and history do not leak secrets. |

Impact findings use `CONFIRMED`, `POSSIBLE`, or `UNKNOWN`, each with scope, paths, and limitations. `CONFIRMED` means evidence establishes a specific relationship or execution result; it does not mean a production failure has occurred. An empty impact list is not a pass without relevant coverage proof.

## 6. Delivery sequence and overall validation

Current delivery dependencies remain: F006 capability boundaries and F001 sources → F002 deterministic evidence/APIs → F003 human-reviewed business meaning → F004 execution evidence and impact guidance → controlled reference pilot. Completing F001 capture alone does not require an Agent or F002. Subsequent delivery scope for the full capability framework still needs division; this initial sequence does not narrow the vision.

Use an order-submission rule change as a multi-role pilot across key business-value stages:

| Pilot stage | Verifiable output |
| --- | --- |
| Knowledge and business baseline | The team locates an existing capability and its sources; product/business owners confirm rules, scope, and responsibility while distinguishing current behavior from requirements. |
| Linking and change | Developers compare explicit versions, trace affected APIs, implementations, and claims, and see impact rationale and unknown areas. |
| Tests and resolution | Test personnel identify rule-based verification scope and associate real execution; gaps have responsibility, actions, acceptance rationale, or evidence of verified closure. |
| Delivery and ongoing maintenance | Delivery personnel inspect the evidence chain and residual risk for a specific version/deployment; subsequent iterations preserve decisions and correctly expose stale support. |

An architect's change decision is one criterion. Overall validation must also establish transferable knowledge, shared business baselines, verifiable tests and gap resolution, and inspectable delivery evidence. Capabilities absent from the first pilot remain explicitly unvalidated rather than implying acceptance of the full vision.

Fact replay, distinct publication authority for both trees, recovery, and permission boundaries still require proof. Observe expected cost, rework, and efficiency improvements in real tasks without inventing benefit figures. These are validation goals, not a report of a passing pilot.

## 7. Design authority and implementation foundations

### 7.1 Active design sources

| Source | Scope |
| --- | --- |
| [Product vision](../../README.md) and [system requirements](traqen-system-requirements.md) | The vision defines complete intent-to-deployment traceability for high-value business capabilities. System requirements describe the current delivery focus and R1–R9, not the entire capability framework. |
| [Current F001 Chinese design B](../../feature-discussions/2026-08-30-F001-workspace-source-truth-design/README.zh-CN.md) | Current authority for F001 behavior and acceptance; takes precedence over unsynchronized older specs, English documents, and ADR summaries. |
| [F002](../features/F002-feature-api-traceability.md), [F003](../features/F003-traceability-graph.md), [F004](../features/F004-change-impact-analysis.md) | Deterministic facts, human publication, execution, and impact contracts. |
| [F006](../features/F006-workspace-capability-settings.md) and [capability-resolution map](../diagrams/traqen-product-architecture/workspace-capability-resolution.dataflow.html) | CLI assets, explicit grants, and separate Apply/Run pinning boundaries. |
| [ADR-0001](../decisions/ADR-0001-canonical-traceability-ontology.md) | Canonical ontology, stable identity, and distinct authority levels. |
| [ADR-0002](../decisions/ADR-0002-workspace-aggregate-and-execution-isolation.md) | Workspace aggregation and execution isolation; use its later F006 amendment. |
| [ADR-0003](../decisions/ADR-0003-source-truth-boundary.md) | Decision background for source boundaries; current F001 details follow design B. |

This document owns overall relationships, rationale, and tradeoffs. Detailed Feature contracts remain in their respective documents. Later substantive changes require confirmation of the complete proposal and authorized updates to affected designs; changing the overview alone cannot silently change downstream permissions, data, or product boundaries.

### 7.2 Implementation foundations inspected in this discussion

| Existing foundation | Code entry points | What its existence does not prove |
| --- | --- | --- |
| Domain model and layered invalidation | [Model](../../src/domain/model.js), [invalidation](../../src/domain/invalidation.js) | All new contracts are correctly consumed by current workflows. |
| Application and PostgreSQL storage | [Application](../../src/application/traceability-application.js), [production entry](../../src/api/production-server.js) | The complete F001 source-bundle lifecycle and coordinated recovery have passed acceptance. |
| Analysis jobs and checkpoints | [Job runner](../../src/application/workspace-analysis-job-runner.js), [Worker](../../src/application/workspace-analysis-worker.js) | New capture workflows have passed resource, concurrency, and failure validation. |
| Analysis models and CLI adapters | [Model adapters](../../src/analysis/model-adapters.js) | Every legacy execution path satisfies the latest F006 grant contract. |
| Graphs, changes, and execution evidence | [Graph projection](../../src/domain/feature-graph.js), [impact model](../../src/domain/change-impact.js), [execution evidence](../../src/domain/execution-evidence.js) | The complete F001–F004 reference pilot has passed. |

The inspected baseline was `b8aba2434e571fd4ac041c12234ff33f271eddbb` plus existing local work. This iteration changes architecture documents and derived diagrams only. Source inspection does not replace runtime acceptance or promote legacy scanner outputs, Agent conversations, or browser state into authority.

## 8. Iteration history

| Date | Change | Authority |
| --- | --- | --- |
| 2026-09-06 | Record business, application, information, and technology views; add tradeoffs, difficulties, pilot criteria, and implementation limits; align the F002 evidence path and design B receipt semantics. | Architecture discussion thread `thread_mtqkycp918zlran6`; co-creator message `0001788746520984-000176-ec4774ba` authorized recording the discussion directly in the product architecture and iterating through this document. |
| 2026-09-06 | Revise positioning, seven business capabilities, value/roles, delivery coverage, and overall validation against the full vision; render and embed all four views with Archify. | Co-creator correction `0001788749140743-000200-f7d41a90`; complete revised proposal `0001788749143009-000202-d0baa266`; message `0001788751611709-000210-8aaf4a92` explicitly requested tt-a1i/archify diagrams directly in the overall architecture document. |

The diagrams use the installed Archify v2.12, type `architecture`, `classic` preset, and no animation. Static images are native exports of the interactive artifacts. The [delivery record](../diagrams/traqen-product-architecture/architecture-delivery.json) retains specification/HTML SHA-256 values, nine automated checks, visual-review status, and static-export digests. After editing a source, regenerate and validate its HTML and static images together.

Continue updating this document and its derived diagrams, preserving changes and their authority in the history. New elaboration items must identify affected contracts and validation methods. Approved design, recommendations, and implementation acceptance remain separate statuses.
