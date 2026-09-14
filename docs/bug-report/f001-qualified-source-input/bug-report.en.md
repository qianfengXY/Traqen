> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [admission, expiry, provenance, recovery]
doc_kind: bug-report
created: 2026-09-07
---

# F001 qualification projection and admitted-read boundary

Reporter: 砚砚 / gpt-6-astra. Author implementation diagnosis, not an independent branch review or a feature completion report.

## Diagnostic capsule

| Field | Record |
|---|---|
| Symptom | At `63383a2`, qualification returned summary IDs/counts but omitted component identity, policy, expiry and exact acceptance references required by file B §11. Ordinary analysis reads rechecked expiry on every page/chunk, without an already-admitted path. |
| Evidence | Read file B §7.3/§11 and admission, publication, confirmation and component records. Two new projection tests failed on undefined fields; a separate durable-read test failed because the integration entry point did not exist. |
| Cause | The summary projection did not map full source evidence. Fresh admission and historical inspection were separate, but no reader was constrained by a durable F002 analysis binding. |
| Strategy | Project immutable records, without inventing source identities or a second F001 analysis registry. Verify native Git identity, directory provenance, all Gap pages and absolute expiry. |
| Deadline | Focus this boundary for 30 minutes; do not guess at cross-feature runtime wiring or take ownership of F002 analysis records. |
| Warning | Never remove public expiry checks, trust request-supplied historical timestamps, or use an in-memory allowlist as restart evidence. |
| Interaction | Qualification returns complete evidence, but still starts no analysis, publishes no bundle and extends no acceptance. |
| Acceptance | Projection RED 2 → GREEN; durable reader RED 1 → GREEN; 18 related tests pass with zero skips, including real PostgreSQL restart, revocation, corruption and public expiry rejection. |

## Repair

- Preserve existing `bundleId` and caller fields; add `sourceBundleSnapshotId`, components, `inventoryDigest`, `policyRevisionId`, `receiptValidUntil`, final database-clock `qualifiedAt`, `confirmationId` and `acceptanceRecordIds`. Without gaps, expiry is null and acceptance references are empty; the confirmation reference remains.
- Git projection retains SHA-1/SHA-256, exact commit and repository versus directory-root scope. Directory `manifestDigest` is its original content manifest hash. `provenance.uploadId` encodes the original `(runId, sourceId)` session key as canonical JSON/base64url, solely as a Workspace-scoped audit locator, outside content identity. Reused components retain their original upload session.
- Inventory IDs are already domain-separated full content digests, so `inventoryDigest=inventoryId`; no parallel identity is created. Gaps remain a fully paged set with logical `gapId/componentSnapshotId/reasonCode` aliases. The first page is not treated as the entire set.
- Receipt checks additionally bind confirmation ID, policy, expiry copies and status/Gap-count consistency. Final qualification uses the database clock after byte verification and under the current permission fence. It trusts no client clock and promises no permanent validity after returning.
- `admission.forAdmittedAnalysis(resolveBinding)` is the server-side F002 integration boundary. The mandatory trusted resolver loads `{ analysisRunId, sourceInput }` from F002's durable analysis record. Every page/chunk binds the exact Bundle, Receipt, confirmation/acceptance, inventory, policy, Gap set and original admission time. Missing or mismatched binding and revoked access are rejected. Echoing a request body is not a valid resolver.
- The admitted reader exposes no `qualify` method and creates no public HTTP expiry override. Ordinary `/admission`, `/inventory`, `/gaps` and `/file` retain fresh-admission expiry checks. Historical inspection retains its meaning. File reads still use the verified storage stream.

F002 continues to own persistence of its analysis records and original admission evidence. The real PostgreSQL contract test uses a test-only consumer table to prove survival across database/service recreation without an in-memory allowlist. That table is not production code, and this change does not claim to implement or validate F002 runtime wiring.

## Verification and remaining scope

`F001_TEST_PG_BIN=<isolated toolchain> node --test --test-concurrency=3 test/source-truth-admission.test.js test/source-truth-capture.test.js test/source-truth-http.test.js test/source-truth-renewal.test.js`: 18/18, exit 0. Exercises real HTTPS Git plus directory composition/reuse, real HTTP upload-to-seal-to-qualification, and isolated PostgreSQL durable reads. No production connections.

The real PostgreSQL case covers original analysis reads after expiry, absence of fresh-admission capability, ineffective forged request fields, rejected Receipt/acceptance/policy/inventory/Gap/time mismatches, cross-Workspace denial, unverified restore denial, revocation fencing the next chunk, and corrupt-byte rejection. SHA-256 and directory-root projection have a separate fixed-object fixture.

No UI layout changes, new migration, retention expiry or deletion behavior. Full source regression and repository gates still need verification; repository-wide type errors remain. Aggregate Git cache budget, eight-station browser acceptance, independent review and merge acceptance are unfinished. Prior 100k success and both timeout records remain unchanged.
