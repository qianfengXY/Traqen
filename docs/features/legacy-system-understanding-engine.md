> Language: **English** · [简体中文](legacy-system-understanding-engine.zh-CN.md)

---
feature_ids: [F001]
related_features: []
topics:
  - source-inventory
  - deterministic-facts
  - analysis-agent
  - reverse-skills
  - reconciliation
  - correctness-evaluation
  - dogfood
doc_kind: feature-design
created: 2026-07-29
status: proposed
priority: P0
---

# Legacy-System Understanding Engine

> Feature home: [F001](F001-legacy-system-understanding.md)

## 1. Design objective

F001 must produce a reviewable Candidate graph that explains an existing system and makes its blind spots measurable. It must not merely finish a file loop, classify path names, or ask one model to summarize a repository.

The engine is successful when:

- the analysis scope is complete and version-pinned;
- deterministic observations are source-accurate;
- independent analysis lanes can discover what another lane missed;
- every semantic conclusion has bounded evidence;
- duplicates, conflicts, and unknowns remain visible;
- reviewed capabilities and relations are recovered with measured quality;
- the same Snapshot can be replayed and incrementally updated;
- Traqen can analyze and display Traqen itself.

Browser refresh safety is part of the execution design, not the definition of understanding correctness.

## 2. Current implementation gap

The current implementation contains useful foundations:

- `SnapshotManifest`, `FactBundle`, stable fact IDs, and attestation;
- JavaScript project scanning and browser-side multilingual heuristics;
- `AnalysisAgent` WorkUnit planning, evidence validation, and checkpoints;
- independent Reverse Skill contracts and reconciliation;
- Candidate/governed object separation;
- Feature graph, TraceChain, impact, TestSpec, Runner, and Evidence domains.

However, existing real-repository reports mainly prove that Traqen can enumerate many files and reduce obvious noise. They do not establish:

- a complete denominator for unsupported or excluded content;
- reviewed recall of important capabilities;
- precision of Candidate Features and relations;
- correct links among requirements, design, code, tests, results, and configuration;
- equivalence of full and incremental analysis;
- a product-visible Traqen self-graph.

The current browser scanner and canonical server scanner also have different language and relation behavior. A number of Candidate roots are derived from paths or scanner discoveries; this can make a missed parser observation blind downstream Agent planning.

## 3. Correctness contract

An `UnderstandingEvaluation` is versioned by:

```text
evaluationPolicyId
projectId
snapshotManifestId
engineVersion
extractorSetDigest
analysisProfileDigest
truthSetVersion
```

It reports independent metrics and evidence:

```text
inventoryCoverage
supportedArtifactCoverage
factFixturePassRate
reviewedAnchorRecall
reviewedCandidatePrecision
requiredRelationPassRate
forbiddenRelationPassRate
provenanceValidity
replayStability
incrementalEquivalence
unknownAndConflictCounts
```

Metric denominators, sample selection, review decisions, and gaps are part of the report. The UI may summarize dimensions, but cannot collapse them into an unexplained “accuracy” score.

## 4. Terminal architecture

```text
SourceRegistration
  → Snapshot capture
  → ArtifactInventory ───────────────────────────────────────┐
       ├─ deterministic extractor WorkUnits → FactBundle     │
       ├─ document/contract WorkUnits → CandidateBundles     │
       ├─ test/config/result WorkUnits → CandidateBundles    │
       ├─ Agent/Skill source-slice WorkUnits → CandidateBundles
       └─ gap diagnostics                                    │
                                                              ▼
                                         CandidateReconciliation
                                           ├─ CandidateGraph
                                           ├─ ConflictLedger
                                           ├─ CoverageLedger
                                           └─ CandidateLineage
                                                              │
                                      deterministic validation │
                                                              ▼
                                          Review + Decision
                                                              │
                                                              ▼
                                           Canonical graph
```

`WorkspaceAnalysisJob` durably orchestrates the stages. The browser observes it; it does not execute them.

## 5. Domain objects

### 5.1 `ArtifactInventory`

One row per Snapshot artifact:

```json
{
  "artifactId": "ART-...",
  "snapshotManifestId": "SNAP-...",
  "relativePath": "src/domain/trace-chain.js",
  "contentDigest": "sha256:...",
  "mediaType": "text/javascript",
  "artifactKinds": ["SOURCE", "DOMAIN_LOGIC"],
  "language": "javascript",
  "disposition": "INCLUDED",
  "reasonCode": null,
  "sizeBytes": 1234
}
```

