> Language: **English** · [简体中文](test-spec-generation-validation-2026-07-14.zh-CN.md)

# TestSpec Generation and Approval Validation — 2026-07-14

## Outcome

This slice closes MVP acceptance item 7 at the protocol, application, HTTP, and persistence boundaries: a currently authorized endpoint rule can be deterministically converted into a reviewable TestSpec draft. Conversion does not create new business truth and never grants its own execution approval.

The generated record preserves the exact Claim version, Decision, implementation mapping, Snapshot Manifest, Endpoint Fact, converter identity/version, and canonical generation-request fingerprint. This makes the rule-to-test link explainable and prevents a retry or later approval from obscuring the original draft.

## Safety and authority boundaries

- Only a normative `endpointExposed EQUALS true` Claim with a current `CONFIRMED` or `EXCEPTION_RECORDED` Decision is supported.
- The Endpoint Fact must belong to the active implementation mapping for the requested Snapshot Manifest.
- Generated TestSpecs are always version 1, unapproved drafts. The converter cannot supply an approver or make the draft executable by authority alone.
- Public manual creation also accepts only unapproved drafts and rejects client-supplied `approval`, `origin`, or `createdAt` fields.
- Approval is a new immutable version. Reviewer identity and role come from the trusted resolver; allowed roles come from project policy; time and request fingerprint are server-generated.
- Approval fails while any deterministic blocker remains. Controlled writes therefore require an explicit server-recognized Seed precondition, cleanup strategy, assertion, and approval.
- Literal secrets remain rejected. Generated headers and bodies may only refer to locally resolved variables or `secretRef` values.
- Destructive and external-side-effect operation levels remain blocked.

## Idempotency and history

Generation retries with the same immutable request fingerprint return the original unapproved draft, even after an approved version exists. A reused TestSpec ID with a different origin conflicts. Approval retries by the same actor, role, expected version, and rationale return the existing approved version; a different approval decision conflicts.

PostgreSQL validation exercises the public draft and approval workflows, tenant-bound approver enforcement, append-only versions, exact Claim links for every TestSpec version, and latest-version Feature baseline selection. No schema migration was necessary because provenance and approval details are stored inside the existing immutable TestSpec specification document.

## Verification

- `npm test`: 109 tests passed.
- Contract JSON parsing: OpenAPI, TestSpec, and TestSpec-generation schemas parsed successfully.
- Coverage includes converter eligibility, safe-read and controlled-write classification, Seed/cleanup gaps, unsupported and unconfirmed Claim rejection, client approval spoofing, authentication, project role policy, approval idempotency, generation idempotency before and after approval, immutable PostgreSQL versions, tenant isolation, and existing Feature traceability behavior.

## Vertical-closure continuation

The subsequent controlled-write Runner slice closes the execution boundary described here: generation can explicitly bind endpoint path parameters and add reviewer-supplied database expectations through query-catalog references; the Runner then executes Seed, the allowlisted API write, read-only database verification, guaranteed cleanup, and signed Evidence for the same TestSpec, Snapshot Manifest, and deployment. The converter still does not infer database business expectations—the supplied draft remains subject to independent human approval.
