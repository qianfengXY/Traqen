# Asynchronous Reverse Run validation — 2026-07-15

## Design obligation

Reverse analysis may outlive an HTTP request. The design requires its phases to be queryable and auditable and requires timeout, retry, cancellation, and recovery instead of a single opaque blocking call.

## Implemented job boundary

The existing synchronous endpoint remains compatible. A caller opts into asynchronous execution with `Prefer: respond-async` or `?async=true`; the server persists the immutable request and a `QUEUED` event before returning `202`.

The job projection replays ordered events:

```text
QUEUED → STARTED → COMPLETED | FAILED | CANCELLED
                    ↑
             CANCEL_REQUESTED
```

The final ReverseRun keeps its detailed design states (`CREATED` through `WAITING_REVIEW`, `FAILED`, or `CANCELLED`) and per-Skill attempts. The job layer answers transport/worker lifecycle without replacing that domain audit.

## Cancellation and recovery

An active job owns an AbortController. Cancellation first persists `CANCEL_REQUESTED`, then signals the same bounded execution boundary used for Skill timeouts; the terminal result is appended afterward. A terminal job rejects repeat cancellation instead of pretending work was stopped.

The request is durable, so a nonterminal job left by process interruption can be resumed explicitly. Recovery appends a new `STARTED` event and either completes or records a bounded failure. If cancellation had already been requested, recovery finalizes cancellation rather than starting work.

This repository implements a single-process worker with durable PostgreSQL job history. Multi-instance leasing, heartbeats, work stealing, and an enterprise queue require deployment infrastructure and are not simulated by an in-memory lock.

## API and persistence

- `POST /v1/reverse-runs?async=true`
- `GET /v1/projects/{projectId}/reverse-runs/{runId}`
- `POST /v1/projects/{projectId}/reverse-runs/{runId}/cancel`
- `POST /v1/projects/{projectId}/reverse-runs/{runId}/resume`

Migration `0010_reverse_run_job.sql` stores immutable requests and identity-ordered events. Update/delete triggers protect both tables.

## Verification

Tests cover projection semantics, durable orphan cancellation, recovery with explicit failure, a real asynchronous HTTP Reverse Run reaching `WAITING_REVIEW`, terminal cancellation conflicts, PostgreSQL event order, mutation rejection, OpenAPI/JSON Schema, and the pre-existing per-Skill timeout/retry/AbortSignal tests.
