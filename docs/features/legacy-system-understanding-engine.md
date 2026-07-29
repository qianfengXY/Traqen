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

An Agent or Skill receives an authorized, bounded source projection:

- stable artifact IDs and relative paths;
- requested line/symbol ranges;
- redacted content or structural excerpt;
- related deterministic Facts and diagnostics;
- explicit token/byte budget;
- allowed evidence IDs.

The source-slice broker logs request purpose and digest. Secret policy is enforced before content leaves the trusted runner.

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

### 6.3 Independent semantic analysis

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

### 6.4 Test and execution interpretation

The engine separately emits:

- `TestAssetFact`: a static test file/case/assertion was observed;
- `CandidateTestIntent`: a proposed rule the asset may exercise;
- `TestSpec`: only after governance;
- `TestExecution`: one actual controlled execution;
- `VerificationResult`: PASS/FAIL/INCONCLUSIVE for a Claim;
- `Evidence`: protected output supporting that result.

A filename containing “test” cannot close a verification gap.

### 6.5 Reconciliation

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

The first plan is generated from:

- complete ArtifactInventory;
- build/package/module boundaries;
- known public entrypoints;
- document and API manifests;
- test/config/data clusters;
- extractor diagnostics;
- prior Snapshot lineage.

During execution, lanes may enqueue bounded follow-up WorkUnits for:

- an unresolved call target;
- an undocumented endpoint;
- a Claim with no implementation relation;
- a test with ambiguous intent;
- a configuration reference with unknown consumers;
- a truth-set anchor not yet recovered.

Follow-up depth, budget, and reason are recorded. Budget exhaustion becomes `UNEXPLORED_BUDGET_LIMIT`, not completion.

## 8. Incremental analysis

For a new Snapshot:

1. compare ArtifactInventory by content identity;
2. invalidate Facts for changed extractor inputs;
3. recompute cross-file relations whose dependency frontier changed;
4. re-run semantic WorkUnits whose evidence or producer version changed;
5. retain unchanged Candidate lineage;
6. mark governed Claims as potentially stale rather than deleting Decisions;
7. compare the incremental graph with a sampled full rebuild.

An incremental run is accepted only if its graph is equivalent to a full run for the evaluated unaffected/affected scopes, apart from permitted timestamps and run IDs.

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

### 10.2 Test layers

| Layer | Dataset | Purpose |
|---|---|---|
| Extractor unit | minimal syntax fixtures | exact nodes, edges, spans, diagnostics |
| Cross-file integration | synthetic multi-file fixtures | calls, routes, data/config/test relations |
| Adversarial semantics | misleading names and decoys | negative precision and evidence bounds |
| Controlled product | `examples/order-platform` | complete expected TraceChain |
| Realistic dogfood | pinned Traqen Snapshot | system-level recall, precision, gaps, UI usability |
| Incremental | controlled commits | lineage, invalidation, full/incremental equivalence |

### 10.3 Regression policy

The evaluation policy versions thresholds by dimension. A change cannot improve node count while regressing required relation correctness or uncertainty honesty. Threshold changes require explicit review.

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

- recover every required seed capability or report a reviewed miss;
- satisfy required/forbidden edge assertions;
- make unsupported Web/language/document areas explicit;
- show source content for every sampled Fact and Candidate;
- complete without browser ownership;
- display the graph in Traqen itself;
- evaluate one controlled change and compare predicted impact with the reviewed expectation.

## 12. API and UI requirements

Read APIs expose:

- Snapshot and Artifact coverage;
- run/phase/WorkUnit progress;
- Facts, Candidates, conflicts, and gaps;
- Candidate lineage and evaluation report;
- graph projections and source excerpts according to policy.

Command APIs expose explicit Start, Pause, Resume, Cancel, review, and Decision operations.

The UI separates:

- authoritative job state from connection state;
- inventory progress from understanding quality;
- Candidate from governed Feature;
- test clue from TestSpec and execution result;
- confidence from evidence coverage;
- “not analyzed”, “unsupported”, “unknown”, “conflicting”, and “absent”.

## 13. Security boundaries

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
- **AC-08**: refresh, closure, reconnect, manual Pause/Resume, and worker restart preserve the same job and committed work.
- **AC-09**: test clues, TestSpecs, executions, results, and Evidence remain distinct in domain data and UI.
- **AC-10**: a pinned Traqen Snapshot produces the reviewed Candidate graph, one governed complete TraceChain, a visible gap report, and a reviewed change-impact result inside Traqen.
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
5. deliver source connectors incrementally, starting with an allowlisted Local Runner, without changing the canonical graph contract.