`disposition` is one of:

- `INCLUDED`
- `EXCLUDED_BY_POLICY`
- `UNSUPPORTED`
- `GENERATED`
- `BINARY`
- `OVERSIZED`
- `SECRET_REDACTED`
- `READ_FAILED`

An Artifact remains counted regardless of disposition.

### 5.2 `ExtractorCapability`

Declares:

- supported artifact type and language/version;
- Fact node/edge types;
- parser and adapter version;
- known unsupported constructs;
- fallback behavior;
- fixture suite and quality status.

A text-regex fallback is a separately named capability. It cannot impersonate AST support.

### 5.3 `SourceSlice`

An Agent or Skill cannot read an arbitrary path. It requests an authorized, bounded source projection from the broker using stable IDs inside one Snapshot:

```ts
type SourceSliceRequest = {
  id: string;
  projectId: string;
  snapshotManifestId: string;
  analysisRunId: string;
  workUnitId: string;
  producerRef: string;
  purpose:
    | "ENTRYPOINT_RECOVERY"
    | "RELATION_RESOLUTION"
    | "CONTRADICTION_PROBE"
    | "TEST_INTENT"
    | "CONFIG_INFLUENCE";
  selectors: Array<{
    artifactId: string;
    symbolId?: string;
    startLine?: number;
    endLine?: number;
  }>;
  allowedFactIds: string[];
  maxBytes: number;   // traqen-source-slice-v1 default/hard cap: 64 KiB
  maxTokens: number;  // traqen-source-slice-v1 default/hard cap: 12,000
  policyId: string;
  requestedAt: string;
};

type SourceSlice = {
  id: string;
  requestId: string;
  artifactSlices: Array<{
    artifactId: string;
    relativePath: string;
    contentDigest: string;
    range: { startLine: number; endLine: number };
    redactedText?: string;
    structuralSummary?: object;
  }>;
  factIds: string[];
  redactions: Array<{ kind: string; range: object }>;
  contentDigest: string;
  truncated: boolean;
  omittedReasons: string[];
  policyDecisionId: string;
  createdAt: string;
};
```

API boundary:

```http
POST /v1/projects/{projectId}/analysis-runs/{runId}/work-units/{workUnitId}/source-slices
GET  /v1/projects/{projectId}/analysis-runs/{runId}/work-units/{workUnitId}/source-slices/{sliceId}
```

- Only the server Agent/Skill runtime identity may create requests; an ordinary browser cannot use the broker for arbitrary source reads.
- Selectors use Artifact/Symbol IDs from the same Snapshot. Absolute paths, arbitrary globs, and cross-Snapshot ranges are forbidden.
- `allowedFactIds` is a subset of the WorkUnit evidence set, and returned Facts cannot exceed that boundary.
- Before content leaves the trusted runner, the broker applies deterministic secret detection, redaction, range clipping, and budgets, and records purpose, policy, and request/response digests.
- Failures are deterministic: `SOURCE_SLICE_SCOPE_VIOLATION` (403), `ARTIFACT_NOT_IN_SNAPSHOT` (422), `FACT_NOT_IN_WORK_UNIT` (422), `SECRET_POLICY_BLOCKED` (422), `SOURCE_SLICE_BUDGET_EXCEEDED` (413), `UNSUPPORTED_BINARY` (422), and `STALE_ANALYSIS_RUN` (409).
- Denial or truncation becomes a WorkUnit Diagnostic/Gap; the runtime cannot bypass the broker with direct source access.

### 5.4 `UnderstandingWorkUnit`

WorkUnits are deterministically identified from Snapshot, lane, scope, adapter version, and policy:

```text
sha256(snapshotId + lane + scope + producerVersion + policyDigest)
```

WorkUnit scopes include:

- repository/module inventory shards;
- entrypoints and public interfaces;
- document sections and API operations;
- code symbol neighborhoods;
- test/config/data clusters;
- cross-file relation resolution;
- changed graph regions;
- explicit gap probes.

Planning starts from the source manifest and known entrypoint conventions, not only from discovered Fact roots.

### 5.5 `CandidateRelation`

Every semantic edge records:

- typed source and target Candidate or Fact references;
- `evidenceFactIds` and/or authorized source-slice references;
- producer and producer version;
- Snapshot and WorkUnit IDs;
- confidence dimensions and deterministic cap;
- alternative interpretations and conflicts;
- lineage to prior Snapshot Candidates.

