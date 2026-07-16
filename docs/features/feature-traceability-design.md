> Language: **English** · [简体中文](feature-traceability-design.zh-CN.md)

# Feature traceability design

## Goal

Feature traceability answers one question without collapsing uncertainty into a score: **what currently proves that a governed Traqen Feature behaves as the business confirmed?** The server projects an ordered chain from normative intent through implementation, configuration, TestSpec, execution, and Evidence for one immutable Snapshot Manifest and deployment.

## Functional boundary

- A Feature may contain multiple versioned Claims and Scopes. Only an authorized, immutable Decision can confirm normative authority.
- Scanners and reverse-analysis Agents may propose Facts and Candidates, but cannot create business truth.
- `evaluateTraceChain` derives authority, conformance, verification, Evidence freshness, conflict, and TraceGap dimensions independently.
- A chain is complete only when it has no blocking TraceGap. Warning gaps remain visible.
- An execution proves only the exact TestSpec version, Snapshot Manifest, and deployment it names. A code or deployment change preserves history but makes dependent proof stale.
- The browser renders the server result. It does not invent a replacement trust score or hide unknown states.

## Request and projection flow

1. The client requests `GET /v1/projects/{projectId}/features/{featureId}/traceability` for a selected Snapshot Manifest.
2. The application loads the governed Feature, Claim/Scope/Decision baseline, mapped implementation Facts, TestSpecs, current executions, Evidence, and conflicts.
3. The domain evaluator produces ordered trace segments, independent trust dimensions, and explicit gaps with owner roles.
4. The graph projector adds process nodes and creates bounded business, implementation, coverage, or full-traceability views.
5. The API returns the immutable identity and server-derived projection to the product UI and future Agents.

## Invariants

- Normative Claims and human Decisions are never inferred from source code.
- Missing, stale, incomplete, conflicted, failed, and not-run states remain distinct.
- Historical Facts and Evidence are retained; they are not presented as proof of a newer Snapshot or deployment.
- Every blocking gap has an explicit owner role and repair boundary.
- Sensitive configuration values are represented by secret references, never rendered as plaintext.

## Implementation mapping

| Concern | Source |
| --- | --- |
| Chain evaluation and TraceGap ownership | `src/domain/trace-chain.js` |
| Graph projection and bounded path views | `src/domain/feature-graph.js` |
| Feature traceability orchestration | `src/application/traceability-application.js` |
| HTTP contract | `src/api/http-server.js` |
| Response schema | `contracts/feature-traceability.schema.json` |

## Verification strategy

- Domain tests prove complete, missing, failed, stale, conflicted, and freshness-boundary chains.
- Graph tests prove view filtering, bounded expansion, provenance, gaps, and path queries.
- API tests prove authentication, project/feature boundaries, Snapshot selection, and response contracts.
- The Web build proves the same repository documents and source files can be projected as a Traqen self-Workspace.

## Future Agent contract

Agents consume approved, version-pinned TestSpecs and Snapshot/deployment identities. They return structured step and assertion results plus Evidence references and attestation. Agent output may add execution facts; it cannot edit the Feature description, human Decision, TestSpec approval, or final server-derived trust dimensions.
