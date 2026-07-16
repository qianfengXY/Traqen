> Language: **English** · [简体中文](controlled-write-runner-validation-2026-07-14.zh-CN.md)

# Controlled-Write Runner Validation — 2026-07-14

## Outcome

This slice closes the executable core of MVP acceptance item 8 and proves the controlled-write portion of item 13. A confirmed endpoint Claim can produce an unapproved TestSpec draft containing an explicitly bound API path, bounded request, trusted database query reference, and deterministic assertions. After independent approval, a signed Runner task can execute the complete chain:

```text
confirmed Claim and exact Endpoint Fact
→ generated TestSpec draft
→ immutable human approval
→ trusted Seed setup
→ allowlisted API write
→ read-only database query-catalog verification
→ deterministic assertions
→ guaranteed cleanup
→ Runner-signed Evidence
→ complete current-deployment trace chain
```

## Execution boundary

- `CONTROLLED_WRITE` must be present in the signed target policy's `allowedOperationLevels`.
- Every write route must independently list `CONTROLLED_WRITE`; a method/path match without an operation-level grant is rejected.
- Only POST, PUT, and PATCH are enabled. DELETE, destructive, external-side-effect, absolute/cross-origin, credential-bearing URL, redirect-following, and unallowlisted requests remain blocked.
- Request and response sizes are bounded. JSON bodies are serialized by the executor and Evidence is recursively redacted.
- Endpoint placeholders such as `/orders/{id}/submit` must be explicitly bound during TestSpec generation. The binding is part of the immutable generation fingerprint.
- Database verification accepts only a trusted `queryRef`. The query catalog must mark it `safeRead`, and the executor still rejects multi-statement, commented, or mutating SQL. Evidence preserves the normalized catalog SQL, query reference, redacted parameters, and returned rows so the database check can be independently audited without permitting TestSpec-authored SQL.
- Existing tests accept only a `testRef`. The signed target policy resolves it to a locally trusted absolute executable, working directory, bounded arguments and timeout; task/TestSpec command, shell, environment, and working-directory fields are rejected. Exit code, bounded stdout, and bounded stderr are preserved for assertions without giving the task a command-execution primitive.

## Snapshot and telemetry binding

The signed task carries the exact Source, Build, Deployment, and Runtime component IDs and SHA-256 digests from the stored Snapshot Manifest. The Runner rejects policy/task drift and refuses to execute when the target reports a different component. Every Evidence manifest repeats the four-component binding, and ingestion verifies each identity against the stored manifest rather than trusting a Git label or deployment name.

Trusted local collectors may add `LOG`, `TRACE`, `COVERAGE`, `SCREENSHOT`, or `OTHER` Evidence only when their declaration is present in the signed target policy. Collector payloads are recursively redacted, size-bounded with the rest of the bundle, signed by the Runner, and tied to the same Snapshot components. The reference pilot collects structured order logs and traces from the actual running server.

## Fixture lifecycle

The TestSpec names a `seedRef` and cleanup strategy; it cannot provide executable setup or cleanup code. The signed target policy must allow both, while the Runner resolves the matching local trusted handler outside the task payload.

Setup and cleanup have separate phase records. Cleanup runs after successful setup, assertion failure, or executor failure. A cleanup failure changes the execution result to `ERROR`, marks lifecycle Evidence `INCOMPLETE`, requests test-data isolation, and records the policy-defined compensation reference. Handler state remains local and is not serialized into Evidence.

## Vertical proof

The integration test uses a real local HTTP server and PGlite database. The fixture handler inserts a DRAFT order, the generated TestSpec calls POST `/orders/{id}/submit`, the API changes the row to SUBMITTED, the database executor reads the row through the trusted catalog, deterministic assertions pass, and cleanup removes the row. The resulting Evidence contains the HTTP request and response, the normalized trusted SQL, query reference, redacted parameters, returned rows, assertion outcomes, and lifecycle records. It verifies under the Runner HMAC, contains no resolved token, and completes the current-deployment trace chain.

## Verification

- Tests cover generated path binding and database assertions, exact four-component target matching, signed policy drift, route-level operation grants, request bounds, secret-in-URL rejection, raw-SQL/storage-command rejection, real API/database/existing-test execution, LOG/TRACE collection, setup and cleanup Evidence, cleanup compensation, HMAC verification, all terminal execution states, and full trace-chain completion.
- OpenAPI and all JSON Schema contracts parse successfully; the execution contract now records setup and cleanup as independent phases.

## Remaining boundary

This is an in-process MVP Runner protocol, not a production workload identity or remote lease implementation. Enterprise mTLS enrollment, durable task leases, crash recovery between write and cleanup, out-of-process executor isolation, and operator-facing compensation queues remain production-hardening work; the current code records the necessary nonce, policy hash, Snapshot binding, compensation reference, and immutable Evidence boundaries without pretending those external systems already exist.