## 6. Analysis lanes

### 6.1 Inventory and classification

The inventory lane:

1. walks the sealed Snapshot;
2. applies explicit include/exclude policy;
3. detects artifact kinds from content and conventions;
4. records every disposition;
5. creates coverage WorkUnits by module and artifact class.

Path names help route work but are not semantic proof.

### 6.2 Deterministic extraction

Extractors create Facts for supported structures, including:

- modules, symbols, imports, calls, inheritance, routes, RPC methods, commands, and jobs;
- document sections, declared requirements, ADR decisions, OpenAPI operations, and schemas;
- data models, migrations, queries, reads, and writes;
- configuration keys and references, never real secret values;
- test suites, cases, assertions, fixtures, and links to code;
- build/test report identities and execution metadata.

Parse diagnostics and incomplete constructs become gaps. Unsupported syntax never silently falls back to “success”.

### 6.3 Document and contract lane

This lane independently processes requirements, designs, ADRs, Feature documents, OpenAPI, schemas, and runbooks:

- deterministic parsing preserves sections, operations, schemas, and explicit cross-references as Facts;
- semantic work proposes Requirement/Design/API Candidates and their relations;
- prose cannot automatically become a governed Claim;
- document/code disagreement enters ConflictLedger rather than silently choosing “docs win” or “code wins.”

### 6.4 Test, configuration, result, and execution lane

The engine separately emits:

- `TestAssetFact`: a static test file/case/assertion was observed;
- `CandidateTestIntent`: a proposed rule the asset may exercise;
- `ConfigurationFact`: configuration key, safe default/presence, and consumers, never real secret values;
- `ExecutionArtifactFact`: a build/test result artifact was observed but does not yet prove a trusted execution lineage;
- `TestSpec`: only after governance;
- `TestExecution`: one actual controlled execution;
- `VerificationResult`: PASS/FAIL/INCONCLUSIVE for a Claim;
- `Evidence`: protected output supporting that result.

A filename containing “test”, an artifact named “passed”, or a model claim of verification cannot close a verification gap.

### 6.5 Independent Agent/Skill semantic lane

Agent/Skill analysis uses multiple bounded perspectives:

- business capability and rule reconstruction;
- API/command/event surface reconstruction;
- workflow, actor, state, and exception reconstruction;
- design-to-implementation mapping;
- data and configuration influence;
- test intent and rule coverage;
- missing relation and contradiction probes.

Each perspective may request additional SourceSlices within policy. It returns structured Candidates, not only Markdown.

Direct-source analysis is independent of deterministic detection, but it cannot bypass deterministic evidence and schema validation.

### 6.6 Reconciliation lane

Reconciliation combines candidates using evidence and semantics:

- exact content/stable-reference match;
- historical lineage match;
- compatible scope and constraint match;
- suspected duplicate;
- suspected parent/child;
- contradiction;
- unresolved alternative.

It does not generate business-stable Feature IDs from names, paths, domains, or hashes. An uncertain identity goes to review.

## 7. Work planning and iterative retrieval

The planner cannot treat “nodes found by scanners” as the complete task universe. It creates two planning waves.

The **manifest/convention-derived initial plan** exists before semantic Facts are complete and uses:

- complete ArtifactInventory;
- build/package/module/entrypoint conventions from a versioned `ConventionRegistry`;
- document and API manifests;
- test/config/data clusters;
- content types, relative-path classes, and safe structural summaries;
- module/entrypoint lineage from the prior Snapshot.

It creates at least one coverage WorkUnit per inventory partition and independent root WorkUnits for entrypoints, public interfaces, documents, tests, and configuration. If a deterministic extractor intentionally misses an entrypoint, an Agent/Skill can still request a SourceSlice by Artifact ID and produce an evidenced Candidate.

The **Fact-enriched plan** then adds:

- extractor diagnostics;
- parsed Symbol/Route/Data relations;
- missing or contradictory relations;
- fine-grained Candidate lineage from the prior Snapshot.

During execution, lanes may enqueue bounded follow-up WorkUnits for:

- an unresolved call target;
- an undocumented endpoint;
- a Claim with no implementation relation;
- a test with ambiguous intent;
- a configuration reference with unknown consumers;
- an unresolved document/code contradiction.

Follow-up depth, budget, and reason are recorded. Budget exhaustion becomes `UNEXPLORED_BUDGET_LIMIT`, not completion.

