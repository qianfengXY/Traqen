> Language: **English** · [简体中文](ADR-0001-canonical-traceability-ontology.zh-CN.md)

---
feature_ids:
  - UNNUMBERED-CANONICAL-TRACEABILITY
topics:
  - canonical-graph
  - ontology
  - authority
  - identity
  - evidence
doc_kind: adr
created: 2026-07-25
---

# ADR-0001: Canonical Traceability Ontology

## Status

Accepted for implementation.

## Context

Traqen currently has a deterministic server Fact graph and a browser-local Workspace index. Both can discover implementation observations and ask models to improve semantic grouping, but their envelopes and projections are not identical. The browser can display inferred groupings with Feature-like IDs, test-file clues with TestSpec-like nodes, and an absent execution with a TestExecution-like node. Those shapes blur discovery, authority, and verification.

Traqen needs one truth model across scanning, inference, governance, execution, graph views, trees, impact, and metrics.

## Decision

Traqen is a versioned traceability knowledge system:

- Snapshot-bound Facts are its factual basis.
- Agent and Skill outputs are candidate inferences.
- Human Decisions are the authority for business Claims, Feature identity, and governed promotion.
- Trusted execution Evidence supports a VerificationResult for a Claim through a TestSpec and TestExecution.
- Feature Tree, API Tree, TraceChain, Impact, and Metrics are bounded read-only projections of one canonical graph.

The normative processing chain is:

```text
Snapshot/source
  → deterministic Fact
  → Agent/Skill Candidate
  → human Decision and governed object
  → execution result and Evidence
  → tree, graph, TraceChain, Impact, and Metrics projections
```

### Canonical entities and relations

```text
Project
  └─ HAS_SNAPSHOT → SnapshotManifest
       └─ CONTAINS → ArtifactVersion
            └─ OBSERVED_AS → Fact

AnalysisRun
  └─ HAS_WORK_UNIT → WorkUnit
       └─ PRODUCES → CandidateFeature / CandidateClaim
            └─ SUPPORTED_BY → Fact

Decision
  ├─ ACCEPTS / REJECTS → CandidateFeature / CandidateClaim
  └─ CREATES → Claim / FeatureVersion / TestSpec

Feature
  └─ HAS_VERSION → FeatureVersion
       ├─ HAS_CLAIM → Claim
       │    └─ AUTHORIZED_BY → Decision
       ├─ DESIGNED_BY → DesignElement
       │    └─ SUPPORTED_BY → DocumentSectionFact
       ├─ IMPLEMENTED_BY → CodeSymbolFact
       ├─ EXPOSED_BY → EndpointFact
       ├─ CONFIGURED_BY → ConfigurationFact
       └─ VERIFIED_BY → TestSpec
            └─ EXECUTED_AS → TestExecution
                 └─ HAS_RESULT → VerificationResult
                      └─ SUPPORTED_BY → Evidence

TaxonomyVersion
  └─ CONTAINS → TaxonomyNode
       └─ CLASSIFIES → FeatureVersion / CandidateFeature
```

### Identity

`Feature.id` is an opaque stable ID allocated by the governance path and remains unchanged for the Feature lifetime. It is not a hash of `businessKey`, name, domain, scope, source path, or taxonomy location.

`FeatureVersion` owns mutable business attributes such as `businessKey`, name, domain, and scope. Those attributes and current evidence are matching inputs. When matching is not reliable, the Candidate enters identity review; Traqen does not silently allocate or merge a governed Feature identity.

Fact nodes keep stable entity identity separately from Snapshot-specific immutable Fact identity. Candidate IDs may be content-derived because they identify an observation or inference, not a governed business object.

### Authority and lifecycle

- Candidate acceptance and rejection are `ReviewDisposition` events. A rejected Candidate is retained and never became a Feature.
- `FeatureRetirement` or `NO_CURRENT_IMPLEMENTATION` applies only to an already governed FeatureVersion.
- A model may propose reconciliation, split, merge, or taxonomy placement, but deterministic validation and human governance own the resulting state transition.
- Browser IndexedDB is a recoverable local cache and checkpoint. It is not an independent truth store.

### Evidence semantics

Test-file detection produces a `TEST_ASSET` Fact, not a `TestSpec`. Candidate prose is not a Claim. Absence of a trusted result is a TraceGap, not a `TestExecution`.

The verification path is:

```text
Claim
  └─ VERIFIED_BY → TestSpec
       └─ EXECUTED_AS → TestExecution
            └─ HAS_RESULT → VerificationResult
                 └─ SUPPORTED_BY → Evidence
```

Evidence proves the integrity and completeness of an execution or observation. `VerificationResult` gives `PASS`, `FAIL`, or `INCONCLUSIVE` for the linked Claim. Business authority still comes from Decision.

### Deterministic model boundary

Every Candidate conclusion must include non-empty `evidenceFactIds`. Deterministic code rejects:

- evidence outside the producing WorkUnit;
- Facts from another Snapshot or project;
- missing or duplicate evidence IDs;
- stable evidence node IDs that do not correspond exactly to the cited Fact IDs;
- Candidate proposal fields outside the declared vocabulary, including nested identity or governance fields;
- incomplete schema;
- confidence above the deterministic evidence cap;
- duplicate or omitted Candidate results where the WorkUnit contract requires one result per input.

An LLM may report semantic contradictions but never validates its own trustworthiness.

### Projections

Candidate discovery, governed Features, and combined views may share UI structure but must preserve node type and state. Taxonomy is a versioned classification relation, not Feature identity. A tree never owns truth.

## Consequences

- Browser and server analysis need one `WorkUnit`/`CandidateBundle` contract.
- Existing Feature-like browser IDs must be relabeled as Candidate identities.
- Local graph nodes must stop presenting test clues and missing runs as `TestSpec` or `TestExecution`.
- Existing governed Feature, Claim, Decision, TestSpec, execution, and Evidence stores remain authoritative while they are progressively projected into the canonical graph.
- A future local Runtime may sign derived evidence packages; raw-source privacy policy is independent of Candidate authority.

## Rejected alternatives

- Hashing business fields into `Feature.id`: mutable inputs make identity unstable.
- Letting a Validation Agent approve model output: the producer cannot be its own trust boundary.
- Treating rejected Candidates as retired Features: it creates false business history.
- Maintaining a separate authoritative Feature Tree: taxonomy changes would rewrite identity and split truth.
- Treating Evidence as direct business-Claim authority: test observations do not replace a human Decision.
