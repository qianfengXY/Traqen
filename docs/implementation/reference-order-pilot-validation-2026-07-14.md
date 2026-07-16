> Language: **English** · [简体中文](reference-order-pilot-validation-2026-07-14.zh-CN.md)

# Reference order pilot validation — 2026-07-14

## Outcome

The repository now contains an executable built-in Mock reference system and a one-command proof of the complete MVP vertical loop. This closes the repository-controlled portion of design section 18.3 and implements the built-in dataset from section 18.4 without special-casing the order domain in Traqen core.

Run:

```bash
npm run pilot:order-submit
```

The command exits non-zero if any required stage, invalidation, repair, or final proof condition fails.

## Reference target

`examples/order-platform/` is a synthetic Node HTTP and PostgreSQL-compatible application. Its submit-order flow covers:

- `POST /orders/{id}/submit`;
- the `DRAFT → SUBMITTED` state transition;
- customer/admin role authorization;
- a submission feature flag;
- a required idempotency key and replay record;
- an external inventory reservation dependency;
- database transaction commit and rollback;
- inventory compensation after a failed write;
- serialization of concurrent submissions for the same order;
- isolated test Seed and cleanup.

The reference tests exercise success, forbidden role, invalid state, idempotent replay, disabled configuration, database rollback, inventory compensation, and concurrency.

## First complete Snapshot

The pilot performs these real protocol operations:

1. fingerprints the actual reference source, runnable module files, and effective runtime context, then creates an immutable Source/Build/Deployment/Runtime Snapshot Manifest from their SHA-256 digests;
2. scans the reference repository into 53 locatable Fact nodes and 110 edges;
3. registers and executes both signed reference Reverse Skills;
4. merges their shared endpoint conclusion while preserving two sources;
5. obtains a server-resolved human Decision for a minimal normative Claim and Scope;
6. converts the confirmed Claim and mapped Endpoint Fact into an unapproved controlled-write TestSpec;
7. obtains independent TestSpec approval;
8. seeds a draft order, invokes the real API, performs an allowlisted database assertion, and cleans up;
9. ingests Runner-signed HTTP, database, assertion, lifecycle, structured LOG, and TRACE Evidence, including the normalized trusted catalog SQL, query reference, redacted parameters, returned rows, and target telemetry;
10. persists a complete Feature trace chain with zero gaps.

## Change and repair

The pilot copies the target to an isolated Git repository, commits the first version, makes and commits a real source change to the endpoint handler, and runs the bounded Git Diff analyzer between the two full commit hashes. The diff identifies `src/server.js`; all 14 resulting Fact changes correlate to that artifact, and the impact service selects the submit-order Feature. The build/deployment artifact digest also changes because it is recomputed over the actual files loaded by the second server.

Before repair:

- authority remains `CONFIRMED`;
- implementation conformance is `STALE`;
- the new deployment has not been executed;
- historical Evidence is retained but rejected as proof of the new deployment;
- explicit `CONFORMANCE_STALE`, `NOT_EXECUTED_ON_CURRENT_DEPLOYMENT`, and `EVIDENCE_STALE` gaps are visible.

The changed source is then loaded as the actual second HTTP deployment. A new Reverse Run and authorized implementation reanalysis bind current Facts to the existing Claim. The unchanged approved TestSpec is rerun against the second Snapshot, producing Evidence bound to its actual deployment. The final current-Snapshot chain is complete with zero gaps.

## Cross-Snapshot TestSpec semantics

`TestSpec.sourceSnapshotId` records where the test protocol was generated; it is not the deployment that every future regression must execute. The signed Runner task binds the exact execution Snapshot and all four component identities/digests. The running target reports the same artifact/runtime digests before execution, and every resulting Evidence manifest repeats that exact binding alongside Snapshot Manifest, TestSpec version, and Runner. Feature traceability only becomes complete when current-Snapshot conformance and current-deployment Evidence both exist.

This permits an unchanged approved TestSpec to remain valid after an implementation-only change, as required by the layered invalidation design, without letting historical Evidence prove a new deployment.

## Verification

- the reference-target suite covers success, forbidden role, invalid state, idempotency, disabled configuration, rollback, compensation, and same-order concurrency;
- the automated vertical-pilot regression passes;
- the pilot reports two Reverse Skills, two candidate sources, one human-review-required candidate TestSpec, six Evidence types (`ASSERTION`, `DATABASE`, `HTTP`, `LOG`, `OTHER`, `TRACE`), `PASS` on both deployments, preserved `CONFIRMED` authority during change, `CONFORMS` after repair, rejection of historical Evidence for the new deployment, and a final complete chain with zero gaps.