The production planner never reads the truth set. The evaluation harness compares output only after the run. A held-out miss informs a later engineering change or a diagnostic rerun described by a public discrepancy category; it never injects the hidden answer into the same analysis.

## 8. Incremental analysis

When a project has no published graph, both `AUTO` and `FULL` perform complete inventory, all lanes, full reconciliation, and evaluation; `INCREMENTAL` is rejected. The first successful run atomically publishes the initial `CurrentGraphHead`.

After a `CurrentGraphHead` exists, `AUTO` defaults to incremental analysis for a new Snapshot:

1. compare ArtifactInventory by content identity;
2. invalidate Facts for changed extractor inputs;
3. recompute cross-file relations whose dependency frontier changed;
4. re-run semantic WorkUnits whose evidence or producer version changed;
5. retain unchanged Candidate lineage;
6. mark governed Claims as potentially stale rather than deleting Decisions;
7. create a `ChangeSet` from the prior Snapshot to the new Snapshot;
8. create an `ImpactAssessment` listing affected Features/Claims/TestSpecs/dependencies, invalidation reasons, and revalidation work;
9. build an immutable `GraphRevision(status=BUILDING)`;
10. compare the incremental graph with the policy-required full rebuild scope;
11. after evaluation passes, mark the GraphRevision `PUBLISHED` and move `CurrentGraphHead` in the same transaction.

An incremental run is accepted only if its graph is equivalent to a full run for the evaluated unaffected/affected scopes, apart from permitted timestamps and run IDs.

If build, evaluation, or publication fails, the prior `CurrentGraphHead` remains current. The failed GraphRevision and diagnostics remain available for review.

### 8.1 Current projection and history semantics

- Default Graph APIs/UI read only the latest published Revision referenced by `CurrentGraphHead`.
- GraphRevisions, SnapshotManifests, FactBundles, Candidate lineage, Decisions, FeatureVersions, Claim/TestSpec versions, ChangeSets, ImpactAssessments, Executions, and Evidence are immutable and time-queryable.
- A business FeatureVersion is created only through a Decision. Code, configuration, test, or deployment changes update implementation mappings, conformance, impacts, and verification history for that Snapshot instead.
- A Candidate disappearing from a new Snapshot does not retire a Feature. Retirement, merge, and split remain governed decisions.
- Feature History is keyed by stable `Feature.id` and shows FeatureVersions, authorizing Decisions, implementation mappings per Snapshot, each Snapshot transition's impact, and its revalidation results.

### 8.2 GraphRevision state and invariants

```text
BUILDING → EVALUATING → PUBLISHED
                     ↘ REJECTED
```

- Before first publication a Project may have no `CurrentGraphHead`; afterward it has exactly one, and it references only a `PUBLISHED` Revision.
- The first `PUBLISHED` Revision comes from a FULL run.
- Publishing a Revision and moving CurrentGraphHead are one atomic commit.
- A `REJECTED` Revision cannot transition back to PUBLISHED; remediation creates a new Revision.
- Normal update paths never delete or overwrite historical Revisions, ChangeSets, or ImpactAssessments.

## 9. Persistent execution lifecycle

The durable lifecycle design in `workspace-scan-and-analysis-lifecycle.md` remains a supporting F001 design:

- `SourceScanRun` and `AnalysisRun` are separate checkpointed stages;
- committed WorkUnits are reused on Resume;
- browser lifecycle events are read-only;
- worker leases and fencing prevent stale commits;
- manual Pause remains paused across restart;
- running work resumes after worker recovery;
- one immutable Snapshot binds every child result.

The stage UI must also show coverage and correctness progress, not only a percent file counter.

## 10. Evaluation harness

### 10.1 Truth-set schema

A reviewed truth set contains:

- positive capability anchors;
- required nodes and typed edges;
- forbidden nodes and edges;
- accepted aliases and alternative boundaries;
- explicit unknowns;
- artifact inclusion/exclusion expectations;
- reviewer, Decision, reason, and version.

The engine never uses the truth set as analysis input in production mode. The evaluation harness compares outputs after the run.

### 10.2 Truth-set anti-overfit and blind-review protocol

After sealing, each TruthSetVersion is stratified under a stable `evaluationSeed` into:

- **60% calibration**: visible to implementers for local TDD and failure explanation;
- **30% held-out**: sealed from implementers and readable only by the acceptance harness and assigned independent reviewer;
- **10% rotating challenge**: rotated for important releases to cover new languages, misleading names, cross-module relations, and historical change.

