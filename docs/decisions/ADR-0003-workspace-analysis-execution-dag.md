> Language: **English** · [简体中文](ADR-0003-workspace-analysis-execution-dag.zh-CN.md)

---
feature_ids: [F001]
related_features: [F002, F003, F004, F005, F006]
topics:
  - workspace-analysis
  - execution-dag
  - source-scan
  - analysis-agent
  - reconciliation
  - observability
doc_kind: adr
created: 2026-08-11
---

# ADR-0003: Workspace Analysis Executes as a Fork-Join DAG

## Status

Accepted by the operator on 2026-08-11.

## Context

F001 names seven durable activities: `SOURCE_SCAN`, `FACT_COMMIT`, `ANALYSIS`, `RECONCILIATION`, `EVALUATION`, `PROJECTION`, and `PUBLISHING`. The current contract models them as one ordered `phase`, and the current runner awaits each handler in sequence. A UI can draw Static and Agent lanes over that contract, but the execution remains serial and the product would present concurrency that does not exist.

The required behavior is two genuinely independent evidence-producing lanes. Static syntax analysis produces deterministic observations and a static Candidate projection. Every configured Child Agent independently reads bounded slices from the same immutable source and produces its own Candidate pool. The Main Agent observes the pools and reconciles only complete, validated partition inputs.

## Decision

### Immutable fork point

`SOURCE_SCAN` begins with discovery and content-addressed snapshot capture. Agent work cannot read the mutable source directory. Once the `SourceSnapshot` and complete `ArtifactInventory` are sealed, the job forks:

```text
SourceRegistration
  → SourceSnapshot + ArtifactInventory sealed
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
Static lane                 Agent lane
SOURCE_SCAN extraction      ANALYSIS
  → relation resolution       ├─ Child A CandidatePool
  → FACT_COMMIT                ├─ Child B CandidatePool
                               └─ Child N CandidatePool
          └─────────┬─────────┘
                    ▼
             RECONCILIATION
                    ▼
       EVALUATION → PROJECTION → PUBLISHING
```

`ANALYSIS` therefore does not wait for the final `FactBundle`. Scanner Facts are optional enrichment. A WorkUnit that consumes them pins an immutable `factCheckpointId`; it never reads an unversioned "latest facts" view.

### Separate pool authority

The static lane preserves two layers:

```text
DeterministicObservationPool → StaticCandidateProjection
```

The first contains exact parser, symbol, API, data, configuration, test-asset, result-asset, and relation observations. The second groups those observations into the same six-facet Candidate envelope used by Child Agents: business, design, code, test cases, test results, and configuration. Every facet is an array and is empty when no evidence exists. A separate coverage state distinguishes `FOUND`, `NO_EVIDENCE`, `NOT_YET_ANALYZED`, `UNSUPPORTED`, and `FAILED`. A Candidate itself requires at least one valid evidence reference; an evidence-free assertion is a Gap.

Static grouping never converts an inferred business name into a Fact. Business or design facets remain empty unless explicit source evidence supports them.

### Partition reconciliation barrier

The Main Agent may observe committed pool entries and progress in real time, but it cannot update the reconciled working projection until the shared `scopePartitionId` gate is open:

```text
static partition terminal (success or explicit Gap)
AND every required Child slot terminal
AND schema, Snapshot, SourceSlice, and evidence validation terminal
```

Identity conflicts preserve separate Candidate nodes. Facet or description conflicts may remain attached to one evidence cluster, but remain unresolved in `ConflictLedger`. Neither case creates or changes a governed Feature without an authorized Decision.

A base-partition checkpoint is not a final repository-wide identity decision. The deterministic plan also creates cross-partition, cross-module, and project-synthesis batches. Their join gates consume the required lower-level reconciliation checkpoints plus newly committed static relation checkpoints; the final global gate additionally requires the terminal FactBundle. Late cross-file evidence therefore creates an append-only reconciliation delta instead of silently rewriting an earlier checkpoint. `scopePartitionId` follows stable UnderstandingPlan locality, not individual lines or arbitrary UI pages.

A required Child that cannot run closes with an explicit terminal outcome such as `NO_ELIGIBLE_PRODUCER`, timeout, budget Gap, or policy refusal. It never counts as agreement and never leaves the gate waiting forever.

### Job state contract

The authoritative job state uses:

- `phaseStates`: state and output references for every DAG node;
- `activePhases`: zero or more concurrently running nodes;
- `laneProgress`: typed denominators for snapshot, inventory, static, Agent, quality, and publication work;
- `joinGates`: partition and global reconciliation readiness;
- `completedPhases`: a derived compatibility projection, never the scheduler source.

A single `phase` value is not authoritative. Pause, resume, cancellation, leases, and recovery apply to the parent Job while each lane commits its own idempotent checkpoints.

### Observability

Structured progress and interaction events are append-only and durable by default. Large prompt, response, and tool-result bodies are stored as protected content-addressed traces referenced by digest. Policy redaction is explicit. The product never stores or displays private model reasoning. If unreconciled pools are exposed, the UI labels them as a technical observation view; only committed reconciliation checkpoints appear in the reconciled working tree.

## Consequences

- The server runner must become a dependency-aware DAG scheduler rather than an ordered phase loop.
- The Job API and Web client must accept multiple active phases and independent lane progress.
- Snapshot/Inventory sealing and final Fact commit become separate durable gates.
- Working Feature/API trees update only from committed reconciliation checkpoints.
- The existing complete-sibling barrier remains valid and becomes one input to the partition join gate.
- Hierarchical synthesis gates prevent early local checkpoints from becoming premature repository-wide identity decisions.

## Rejected alternatives

- **Draw two lanes over a serial backend:** visually claims concurrency without executing it.
- **Wait for the final FactBundle before all Agent work:** makes scanner latency and misses define the Agent critical path.
- **Let Agents read a changing source directory:** breaks replay, evidence identity, and reconciliation.
- **Reconcile every arrival optimistically:** makes results depend on completion order and exposes incomplete sibling sets.
- **Call deterministic observations and semantic Candidates the same thing:** erases the Fact/Candidate authority boundary.
