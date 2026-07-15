# Governed Feature traceability validation — 2026-07-14

## Product boundary

This slice implements the design rule that observed implementation, inferred intent, human business authority, verification, and Evidence are different kinds of knowledge. A Reverse Skill candidate remains implementation knowledge. Only an authenticated, policy-authorized statement-level review can create a separate normative Claim and Decision; the candidate itself is never relabelled as business truth.

The server-derived proof chain answers the product's central question without a synthetic confidence score:

```text
Feature
→ HAS_RULE → normative Claim
→ CONFIRMED_BY → authorized Decision
→ APPLIES_IN → versioned ClaimScope
→ ASSESSED_BY / CONFORMS_TO → implementation conformance
→ EXPOSED_BY / IMPLEMENTED_BY / USES_DATA / CONTROLLED_BY / DEPENDS_ON → deterministic Facts
→ VERIFIED_BY → approved TestSpec
→ EXECUTED_AS → exact deployment execution
→ PROVED_BY → verified Evidence
```

Every segment carries typed endpoints, provenance, and `ACTIVE`, `PENDING`, or `STALE` status. Missing authority, mapping, conformance, TestSpec, assertion, current execution, verified Evidence, or conflict resolution remains a visible `TraceGap` and prevents a complete chain.

## Statement-level review and integrity

- Reviewer identity and role come from the trusted server resolver, never the request body.
- Project policy separately controls allowed roles, Decision types, and candidate-review outcomes.
- Authentication occurs before ReverseRun/candidate lookup, reducing unauthenticated enumeration.
- The server locates the candidate and its Fact evidence from the immutable run; clients cannot restate candidate content or Fact links.
- Confirming a conflicted candidate is forbidden. Recording an exception requires explicit acknowledgement of every related conflict and non-empty exception content.
- `REJECTED`, `INSUFFICIENT_EVIDENCE`, and `DEFERRED` create review history but cannot smuggle Feature, Claim, Scope, mapping, or conformance records.
- A successful baseline append is atomic in memory and PostgreSQL: Feature (when requested), Scope, normative Claim, Decision, mapping, conformance, and review either all commit or none do.
- PostgreSQL verifies tenant-bound reviewers, exact Claim/Scope references, exact Source Snapshot membership, and the existence of every mapped Fact in the referenced Snapshot Manifest. These records reject update and delete operations.
- Idempotent retries use a server-computed fingerprint that includes route identity, reviewer identity, and the accepted request.

## Snapshot comparison and layered validity

`POST /v1/projects/{projectId}/change-sets` compares the latest complete Fact observations for two immutable manifests. Stable entity identity is separated from Snapshot-specific fact identity, and independent Scanner observations do not overwrite each other.

For mapped changes, the append-only impact record contains:

- affected Feature, Claim version, ClaimScope version, implementation mapping, and TestSpec IDs;
- exact changed Fact IDs and change classes;
- invalidated layers;
- preserved layers;
- reason and recommended remediation actions.

Code, API, SQL, Schema, configuration, dependency, and test-asset changes use separate invalidation rules. Implementation changes preserve the normative Claim, business Decision, historical Fact, historical Evidence, and audit record. The traceability query then shows the old implementation and conformance segments as `STALE` while authority remains confirmed.

If every mapped Fact is semantically identical in the next manifest, Traqen creates an immutable continuity event, rebinds the mapping to the new Snapshot-specific Fact IDs, and derives a new conformance record with `SEMANTIC_FACT_CONTINUITY` provenance. This prevents a routine deployment or observation timestamp from making every Feature stale. The continuity and invalidation paths are both atomic with the ChangeSet.

Incomplete Fact graphs never silently imply a complete comparison: the ChangeSet is marked incomplete and records which side is incomplete. A mapping that cannot be safely rebound remains stale rather than being guessed current.

## Verification result

The full test suite completed with 105 passing tests:

```bash
npm test
```

Coverage includes authorized confirmation, exceptions, rejection without baseline creation, identity spoofing, idempotency, independent dimensions, Decision and conformance trace segments, stale-only affected paths, unchanged semantic continuity, multi-Scanner comparison, exact PostgreSQL Fact references, transaction rollback constraints, immutable impact/continuity history, OpenAPI/JSON Schema parsing, and the previously implemented Scanner, Skill, TestSpec, Runner, and Evidence boundaries.

The repository self-scan also completed without diagnostics:

```text
complete: true
eligible artifacts: 78
locatable nodes: 1,004
relations: 2,719
```

Counts are reproducible for this source state and will change as implementation artifacts change.

## Deliberate limits

- The low-level `/v1/trace-chains/evaluate` endpoint remains a deterministic diagnostic evaluator for supplied inputs. Product truth is read from the server-derived Feature traceability endpoint.
- Development identity is an environment-configured local reviewer and optional bearer token. Enterprise SSO, delegated authority, two-person approval, break-glass, revocation, and production-wide route authorization remain later infrastructure work.
- Change comparison operates on ingested deterministic Fact graphs. Dynamic runtime-only behavior requires Runtime Facts and Trace correlation before it can participate in impact selection.
- The ordered proof-chain and the interactive React/Cytoscape graph now project the same server-derived Feature traceability object. The graph is bounded by view, depth, node count, node type, and relation filters; it does not maintain a second truth model.