Strata include node/edge type, evidence tier, core capability, module, artifact kind, and positive/negative assertion so random sampling cannot erase rare critical relations. Candidate precision review samples at most 100 items (all when fewer), stratified across Candidate/relation kinds, confidence bands, and producer lanes.

An independent reviewer classifies each sample as `SUPPORTED`, `AMBIGUOUS_EXPLICIT`, `UNSUPPORTED`, `DUPLICATE`, or `WRONG_RELATION`:

- precision denominators include decisive Candidates and exclude only `AMBIGUOUS_EXPLICIT`;
- genuine ambiguity is excludable only when the product exposes it as a Gap/Conflict;
- any high-confidence `UNSUPPORTED`, truth-set input leakage, or missed P0 anchor blocks release.

The operator/business authority approves capability boundaries, P0 anchors, and thresholds. An independent technical reviewer approves source anchors and typed relations. Implementation authors cannot approve held-out content, alter partition seeds, or sign their own acceptance result. Disagreement remains `UNKNOWN/CONFLICT` rather than being forced through the gate.

After release, the complete EvaluationRun and TruthSetVersion are retained. Challenge items rotate for the next version, while prior answers and results remain immutable. A deterministic boundary test proves that production AnalysisRun input digests contain no truth-set digest, anchor answer, or held-out content.

### 10.3 Test layers

| Layer | Dataset | Purpose |
|---|---|---|
| Extractor unit | minimal syntax fixtures | exact nodes, edges, spans, diagnostics |
| Cross-file integration | synthetic multi-file fixtures | calls, routes, data/config/test relations |
| Adversarial semantics | misleading names and decoys | negative precision and evidence bounds |
| Controlled product | `examples/order-platform` | complete expected TraceChain |
| Realistic dogfood | pinned Traqen Snapshot | system-level recall, precision, gaps, UI usability |
| Incremental | controlled commits | lineage, invalidation, full/incremental equivalence |

### 10.4 Regression policy

The evaluation policy versions thresholds by dimension. A change cannot improve node count while regressing required relation correctness or uncertainty honesty. Threshold changes require a Decision with explicit version, effective scope, and reason, and cannot retroactively alter prior EvaluationRuns.

## 11. Traqen self-analysis design

### 11.1 Input and isolation

Analyze a clean, pinned Traqen worktree using a test-only data store and non-reserved ports. Capture:

- source and docs Snapshot;
- safe package/build metadata;
- backend and Web test reports generated in the acceptance environment;
- reviewed configuration presence, never secret values.

### 11.2 Expected output

The Candidate graph must visibly connect, where supported:

```text
system requirement
  → F001 / subsystem design
  → domain and application code
  → API contracts
  → tests and governed TestSpecs
  → current test executions/results/Evidence
```

At least one governed seed Feature must render a complete TraceChain. Candidate-only nodes remain visually distinct.

### 11.3 Self-analysis acceptance

- use `traqen-self-v1`;
- disposition 100% of in-scope artifacts;
- evaluate at least 30 positive anchors across at least 10 core capabilities with ≥90% recall and no missed P0 anchor;
- satisfy 100% of at least 60 required typed edges and violate none of at least 30 forbidden edges;
- stratify up to 100 Candidate samples (all when fewer), achieve ≥90% human-supported precision among decisive Candidates, and contain no unsupported high-confidence conclusion;
- reproduce a 100% stable semantic digest for the same Snapshot/engine/policy;
- achieve 100% equivalence in unchanged regions of a controlled second Snapshot, with only expected or explained changed-region deltas;
- make unsupported Web/language/document areas explicit;
- show source content for every sampled Fact and Candidate;
- complete without browser ownership;
- display the graph in Traqen itself;
- evaluate one controlled change and compare predicted impact with the reviewed expectation;
- default to the second Snapshot's CurrentGraphHead and open one Feature's version/implementation/impact/verification history.

## 12. API and UI requirements

Read APIs expose:

- Snapshot and Artifact coverage;
- run/phase/WorkUnit progress;
- Facts, Candidates, conflicts, and gaps;
- Candidate lineage and evaluation report;
- graph projections and source excerpts according to policy;
- current `GraphRevision` and `CurrentGraphHead`;
- FeatureVersion, implementation mapping by Snapshot, ChangeSet, ImpactAssessment, and verification history.

