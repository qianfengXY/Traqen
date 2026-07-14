# Implementation reanalysis validation — 2026-07-14

## Outcome

This slice closes the repair half of the change-impact loop. A changed implementation can already invalidate only conformance, verification, and affected trace segments while preserving normative business truth. It can now be analyzed again and bound to the existing Claim and Scope without creating a duplicate Claim or replacing its Decision.

## Authorized repair flow

`POST /v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses` accepts a named analysis, a current-Snapshot Reverse Run, its Candidate, a rationale, and any explicitly acknowledged conflicts.

The server:

1. resolves the implementation reviewer identity and role independently of the request body;
2. requires an allowed developer/architect-style role;
3. verifies that the Feature and latest Claim exist and that the Claim remains authorized by a `CONFIRMED` or `EXCEPTION_RECORDED` Decision;
4. verifies that the Reverse Run and Candidate belong to the target Snapshot and Source component;
5. requires every related Conflict to be explicitly acknowledged;
6. creates a new immutable Snapshot-bound ImplementationMapping from the Candidate's exact Fact references;
7. deterministically recomputes conformance against the existing normative constraint;
8. records analysis ID, request fingerprint, reviewer, rationale, Reverse Run, Candidate, and conflicts in `analysisMethod` provenance.

Neither Claim, Scope, Decision, historical Fact, historical Evidence, nor a previous mapping is mutated.

## Persistence and idempotency

The memory and PostgreSQL stores append the mapping and conformance atomically. Existing database foreign keys and triggers enforce Claim/Scope, Snapshot Source, Reverse Run, and Fact-Snapshot boundaries. Repeating the exact authorized request returns the same records; trying to reuse the deterministic mapping identity with different analysis provenance fails as an immutable conflict.

## Product integration

The change-impact repair queue now includes a live implementation-reanalysis form. Credentials stay in page memory and are cleared after a successful server response. The page states that the action repairs implementation evidence only and cannot create or modify business authority.

## Verification

- unauthenticated reanalysis is rejected with 401;
- a business reviewer without the implementation role is rejected with 403;
- unrelated and unacknowledged conflicts are rejected;
- API and PostgreSQL paths create a current-Snapshot mapping and `CONFORMS` record;
- exact retries are idempotent;
- after reanalysis the authority dimension remains `CONFIRMED`, conformance becomes `CONFORMS`, and `CONFORMANCE_STALE` disappears;
- the product build, rendered contract checks, and lint pass.
