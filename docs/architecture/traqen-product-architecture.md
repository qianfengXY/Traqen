> Language: **English** · [简体中文](traqen-product-architecture.zh-CN.md)

---
feature_ids: [F001, F002, F003, F004, F006]
topics: [product-architecture, business-architecture, application-architecture, information-architecture, technical-architecture, traceability, change-impact]
doc_kind: product-architecture
created: 2026-07-29
updated: 2026-09-07
---

# Traqen Product Architecture

**Traqen treats business capabilities as core assets, linking intent, design, implementation, configuration, tests, and deployment evidence. It continuously manages their changes and quality gaps so software knowledge can be inherited, quality explained, and delivery verified.**

The architecture comprises **seven business capabilities, one Workspace governance boundary, one versioned evidence model, and a quality loop connecting knowledge, baselines, verification, change, and delivery.**

This document remains the entry point for ongoing architecture updates.

**Current reading entry:** [V3 · business, system, application, data and deployment](#architecture-v3), with nine image-generation figures and explanations of every node, interface and critical runtime mechanism. Sections 1–8 retain the original figures and text for comparison; section 9 is the current interpretation.

 The four original diagrams are generated with [tt-a1i/archify](https://github.com/tt-a1i/archify) and embedded in their respective sections. Each retains an interactive HTML, vector export, and editable JSON source. The shared figures use Chinese labels; this English text defines the same responsibilities. Interactive versions support focus, zoom, light/dark themes, and guided views. Diagrams are derived from this document. The business and information views reuse Archify color categories for capabilities and information objects; actual deployment is defined by the technical view.

**V1/V2 comparison:** Each original Archify diagram remains first, immediately followed by a new image-generation layered view and its numbered node glossary. V2 elaborates the existing architecture; it does not establish new permissions, deployments, Feature scope, or acceptance. Layer IDs L1–L5 are local to each view; B/A/I/T IDs identify the nodes explained below. The diagrams use shared Chinese labels, with matching English explanations.

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

### V2 · Business layered view

![Traqen V2 Business layered architecture](../diagrams/traqen-product-architecture/imagegen-v2/business.png)

**Layer relationships:** L2 reconstructs, confirms, links, and verifies assets in L3; L3 provides referenceable records. L2 supports L1 outcomes, while L4 constrains every capability. Broad arrows denote support or constraints, not execution order. B09 scopes B08 revalidation, B10 drives evidence collection and revalidation, and B11 aggregates traceability, verification, and disposition. New requirements can enter the baseline directly without legacy reconstruction.

| Layer | Responsibility | Nodes | Meaning |
| --- | --- | --- | --- |
| L1 | Business value | B01–B04 | Defines team outcomes; improvement still requires real-task validation. |
| L2 | Core capabilities | B05–B11 | Decomposes seven capabilities and their reconstruction, confirmation, traceability, verification, regression, resolution, and delivery collaboration. |
| L3 | Managed objects | B12–B15 | Defines the business assets, implementation materials, tests, and deployment records managed and linked by capabilities. |
| L4 | Crosscutting governance | B16–B19 | Defines who can act, how approval and risk acceptance work, and how evidence is retained and audited. |

**Node glossary — each ID is explained individually.**

| ID | Layer / node | Meaning, input/output, and boundary |
| --- | --- | --- |
| `B01` | L1 / Transferable knowledge | An outcome of reconstruction and discovery: teams can find rules, implementation, and provenance by capability. Reduced investigation requires observation in real handovers. |
| `B02` | L1 / Shared baselines | Business definition and human decisions establish agreed rules, scope, and responsibility. Agreement means authorized confirmation, not a model majority. |
| `B03` | L1 / Governable change | Impact rationale, coverage limits, and stale evidence inform investigation, review, and retesting. An empty impact list does not prove safety. |
| `B04` | L1 / Verifiable delivery | Connects a version or deployment to actual verification evidence and residual risk for acceptance. It does not automatically approve release. |
| `B05` | L2 / Knowledge reconstruction and assets | Identifies capabilities, processes, and rules in legacy materials, preserves provenance and uncertainty, and organizes discovery by business capability to produce reusable knowledge. |
| `B06` | L2 / Business definition and baselines | Turns new or reconstructed definitions into an authorized baseline of purpose, rules, and scope; maintains stable identity, versions, split/merge lineage, and decision history. |
| `B07` | L2 / Linking and quality traceability | Creates typed links across requirements, design, implementation, configuration, tests, and deployment evidence, supporting forward/backward navigation and explanations of broken links. |
| `B08` | L2 / Test design and verification | Maps confirmed rules to verification requirements, assists test design/reuse, and associates actual execution and assertion results. Test existence alone does not prove verification. |
| `B09` | L2 / Change impact and regression | Compares explicit versions of requirements, implementation, or configuration, identifies affected capabilities and stale support, and recommends review/revalidation while preserving unknowns. |
| `B10` | L2 / Gaps and collaborative resolution | Turns missing, stale, conflicting, or failed links into accountable actions. Evidence collection, correction, risk acceptance, and retesting retain rationale and results for justified closure. |
| `B11` | L2 / Quality reporting and delivery proof | Combines traceability, verification, and disposition records into capability/version/deployment views, history, and evidence exports without replacing distinct dimensions with an opaque score. |
| `B12` | L3 / Capabilities and intent | Governed capabilities, rules, scope, and responsibility form the business baseline: the core assets managed by B06 and linked by B07. |
| `B13` | L3 / Design and implementation assets | Designs, code, APIs, data, and configuration are referenceable, versioned assets with provenance. Existing implementation does not automatically define normative business intent. |
| `B14` | L3 / Tests and executions | Keeps verification specifications, test assets, actual execution contexts, and results distinct so a rule can be traced to concrete verification support. |
| `B15` | L3 / Deployment and evolution evidence | Deployment context, version changes, and historical support define the delivery target to which evidence applies and allow later evolution to be traced. |
| `B16` | L4 / Roles and access scope | Business, engineering, testing, and delivery roles operate within Workspace grants; a role label does not automatically grant publication or source access. |
| `B17` | L4 / Human approval and versioning | Business confirmation, relationship publication, and rule revisions retain authorization and versions; new decisions preserve prior history and do not silently alter existing runs. |
| `B18` | L4 / Gap and risk governance | Defines how gap categories, responsibility, and acceptance rationale are recorded. B10 performs resolution; this governance capability constrains its evidence and traceability. |
| `B19` | L4 / Evidence retention and audit | Preserves provenance, versions, producers, and operation history with durable retention by default; new versions do not automatically delete earlier evidence. |

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

### V2 · Application layered view

![Traqen V2 Application layered architecture](../diagrams/traqen-product-architecture/imagegen-v2/application.png)

**Layer relationships:** L1 invokes L2 use cases; L3 provides authorization, pinned context, and orchestration; L4 persists authoritative outputs. A14 invokes A18 through adapters, and A10 validates A19 executions. F001→F002→F003 is a source/candidate handoff, not automatic pipeline execution. Logical layering does not require every call to traverse each adjacent layer or allow external CLIs to write persistence directly.

| Layer | Responsibility | Nodes | Meaning |
| --- | --- | --- | --- |
| L1 | Interaction and collaboration | A01–A04 | Groups interaction responsibilities by user task. A page can combine responsibilities; new navigation is not committed. |
| L2 | Business services | A05–A12 | Separates source, extraction, candidates, publication, impact, verification, resolution, and projections by outputs and handoffs. |
| L3 | Orchestration and authorization | A13–A15 | Provides pinned configuration, durable jobs, and Workspace permission context for use cases. |
| L4 | Authoritative persistence | A16–A17 | Retains recoverable records, relationships, and immutable content; projections are rebuilt from these records. |
| L5 | Controlled execution integrations | A18–A19 | Separates CLI semantic analysis from Runner/CI execution, with authorized calls and validated result ingestion. |

**Node glossary — each ID is explained individually.**

| ID | Layer / node | Meaning, input/output, and boundary |
| --- | --- | --- |
| `A01` | L1 / Source workbench | Interaction responsibilities for registration, capture progress, inventory, frozen history, and recovery. Uses A05; the browser does not own authoritative state. |
| `A02` | L1 / Knowledge and baseline workbench | Explores APIs, business trees, and evidence and supports candidate review and approval through A06–A08. Viewing and approving remain separate actions. |
| `A03` | L1 / Change and verification workbench | Selects comparison versions, inspects impact rationale and unknowns, and associates executions via A09/A10. Recommendations remain distinct from completed verification. |
| `A04` | L1 / Quality and delivery workbench | Logical interactions for gaps, resolution, version quality, and evidence export. The complete experience requires elaboration; separate new pages are not committed. |
| `A05` | L2 / Source management F001 | Owns capture, frozen bundles, receipts, and current admission, with SourceTruthRepository as authority. Supplies QualifiedSourceInput only to A06. |
| `A06` | L2 / Deterministic extraction F002 | Extracts facts, derivations, references, and API structure from qualified sources, persisting outputs and inherited gaps. Controlled document/configuration reading still needs contract detail. |
| `A07` | L2 / Candidate analysis F003 | Authorized Agents consume A06 persisted evidence to produce scoped semantic candidates with provenance and uncertainty. They cannot bypass source access or publish claims themselves. |
| `A08` | L2 / Review and baseline F003 | Accepts candidates for authorized human decisions and publication of claims and approved relationships into the business tree. Model agreement cannot replace human authority. |
| `A09` | L2 / Change analysis F004 | Combines ChangeSet, A06 facts, A08 claims, and A10 execution evidence to produce CONFIRMED/POSSIBLE/UNKNOWN findings and advisory revalidation guidance. |
| `A10` | L2 / Tests and execution evidence | Organizes TestSpec, existing test assets, and actual external executions, validating version, environment, and results. Existing models do not prove a complete design/verification workflow. |
| `A11` | L2 / Collaborative gap resolution | Links gaps, responsibility, corrective/evidence actions, and verified closure using existing gap/decision foundations. The full collaboration workflow requires elaboration. |
| `A12` | L2 / Quality projections and export | Projects capability/version/deployment evidence and residual risk from the shared model and provides exports. It owns no second editable truth; the full experience needs elaboration. |
| `A13` | L3 / Capability configuration F006 | Maintains global assets, Workspace drafts, applied versions, and explicit Agent grants. Each run pins its configuration; later edits never hot-switch it. |
| `A14` | L3 / Durable job orchestration | Queues lengthy tasks, checkpoints progress, and coordinates retries/recovery with pinned context and execution adapters. Source freezing does not automatically launch the whole pipeline. |
| `A15` | L3 / Workspace governance | Carries access scope, version context, and publication grants into use cases and rejects cross-Workspace or stale-context references. Legacy Project is only an alias. |
| `A16` | L4 / Versioned records and relationships | Authoritatively stores source inventories, facts, decisions, claims, executions, audit records, and relationships from which business/API/quality views are projected. |
| `A17` | L4 / Immutable content storage | Retains source bytes, digests, and referenced content with integrity checks. Byte durability and database publication are coordinated stages. |
| `A18` | L5 / Local CLI Agent | An authorized local CLI integration under F006 v1, invoked by A14 through adapters. Evidence access stays within A06 outputs; global availability does not expand grants. |
| `A19` | L5 / Runner or integrated CI | Performs real tests and supplies environment, assertions, and results for validation by A10. It is not model judgment and creates no implicit CI/deployment gate. |

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

### V2 · Information layered view

![Traqen V2 Information layered architecture](../diagrams/traqen-product-architecture/imagegen-v2/information.png)

**Layer relationships:** I01 establishes ownership and I02/I03 business identity/version. I04 is observed by I06, interpreted by I07, and published as I09 only after I08 approval. I09 links to I10 requirements; I11 produces I12 evidence supporting verification. I13 projects records according to their publication authority, I14 identifies staleness, and I15 associates gaps with dispositions. I16–I18 retain context throughout. Arrows express association/evidence dependencies, not automatic downstream record creation.

| Layer | Responsibility | Nodes | Meaning |
| --- | --- | --- | --- |
| L1 | Identity and business organization | I01–I03 | Establishes ownership, stable business identity, and versions before associating content or conclusions. |
| L2 | Sources and deterministic observations | I04–I06 | Preserves material identity, inventory, coverage limits, and reproducible observations as the basis for interpretation. |
| L3 | Semantic candidates and business authority | I07–I09 | Human review and approval publish claims, keeping hypotheses separate from business confirmation. |
| L4 | Specifications and actual execution | I10–I12 | Distinguishes what should be verified, what actually ran, and what evidence remains. |
| L5 | Trace projections and ongoing governance | I13–I15 | Projects trees/traceability, identifies staleness through change, and associates gaps with dispositions. |
| Crosscutting | Context across layers | I16–I18 | Associates exact run versions, applicable policies, history, and audit with records in every layer. |

**Node glossary — each ID is explained individually.**

| ID | Layer / node | Meaning, input/output, and boundary |
| --- | --- | --- |
| `I01` | L1 / Workspace | Canonical ownership and access boundary for business records, sources, and runs; references, queries, and publication retain and validate this context. |
| `I02` | L1 / Feature | A stable governed business-capability identity, independent of name, path, taxonomy position, and engineering roadmap IDs such as F001. |
| `I03` | L1 / FeatureVersion | A capability revision and its associated baseline. Evolution records retain split/merge lineage without erasing earlier identities or history. |
| `I04` | L2 / SourceBundle | An immutable frozen source bundle linking components, manifest, inventory, gaps, and receipt. Issuance status and current admission are distinct. |
| `I05` | L2 / Inventory and CoverageGap | Inventory records materials and disposition; CoverageGap records missing, unsupported, or unobserved scope. Gaps propagate through dependencies and are not erased by downstream conclusions. |
| `I06` | L2 / Fact and Derivation | Facts are snapshot-bound deterministic observations; derivations and references identify extractor, inputs, rules, and locations. Reproducibility does not prove complete runtime coverage. |
| `I07` | L3 / Candidate | An Agent semantic hypothesis over persisted evidence, retaining provenance, scope, uncertainty, and review status without business-publication authority. |
| `I08` | L3 / Decision | An authorized human review decision with actor, scope, rationale, and outcome. Only approval/publication decisions publish claims; rejection remains historical evidence. |
| `I09` | L3 / Claim | A human-published assertion distinguishing normative requirements, design intent, observed implementation, and quality expectations, with authorization and implementation/verification support. |
| `I10` | L4 / TestSpec | Versioned verification requirements and test specifications for associated rules. Discovering test source does not automatically create an approved TestSpec. |
| `I11` | L4 / TestExecution | A real run with version, environment, assertions, and results, distinct from plans, specifications, and model-generated test recommendations. |
| `I12` | L4 / Evidence | Trustworthy observations and content references produced or associated by actual execution, supporting verification through execution context without granting business authority. |
| `I13` | L5 / Traceability and tree projections | The business tree uses approved claims/relations; the API tree uses deterministic observations; trace paths combine support. All are rebuildable without another editable truth. |
| `I14` | L5 / ChangeSet and invalidation | Records differences and dependency changes between explicit versions to identify impact, staleness, and review scope. Implementation invalidation does not delete business intent. |
| `I15` | L5 / Quality gaps and disposition | Associates coverage gaps, staleness, conflicts, and failures with affected objects, responsibility, acceptance, or correction/retesting results. Complete collaboration still needs elaboration. |
| `I16` | Crosscutting / Run and configuration versions | Retains exact extractor, Agent capability, and pinned run versions with nonsensitive configuration so observations and candidates remain explainable and replayable. |
| `I17` | Crosscutting / Policies and applicability | Defines permission, source, and rule scopes. Evidence with different scopes cannot be combined unconditionally or used to broaden access grants. |
| `I18` | Crosscutting / History and audit | Preserves producers, operations, decisions, and revisions. Corrections append records; earlier evidence and rejected candidates remain inspectable without appearing as currently approved truth. |

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

### V2 · Technical layered view

![Traqen V2 Technical layered architecture](../diagrams/traqen-product-architecture/imagegen-v2/technology.png)

**Layer relationships:** T02 invokes T04; use cases validate through T05 and access authoritative data via T06. T07 orchestrates lengthy work for T08; T09 adapts external execution and validates results without expanding source scope. T10/T11 retain records/bytes; T12 coordinates publication; T13 provides coordinated backups for T14 recovery validation. T16–T18 are constraints, not new independent services. Logical responsibilities do not imply implemented process or microservice separation.

| Layer | Responsibility | Nodes | Meaning |
| --- | --- | --- | --- |
| L1 | Interaction and request entry | T01–T03 | Handles interactive requests and server-side status queries, separating lengthy jobs from page lifetime. |
| L2 | Application and domain | T04–T06 | Application services coordinate use cases, domain rules enforce invariants, and repositories preserve authoritative access boundaries. |
| L3 | Jobs and execution adapters | T07–T09 | Separates durable coordination, bounded workers, and controlled adapters; module boundaries do not prove process isolation. |
| L4 | Persistence and content | T10–T12 | Separately retains database records and file bytes, coordinating reference protection and transactional publication. |
| L5 | Recovery and operation | T13–T15 | Uses coordinated backups, isolated recovery, and capacity diagnostics for recoverable retained content and truthful status. |
| Crosscutting | Constraints across layers | T16–T18 | Enforces access, egress, pinned runs, and default persistence throughout the architecture. |

**Node glossary — each ID is explained individually.**

| ID | Layer / node | Meaning, input/output, and boundary |
| --- | --- | --- |
| `T01` | L1 / Web workbench | React/TypeScript handles input, display, and feedback via the application API. Browser state is not the authoritative copy of jobs or business evidence. |
| `T02` | L1 / Application API | Validates identity, arguments, and Workspace context, invokes use cases, and returns results or job references without holding long-running work in an interactive request. |
| `T03` | L1 / Long-running job status | Reads server-side progress, waiting reasons, failure diagnostics, and recovery actions. Reloads recover durable records instead of relying on browser timers. |
| `T04` | L2 / Application use-case services | Coordinates capture, analysis, review, and impact use cases through domain rules, repositories, and job orchestration. |
| `T05` | L2 / Domain rules | Enforces identity, version, authorization, publication, and layered-invalidation invariants without promoting display state or Agent output to authority. |
| `T06` | L2 / Repository boundaries | Interfaces through which domain/application logic accesses authoritative data. SourceTruthRepository owns source truth; records, relationships, and content references retain their respective ownership. |
| `T07` | L3 / Durable job coordination | Queues lengthy work and persists attempts, checkpoints, and recovery state for bounded scheduling. Retries do not overwrite publication or delete failure history. |
| `T08` | L3 / Bounded workers | Performs capture, deterministic extraction, and model analysis under bounded concurrency, queues, and in-flight resources, persisting progress. Isolation and capacity require acceptance. |
| `T09` | L3 / CLI and Runner adapters | Builds allowlisted executable/argument calls, enforces file/network/tool/credential access, and validates Runner/CI results; accepts neither arbitrary shell strings nor direct model-API execution. |
| `T10` | L4 / PostgreSQL | Durably stores authoritative inventories, jobs, versions, receipts, facts, decisions, executions, and audits, including publication transactions. |
| `T11` | L4 / Dedicated persistent volume | Stores immutable source bytes and digests on the deployment host for replay independent of browsers or original sources. Source data does not belong in product code or design assets. |
| `T12` | L4 / Content references and publication | Makes bytes durable and protects references before atomically publishing components, bundles, and receipts in the database. This is not a cross-filesystem/database transaction. |
| `T13` | L5 / Coordinated backups | Backs up the database together with its referenced bytes and records covered versions. Successful freezing does not prove backup coverage. |
| `T14` | L5 / Isolated recovery and validation | Restores coordinated records/content in isolation and validates reference integrity, blocking on missing or corrupt bytes. Initial single-node failures may pause service. |
| `T15` | L5 / Capacity and run diagnostics | Observes disk, queues, job logs, and recovery actions. Insufficient capacity blocks new writes while retaining history; thresholds and capacity require measurement. |
| `T16` | Crosscutting / Workspace access controls | Enforces Workspace and user/Agent grants on files, networks, tools, and credentials. An executable allowlist alone does not prove isolation. |
| `T17` | Crosscutting / Pinned configuration and egress | Runs use immutable nonsensitive configuration and Secret references. Egress policies constrain source, prompts, outputs, and logs; paused jobs also retain pinned configuration. |
| `T18` | Crosscutting / Persistence and audit rules | Traceable user state defaults to TTL=0, retaining jobs, sources, decisions, executions, and operations. Transient sessions cannot implicitly decide retention or cleanup. |

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
| [Current F001 Chinese design B](../design/F001-workspace-source-truth/README.md) | Current authority for F001 behavior and acceptance; takes precedence over unsynchronized older specs, English documents, and ADR summaries. |
| [F002](../features/F002-feature-api-traceability.md), [F003](../design/F003-traceability-graph/README.md), [F004](../features/F004-change-impact-analysis.md) | Deterministic facts, human publication, execution, and impact contracts. |
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
| 2026-09-07 | Preserve V1; add four image-generation layered comparison views, layer responsibilities, explicit cross-layer handoffs, and 74 numbered node definitions. | Co-creator message `0001788767680385-000243-77af4f52` requests image-generation, preservation of prior figures, and clearer layers and individual node meanings. |

The V1 diagrams use the installed Archify v2.12, type `architecture`, `classic` preset, and no animation. Static images are native exports of the interactive artifacts. The [delivery record](../diagrams/traqen-product-architecture/architecture-delivery.json) retains specification/HTML SHA-256 values, nine automated checks, visual-review status, and static-export digests. After editing a source, regenerate and validate its HTML and static images together.

V2 uses native image-generation and retains its prompts and [generation/verification record](../diagrams/traqen-product-architecture/imagegen-v2/generation-record.json). Its checks cover node labels, layer placement, relationships, legibility, and preserved V1 bytes. V1’s Archify 9/9 checks do not apply to V2 raster images. The earlier omission was treating a component overview as sufficient layering; this iteration adds layer purpose, node decomposition, and explicit handoffs across all four views.

Continue updating this document and its derived diagrams, preserving changes and their authority in the history. New elaboration items must identify affected contracts and validation methods. Approved design, recommendations, and implementation acceptance remain separate statuses.

<a id="architecture-v3"></a>

## 9. V3 · Five architecture views and critical mechanisms

2026-09-07: remodelled at the co-creator's request. Sections 1–8 and their V1/V2 figures remain comparison history; their layers do not establish a complete software architecture. This section describes the same product through business, system, application, data and deployment views, then expands critical components and runtime mechanisms.

**Scope and status:** the product target retains all seven business capabilities. Detailed mechanisms follow confirmed designs. `Design` means a confirmed target contract; `Foundation` means a traceable existing implementation; `Open` means an unresolved design or integration boundary. None means feature acceptance. Modules describe logical ownership, not necessarily independent services. F-numbers identify delivery documents.

| View | Figures and detail | Question answered |
| --- | --- | --- |
| Business | B1 capability decomposition; B2 role collaboration | How does the complete business operate and what does each role obtain? |
| System | S1 boundary and collaboration | How do the environment, major responsibilities and authority boundaries form the solution? |
| Application | A1 modules; A2 source internals; A3 publication sequence | Which software components collaborate through which contracts, including failures? |
| Data | D1 logical relationships; D2 evolution | Which records are authoritative and how do identity, versions and trust evolve? |
| Deployment | P1 runtime topology | Where do software and data run, and which operational conditions remain open? |

The figures use Chinese labels and stable identifiers; the tables below explain the same nodes and contracts in English.

### 9.1 Business architecture: capabilities and collaboration

![B1 Business capability decomposition](../diagrams/traqen-product-architecture/v3/business-capabilities.png)

B1 uses containment, not execution arrows. Its three outer groups organise business responsibilities; they do not introduce organisations or software modules. Legacy reconstruction and timely registration of new intent both feed continuous governance of business functions.

| Node | Sub-capabilities and inspectable output | Value and responsibility |
| --- | --- | --- |
| B01 Knowledge reconstruction | Identify functions/rules, locate evidence and competing explanations, retrieve by function; produce scoped knowledge candidates with provenance. | Engineering/architecture and business preserve knowledge for handover. |
| B02 Business baseline | Confirm purpose, rules, scope and ownership; maintain identity and versions; preserve human decisions. | Product/business owners maintain shared intent. Existing code is not automatically a normative requirement. |
| B03 Quality traceability | Link intent, design, implementation, configuration, tests and deployment; navigate both directions and expose broken links. | Every role can inspect how requirements are implemented and verified. |
| B04 Tests and verification | Organise verification requirements, design/reuse tests, associate real executions and assertions. | QA can identify verified rules and unverified scope. |
| B05 Change and regression | Compare explicit versions, explain impact and unknowns, arrange review/reverification. | Engineering and QA reduce missed change investigations; an empty result is not proof of no impact. |
| B06 Gap disposition | Assign responsibility for missing/stale/conflicting/failed evidence; supplement, repair or accept risk; verify closure. | Accepted risk remains visible and is not a passing verification result. |
| B07 Quality and delivery evidence | Aggregate traceability, verification and disposition by function/version/deployment; export evidence and residual risks. | Business, delivery and operations can inspect acceptance evidence; the initial product does not approve releases automatically. |

These are direct outputs and intended value. Cost, efficiency and defect improvements require real-task validation. Authorisation, human confirmation, version history and audit are cross-capability business rules, not four extra functional layers.

![B2 Cross-role business collaboration](../diagrams/traqen-product-architecture/v3/business-collaboration.png)

B2 is a target business responsibility flow, not an implemented automatic pipeline. The lanes represent business/product, engineering/architecture, QA and delivery/operations; the shared disposition area spans roles. Workspace policy determines actual authority. B-identifiers map back to B1; numbered references represent return steps.

| Step | Input, action, result and branches |
| --- | --- |
| J01 Register new intent | Product registers goals/rules for J03. The complete new-intent interaction contract remains open. |
| J02 Reconstruct existing knowledge | Engineering produces candidates and evidence from authorised materials for J03; inference is not a confirmed requirement. |
| J03 Review and confirm baseline | Authorised approval publishes the baseline; requests for evidence return to J02; rejection retains history without publishing that candidate. |
| J04 Associate design and implementation | Link the baseline to explicit implementation versions; expose missing or conflicting evidence. |
| J05 Establish verification scope | Design/reuse tests from rules and implementation relationships; distinguish specifications from executions. |
| J06 Associate real execution | Ingest results with version, runner, environment, time and assertions; missing results remain unverified. |
| J07 Inspect gaps and risks | Missing, failed, stale or conflicting evidence enters J08; sufficiently supported items proceed to J09. |
| J08 Disposition and review | Supplement/repair and return to the relevant activity; authorised risk acceptance may proceed to J09 with residual risk visible. Acceptance is not PASS. |
| J09 Inspect delivery evidence | Business/delivery inspect evidence and risk for the particular version or deployment; the external release process makes its own decision. |
| J10 Compare a new change | Select explicit comparison versions, identify impact/unknowns, return to J04 for relationship review and J05 for reverification. Preserve old baselines/results. |

### 9.2 System architecture: boundaries, trust and collaboration

![S1 System boundary and major collaborations](../diagrams/traqen-product-architecture/v3/system-collaboration.png)

S1 uses the paired S04 reference to connect candidate analysis with the local CLI; source IDs inside nodes also express data dependencies. S1 encloses the Traqen product. Internal rectangles are responsibilities, not physical processes. Humans, Git/directory materials, CLIs and execution systems provide different kinds of authority.

| Node | Responsibility, input and output |
| --- | --- |
| S01 Workbench and access | Accept operations, version selections and queries; carry identity/Workspace context. The browser is not an independent record authority. |
| S02 Source truth | Capture, reconcile, confirm and freeze Git/directory inputs; provide QualifiedSourceInput to S03. F001 owns source records and admission. |
| S03 Deterministic evidence | Produce snapshot-bound Fact, EvidenceLink, Derivation and Gap for S04/S06/S07; do not decide business ownership. |
| S04 Candidate analysis | Use authorised CLIs over S03's persisted evidence; retain scoped candidates and uncertainty. Candidates do not directly enter the published business tree. |
| S05 Human governance | Authorised people decide and publish approved business objects/relationships. The full direct human-intent registration contract remains open. |
| S06 Verification and impact | Associate actual execution and compare versions using facts, claims and execution evidence; provide verification and advisory impact, not automatic merge/deploy actions. |
| S07 Traceability and quality projections | Derive business/API/trace/impact/quality views from the same versioned records. Full gap collaboration and delivery export remain open. |
| S08 Execution and capability control | Freeze Run inputs and applied configuration, resolve grants, coordinate execution/recovery. Configuration cannot expand source scope; paused runs do not hot-switch configuration. |
| S09 Versioned records and content | Persist module-owned facts, candidates, decisions, execution records and source bytes. A shared store does not allow arbitrary cross-module writes. |

S02→S03 is admission; S03→S04 is the evidence-access boundary; S04→S05 separates inference from human authority; execution systems→S06 separate observed execution from static analysis. Projection references never grant raw-repository access. Starting F002 is a separate explicit action after freezing F001.

An external CLI may contact its provider; egress remains constrained by grants/policy. F006 v1 uses allowlisted local CLIs, not the legacy direct-model API path. Initial Runner/CI report formats and complete ingestion experience remain open.

### 9.3 Application architecture: modules, components and runtime

![A1 Application modules and contracts](../diagrams/traqen-product-architecture/v3/application-modules.png)

A1 uses paired H1 ports for HTTP human review through I03 into M04. M03 references I02 from M02; M08 references I06 into M03. These references express contracts, not extra components.

A1 allocates target logical responsibilities M01–M08; they may run within one modular application. Contracts below are logical agreements, not invented HTTP endpoints.

| Module | Owned writes and external contract | Design / implementation foundation |
| --- | --- | --- |
| M01 Source management | Sources, capture tasks, manifest, gaps/acceptance, Bundle and Receipt; I01 qualified input. See A2. | F001 Chinese design B §8/§11; legacy source code does not prove completion of the new contract. |
| M02 Extraction | Fact, Derivation, EvidenceLink and coverage gaps; I02 version-bound evidence reads. | F002; src/scanner/ and src/domain/facts.js. |
| M03 Candidate analysis | Analysis runs and Candidate; provide candidates and I02 evidence references to M04. | F003; src/analysis/ and src/skills/. |
| M04 Baseline governance | Receive I03 human review, validate actor/rules, write Decision, Feature/Claim and approved relationships. | governance.js, decision-governance.js, review.js; alignment with the new F003 workflow remains open. |
| M05 Tests and execution | TestSpec, trusted TestExecution, Evidence and VerificationResult; I04 actual execution ingestion. | test-spec.js, execution-evidence.js, src/runner/; integration formats remain open. |
| M06 Change and invalidation | I05 consumes baseline/target, facts, claims and execution; produce ChangeSet, impact classification and invalidation evidence. | F004; change-impact.js and invalidation.js. |
| M07 Queries and projections | Compose read contracts into business/API/quality views; graph editing cannot bypass M04. | feature-graph.js, trace-chain.js, product-metrics.js. |
| M08 Capabilities and execution coordination | Fixed configuration/grants, execution coordination and recovery, CLI adapter calls; no human confirmation on behalf of business owners. | F006; workspace-execution-profile.js and workspace-analysis-job-runner.js foundations. |

| Contract | Input → output | Invariants and failures |
| --- | --- | --- |
| I01 Source admission | Workspace/Bundle/Receipt references → QualifiedSourceInput | Recheck permission, integrity and acceptance expiry; inherit complete gaps; reject path/ref/upload sessions. M02 is the only direct consumer. |
| I02 Evidence access | Persisted extraction-result version and bounded query scope → Fact/EvidenceLink/Derivation/complete Gap set | Bind source/extractor versions; controlled document/configuration access, pagination closure and limits remain open between F002/F003. |
| I03 Human review | Candidate, evidence scope and actor → review record / approved objects | Validate grants, versions and references; rejected or insufficient candidates remain; model consensus cannot publish. Exact concurrent-review protocol remains open. |
| I04 Execution ingestion | Spec reference, runner/environment/snapshot/time and actual results → execution/verification | Validate provenance and outcomes; a test-file reference cannot become an execution. Missing evidence remains unverified/a gap. |
| I05 Impact query | Explicit baseline/target and evidence revision → paths, classifications and reverification advice | Preserve CONFIRMED/POSSIBLE/UNKNOWN and coverage; empty lists do not prove safety. |
| I06 Fixed Run context | Applied revision, explicit agent grants and inputs → fixed execution context | Effective Workspace capabilities intersect explicit agent grants. The effective set includes inherited active globals not disabled in the Workspace plus Workspace-local capabilities; global disable/delete limits inherited assets. No paused-run hot switch. |

HTTP entry points authenticate, validate and call use cases; domain modules enforce invariants; storage ports control persistence and PostgreSQL adapters implement it. SourceTruthRepository retains its source ownership rather than disappearing into a generic shared Repository.

![A2 Source-management internals](../diagrams/traqen-product-architecture/v3/source-components.png)

| Component | Input → output and boundary |
| --- | --- |
| C01 GitSourceGateway | Authorised Git reference → exact commit/tree/blob; no dirty working tree or repository-controlled execution. |
| C02 DirectoryIngestGateway | Complete enumeration and file streams → normalised paths and verified bytes; browser enumeration is not a filesystem point-in-time snapshot. |
| C03 SourcePreflightService | Input/scope/permission/policy → capture-preflight report with reasons; passing does not mean frozen or admissible. Integrity/security blocks cannot be waived. |
| C04 SnapshotStore | Chunks, bytes and manifests → private preparation, checkpoints and verified blobs; unpublished content is invisible downstream. |
| C05 CoverageAssembler | Manifest plus item dispositions → Inventory, Gap and reconciliation; every item needs its terminal disposition. |
| C06 Freeze/publication use case | Confirmed candidate plus valid acceptance → atomic Bundle/Receipt visibility and task result. This is a responsibility name, not a claimed existing class. |
| C07 SourceTruthAdmission | Published references → current qualified input; recheck permission, integrity and expiry; only M02 consumes it. |
| C08 ManifestDiffer | Two frozen manifests → file add/modify/delete; report scope changes separately, not business impact. |
| C09 SourceTruthRepository | Source ownership/access boundary used by C01–C08; not a second data copy. |

M08 coordinates execution/recovery; M01/SourceTruthRepository still owns source task states and checkpoints. M02 starts from I01 plus fixed extraction configuration; I02 is the downstream read contract for already-persisted evidence.

C06 receives an explicit freeze action; C07 receives a separate F002 admission request. Gateways prepare materials; successful freezing never calls F002 automatically.

A2 identifies C01/C02 as the verified-byte inputs to C04, C06 publication as the input read by C07, and two frozen C04 manifests as C08 inputs. P1 expands storage placement.

![A3 Source publication and failure recovery sequence](../diagrams/traqen-product-architecture/v3/source-publication-sequence.png)

Participants are the authorised user/workbench, publication use case, file volume, PostgreSQL and F002 admission caller. The file volume does not join a PostgreSQL transaction; committed publication records govern downstream visibility.

1. Explicit freeze binds the operation, candidate revision and current holder. Repeated requests query the same operation.
2. Validate manifest/dispositions/gaps/acceptance/integrity, durably persist required bytes, protect references, and privately prewrite preparation indexes in batches.
3. The final transaction rechecks current permission/policy, absolute acceptance expiry, preparation revision and holder generation, then commits component references, Bundle, Receipt, lineage, operation result and successful task state.
4. **Bytes durable, transaction failed:** retain protected private preparation for verified reuse; no consumable Receipt exists.
5. **Transaction committed, response lost:** read the operation result and return the original bundle, not a second publication. Return current eligibility too; do not extend expiry.
6. A separate explicit F002 start rechecks C07 and obtains I01. Revoked access, damaged bytes or expired acceptance deny new admission while retaining history.

Cancellation is allowed before finalisation; after finalisation begins, query/recover rather than cancel. Request deduplication, identical content and renewal of the same Bundle are distinct identities.

### 9.4 Data architecture: authoritative relationships and evolution

![D1 Logical data relationships](../diagrams/traqen-product-architecture/v3/data-model.png)

The paired R1 ports connect D10 Claim and D11 TestSpec through exact-version many-to-many associations. Solid edges retain their stated reference/governance/evidence meaning; the amber mapping is unresolved, not an implemented foreign key.

D1 combines target concepts with existing storage mappings. Only supported cardinalities are asserted. All records remain Workspace/tenant-scoped; repetitive ownership edges are omitted for readability.

| Node | Meaning, identity and relationships |
| --- | --- |
| D01 Workspace | Governance/reference-validation scope. Legacy project is an existing mapping, not permission to silently replace identity. |
| D02 SourceBundle | F001 immutable source collection: 1–2 components, at most one Git and one directory. Distinct from the four-component execution SnapshotManifest. |
| D03 Component/Manifest | Immutable Git/directory identity and complete manifest; reusable across bundles. |
| D04 Receipt/Acceptance | A published bundle has one or more receipts; renewal appends a receipt with exact policy/gaps/acceptances. Expiry is not retention TTL. |
| D05 Fact/Derivation | Observation with fixed source and extraction provenance/evidence links; revised derivations retain old facts. |
| D06 Candidate | Scoped inference produced by a run, with evidence references; rejection retains it. No universal one-to-one Claim mapping is assumed. |
| D07 Decision | Human governance of a specific candidate/claim, actor, scope and rationale; acceptance, rejection, supplementation and replacement differ. |
| D08 Feature | Stable governed business identity, independent of name, taxonomy or source path; links to versions and claims. |
| D09 FeatureVersion | Versioned business attributes. The existing Claim foreign key targets Feature, not FeatureVersion. |
| D10 Claim | Version- and scope-specific assertion; Decision supplies business authority, execution evidence supplies verification. |
| D11 TestSpec | Verification specification with versioned links to one or more Claims; the relationship is many-to-many. |
| D12 TestExecution | Actual execution of a TestSpec version with runner/environment/time/snapshot; a spec may have zero or many executions. |
| D13 Evidence/VerificationResult | Evidence records observations; VerificationResult evaluates the associated Claim as PASS/FAIL/INCONCLUSIVE. Sharing a visual box does not merge entities/tables. |
| D14 SnapshotManifest | Existing source/build/deployment/runtime context. Its mapping to F001 SourceBundle remains open; no 1:1 assumption. |

| Relationship | Evidence and limitation |
| --- | --- |
| Bundle → Component: 1..2 | F001 B, at most one of each input type; components are reusable. |
| Published Bundle → Receipt: 1..* | Renewal keeps Bundle identity. Receipts can differ in eligibility and backup coverage. |
| Feature → FeatureVersion / Claim: 0..* | Identity, versions and claims are persisted separately; a UI node is not necessarily one row. |
| Claim ↔ TestSpec: many-to-many | test_spec_claim references exact spec/claim versions; publication/execution rules apply separately. |
| TestSpec → TestExecution: 0..* | Do not create placeholder executions when none actually happened. |
| Candidate → Decision → Claim | Typed governance, not unconditional generation or an invented universal 1:1 lifecycle. |

M01 owns source records/content admission; M02 extracted facts; M03 analysis runs/candidates; M04 human governance; M05 specifications/execution/verification; M06 comparisons/invalidation; M07 only projections. PostgreSQL holds transactional records, the dedicated volume holds F001 bytes, and indexes can be rebuilt. The canonical graph is a shared logical model, not a new graph-database commitment.

![D2 Independent evolution of versions, eligibility and verification](../diagrams/traqen-product-architecture/v3/data-evolution.png)

| Evolution track | Changes and retention |
| --- | --- |
| E01 Frozen content / current admission | Bundle B remains unchanged; expired R1 denies new admission; explicit re-acceptance issues R2 and preserves R1. Renewal cannot waive security/integrity blocks. |
| E02 Business identity / human authority | Feature F remains stable; business changes create new versions/claims and decisions. Code changes or model votes cannot silently rewrite intent. |
| E03 Implementation / verification / freshness | New snapshots require affected mappings/verification to be reviewed; preserve old executions in their original context and create actual new executions. No inherited PASS without reverification. |
| E04 Projections / coverage | Derive views from exact revisions; keep authority, conformance, verification, freshness, conflict and coverage separate. |

History, tasks and audit default to TTL=0. Append versions; prove backup coverage for the exact Bundle/Receipt and complete referenced set. Capacity exhaustion stops new writes with recovery actions, not automatic history deletion. Incomplete recovery denies new admission.

### 9.5 Deployment architecture: runtime topology and failure domains

![P1 Runtime foundations and confirmed single-node source target](../diagrams/traqen-product-architecture/v3/deployment.png)

Paired E1 ports connect P04 CLI egress to P10 under policy; they do not represent database access and are unrelated to the E01 evolution track in D2.

P1 relates existing runtime foundations to the confirmed F001 single-node storage target; it is not evidence of a production deployment. DATABASE_URL selects the database location. Mount the dedicated volume on the node handling F001 bytes; this diagram does not decide whether PostgreSQL is local or remote. Launching a CLI does not establish operating-system file/network isolation.

| Node | Existing foundation or target condition |
| --- | --- |
| P01 Browser | React/TypeScript workbench; query authoritative services, never access database/source volume directly. |
| P02 Web service | Serves the workbench; vinext development uses port 3000. Production web hosting remains open. |
| P03 Node API/application process | HTTP entry composes application/storage; production-server.js connects PostgreSQL. Worker/JobRunner classes do not prove an independent daemon. |
| P04 CLI subprocess execution | F006 allowlisted local CLI target with bounded evidence/grants. Actual file/network/credential isolation must be implemented and verified. |
| P05 PostgreSQL | Transactional records and recovery foundation. Deployment sets protected access; an existing production entry does not prove new F001 migrations exist. |
| P06 Dedicated persistent volume | Confirmed F001 target: Workspace/run staging, verified blobs and reference protection; never a container temporary layer or repository directory. |
| P07 Independent-failure-domain backup | Matching database watermark, referenced bytes and closed completion record. Configure target, schedule and key recovery; a same-disk directory is insufficient. |
| P08 Git/directory source | Controlled read-only Git or browser-uploaded bytes, not arbitrary server access to a user's local path. |
| P09 External execution system | Actual Runner/CI output; initial formats/network contracts remain open. Traqen does not automatically control its deployment/release. |
| P10 CLI provider | Possible CLI egress destination, constrained by grants and policy; local CLI does not mean local-only data processing. |

**Development differs from the target:** start-development.js launches Web 3000 and development API 3100 as two child processes. The development API uses memory storage, not persistent acceptance data. The production API supports PostgreSQL; existing application/worker classes do not prove the complete F001 freeze/recovery path. Traqen does not use Clowder AI ports 3003/3004 or production Redis 6399.

An application-node outage interrupts interaction/capture/CLI work; recovery relies on persisted tasks, not browser survival. Database unavailability or volume corruption blocks publication/admission. Disaster recovery restores one complete successful backup set and validates references before analysis resumes. An earlier restored watermark must be visible rather than claiming later data survived.

### 9.6 Cross-view traceability and open contracts

| Business activity | System / application owner | Authoritative records | Deployment and validation |
| --- | --- | --- | --- |
| B01 Reconstruction | S02–S04 / M01–M03 | Bundle, Receipt, Fact, Candidate | P03/P04/P05/P06: admission, controlled reads, visible unknowns. |
| B02 Baseline | S05 / M04 | Feature, Claim, Decision | P03/P05: authorisation, versions, no publication on rejection/supplementation. |
| B03 Traceability | S03/S05/S07 / M02/M04/M07 | Typed version-bound relationships | P03/P05: evidence navigation, no independent projection truth. |
| B04 Verification | S06 / M05 | TestSpec, TestExecution, Evidence | P09→P03/P05: no execution record without actual execution. |
| B05 Regression | S06 / M06 | ChangeSet and invalidation/impact | P03/P05: incomplete coverage preserves UNKNOWN. |
| B06/B07 Disposition/delivery | S05/S06/S07 / M04–M07 | Gaps, dispositions, verification, projections | Complete collaboration/export contracts remain open; accepted risk is neither PASS nor release approval. |

Explicit unresolved design boundaries:

- Controlled F002→F003 document/configuration evidence reads: version binding, complete pagination, limits and renewed permission checks.
- Exact mapping/migration between F001 SourceBundle and the existing four-component SnapshotManifest; no identity conflation or presumed 1:1.
- New F003 workflow alignment with existing governance/candidate records: roles, concurrent revisions, supplementation, rejection and replacement.
- Complete interactions/data contracts for new-intent registration, gap ownership collaboration and deployment-specific delivery exports.
- Real CLI isolation, production web hosting, initial execution-result formats, paired backup configuration and recovery exercises.

Exposing these boundaries is part of the architecture description. This redraw does not implement them or silently make new product decisions. Confirmed constraints and proposals remain distinct for subsequent iteration at this same entry.

### 9.7 Sources and expression checks

Sources are the [product vision](../../README.md), [existing business capability map](#1-business-architecture-lifecycle-quality-traceability), [authoritative F001 Chinese design B](../design/F001-workspace-source-truth/README.md), [F002](../features/F002-feature-api-traceability.md), [F003](../design/F003-traceability-graph/README.md), [F004](../features/F004-change-impact-analysis.md), [F006](../features/F006-workspace-capability-settings.md), [ADR-0001](../decisions/ADR-0001-canonical-traceability-ontology.md), and implementation anchors above. F001 B overrides older source wording in Specs.

Notation references: [C4 software structure](https://c4model.com/diagrams/container), [component decomposition](https://c4model.com/diagrams/component), [deployment](https://c4model.com/diagrams/deployment), and [arc42 runtime views](https://docs.arc42.org/section-6/). These explain representation; Traqen nodes/mechanisms come from project sources.

Figures are generated with native image-generation. Prompts and generation records are in the adjacent v3 directory. Image, identifier and link checks validate expression; source access, atomic publication, identity/cardinality and runtime-status semantics require content checks too. Generation success or visual checks are not software acceptance.
