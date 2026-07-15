# Evidence lifecycle validation — 2026-07-15

## Design obligation

Evidence must remain verifiable without retaining identifiable raw content forever. Retention varies by tenant/project classification and Evidence type; Legal Hold must block deletion; archive, access, export, physical deletion, and deletion proof must be auditable.

## Implemented model

`EvidenceRetentionPolicy` is immutable and versioned. It names the data classification, covered Evidence types, archive deadline, retention deadline, default Legal Hold behavior, and roles allowed to access or export derived Evidence. Authority identity is server-owned.

`EvidenceLifecycleEvent` is append-only and supports:

- `ARCHIVED`
- `LEGAL_HOLD_PLACED` / `LEGAL_HOLD_RELEASED`
- `DELETION_REQUESTED` / `DELETED`
- `ACCESSED` / `EXPORTED`

The lifecycle projection replays events and independently exposes archive state, deletion request, Legal Hold, deletion proof, and access count. A deletion request under Legal Hold becomes `DELETION_BLOCKED_LEGAL_HOLD`. Physical deletion cannot be recorded before a request or while a hold is active. `DELETED` requires a SHA-256 proof and storage-provider identity.

## Raw/derived boundary

Runner-ingested Evidence manifests are already sensitive-field-redacted and hash-bound. Large/raw encrypted objects are referenced by `storageUri` and remain in enterprise object/file storage. Traqen records lifecycle intent and proof; the enterprise storage adapter performs archive or deletion. After deletion, the immutable Evidence hash, derived manifest, policy reference, event history, and irreversible deletion proof remain—raw external bytes do not.

The repository does not pretend its PostgreSQL metadata row is an encrypted object store or KMS. Storage encryption, short-lived object authorization, physical object execution, key rotation, and provider Legal Hold enforcement remain deployment integrations.

## API and persistence

- `POST /v1/projects/{projectId}/evidence-retention-policies`
- `POST /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle-events`
- `GET /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle?policyId=...&policyVersion=...`

Migration `0011_evidence_lifecycle.sql` adds immutable policy/event tables, actor-tenant checks, Evidence and policy foreign keys, append-order identity, and mutation rejection.

## Verification

Tests cover archive deadlines, retention deadlines, Legal Hold/deletion conflict, deletion request sequencing, deletion-proof validation, access-role audit, HTTP contracts, PostgreSQL ordering and foreign keys, and preservation of the original verified Evidence metadata.
