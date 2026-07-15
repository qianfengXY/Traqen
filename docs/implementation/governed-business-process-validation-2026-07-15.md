# Governed business-process validation — 2026-07-15

## Design obligation

The product vision requires the same Feature-centered source to show business actors, lifecycle states, transitions, guards, exceptions, design elements, and current implementation—not a diagram inferred from labels. The design also forbids promoting AI or code inference directly into normative business truth.

## Implemented boundary

- `BusinessProcessModel` is immutable and bound to an exact Feature version.
- An authenticated reviewer must have a role listed in `allowedProcessModelRoles`; actor ID, role, confirmation time, and creation time are server-owned.
- Every model has exactly one `INITIAL` state, at least one `TERMINAL` state, no self-transition, valid actor/state references, and no unreachable state.
- Actors carry roles and responsibilities. Transitions carry triggers, guards, exception behavior, optional next-Feature references, and implementation Fact references. Design elements distinguish module, sequence, transaction, and exception-handler intent.
- An implementation reference contains both `snapshotManifestId` and `factId`. Submission verifies the Snapshot and Fact before persistence. A historical mapping remains visible as `STALE`; it cannot silently prove a newer Snapshot.
- The business graph is projected from the same Feature traceability response. It uses Actor/Role, BusinessState, StateTransition, DesignElement, and deterministic Fact nodes rather than a separate visualization database.

## Persistence and API

- PostgreSQL migration: `0008_business_process_model.sql`.
- In-memory and PostgreSQL stores expose identical append/latest-read behavior.
- API: `POST/GET /v1/projects/{projectId}/features/{featureId}/process-model`.
- The Feature baseline and Snapshot traceability responses include the latest process model; traceability additionally includes the referenced Fact subgraphs.
- OpenAPI and JSON Schema keep reviewer identity out of the request contract and retain Snapshot binding on every implementation reference.

## Demonstrated vertical flow

The built-in order pilot now confirms a three-state customer flow (`DRAFT`, `SUBMITTED`, rejection), two transitions, state/ownership guards, exception behavior, and a transaction design element. Version 1 maps to the first Snapshot's Endpoint, state guard, state transition, and exception-path Facts. After the implementation change, version 2 is separately authorized and maps those same business semantics to the second Snapshot's Facts. The final business graph asserts three BusinessState nodes and two StateTransition nodes.

## Verification

Targeted tests cover domain invariants, failed authorization, HTTP identity assignment, memory persistence, PostgreSQL migration/persistence, graph projection, OpenAPI/JSON Schema, web lint/build/rendering, and the changed-Snapshot reference pilot. The full repository test suite remains the release gate for this increment.

## Truth boundary

Scanner Facts such as `condition-branch`, `permission-check`, `state-transition`, and `exception-path` are implementation evidence only. They may be linked to an authorized business transition, but they never create, confirm, or modify the business process model by themselves. Enterprise SSO/ABAC, delegated authority, two-person confirmation, revocation, dispute/reopen, and break-glass remain separate governance hardening work.