Command APIs expose explicit Start, Pause, Resume, Cancel, review, and Decision operations. SourceSlice APIs are available only to the server Agent/Skill runtime. GraphRevision publication is an internal atomic command after evaluation; an ordinary browser cannot move CurrentGraphHead directly.

The UI separates:

- authoritative job state from connection state;
- inventory progress from understanding quality;
- Candidate from governed Feature;
- test clue from TestSpec and execution result;
- confidence from evidence coverage;
- “not analyzed”, “unsupported”, “unknown”, “conflicting”, and “absent”.

## 13. Security boundaries

### 13.1 Deployment capability modes

| Mode | Source access | Constraint |
|---|---|---|
| `LOCAL_SINGLE_TENANT` | co-located API/Runner reads an allowlisted local path | suitable for a workstation; ordinary APIs never expose absolute paths |
| `PRIVATE_RUNNER` | runner stays beside source and receives work over mutually authenticated/outbound transport | raw source stays private; only allowed Facts/Candidates/Evidence leave the boundary |
| `CLOUD_CONTROL_PLANE` | never interprets a browser-submitted local path | requires a Private Runner or governed Remote Git Connector |

`SourceRegistration.connectorKind` and capability/policy version record the mode. A cloud/multi-tenant API without a Private Runner or Remote Connector rejects `LOCAL_FILESYSTEM` registration rather than pretending it can read a user's machine.

### 13.2 Common boundaries

- the runner can access only allowlisted source registrations;
- symlink escape, traversal, broad root/home targets, devices, sockets, and non-regular files are rejected;
- ordinary reads expose relative/opaque paths;
- SourceSlices are redacted and budgeted before model access;
- model credentials and real configuration secrets never enter runs or graph data;
- raw source retention and external model use are deployment policies;
- all evaluation and dogfood runs use isolated non-production stores.

## 14. Acceptance criteria

- **AC-01**: every artifact in a pinned Snapshot has an explicit inventory disposition.
- **AC-02**: supported extractors pass exact positive, negative, span, and diagnostic fixtures.
- **AC-03**: Agent planning includes manifest-derived roots and can recover a reviewed anchor missed by one deterministic extractor.
- **AC-04**: all Candidate nodes and relations pass Snapshot and WorkUnit evidence validation.
- **AC-05**: reconciliation preserves conflicts and alternatives and cannot create governed authority.
- **AC-06**: the evaluation report exposes recall, precision, relation, provenance, gap, replay, and incremental dimensions with denominators.
- **AC-07**: full and incremental runs produce equivalent evaluated graphs for a controlled change.
- **AC-07a**: the first run is FULL, later AUTO defaults to INCREMENTAL, and only an evaluation-passing GraphRevision atomically replaces CurrentGraphHead.
- **AC-07b**: the default graph shows only the latest state, while Feature history retains version Decisions, implementations by Snapshot, ChangeSets, impacts, and verification; code change does not auto-create FeatureVersion.
- **AC-08**: refresh, closure, reconnect, manual Pause/Resume, and worker restart preserve the same job and committed work.
- **AC-09**: test clues, TestSpecs, executions, results, and Evidence remain distinct in domain data and UI.
- **AC-10**: two pinned Traqen Snapshots under `traqen-self-v1` produce the reviewed Candidate graph, one governed complete TraceChain, a visible gap report, the latest graph head, Feature history, and a reviewed change-impact result inside Traqen.
- **AC-11**: source and secret security boundaries pass deterministic tests.
- **AC-12**: backend, Web, build, lint, diff, evaluation, and independent review gates pass.

## 15. Non-goals

- claiming perfect recovery of undocumented historical intent;
- automatic Candidate approval;
- running arbitrary repository code during static understanding;
- using node count or one model score as correctness;
- supporting every language in the first delivery;
- hiding unsupported scope to improve metrics;
- making browser IndexedDB an execution or truth authority.

## 16. Design Gate decisions

The recommended decisions are:

1. accept the multi-dimensional correctness contract;
2. accept a versioned, human-reviewed truth set as evaluation authority;
3. make Traqen-on-Traqen a required release gate;
4. keep the durable lifecycle as a supporting layer of F001;
5. deliver source connectors incrementally, starting with an allowlisted Local Runner, without changing the canonical graph contract;
6. accept `traqen-self-v1` numeric thresholds, calibration/held-out/challenge blind review, and independent approval;
7. accept first-FULL/later-INCREMENTAL behavior, atomic CurrentGraphHead publication, and Feature-history ledger semantics.
