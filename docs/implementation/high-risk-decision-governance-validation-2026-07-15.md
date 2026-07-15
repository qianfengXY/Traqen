# High-risk Decision governance validation — 2026-07-15

## Design obligation

The design requires authorization by project, domain, statement type, and risk; dual or business-plus-compliance confirmation for high-risk rules; separation of duties; validity, revocation, dispute, reopening, delegation-ready identity context; and time-limited Break-glass with reason, approver, and post-review deadline.

## Implemented workflow

`DecisionReviewCase` is an immutable proposal bound to an exact Claim and Scope version. It declares risk, approval mode, the proposed Decision, expiry, and—only for Break-glass—an emergency reason and post-review deadline. Proposer identity is assigned by the server.

`DecisionReviewEvent` is an append-only event with server-assigned actor identity. Supported actions are `APPROVE`, `REJECT`, `REVOKE`, `DISPUTE`, `REOPEN`, and `POST_REVIEW`. Evaluation replays append order and reports `PENDING`, `APPROVED`, `REJECTED`, `REVOKED`, `DISPUTED`, `EXPIRED`, or `POST_REVIEW_OVERDUE` without overwriting history.

Approval rules enforce:

- the proposer cannot approve the proposal;
- two approvals mean two distinct actors;
- `BUSINESS_COMPLIANCE` requires both configured role groups, not merely any two people;
- Break-glass accepts only configured emergency approver roles and cannot exceed the configured validity maximum;
- revocation, dispute, reopening, and post-review require lifecycle-authorized roles;
- reopening resets the active approval round, so prior approvals cannot be reused.

The final approval and Decision publication occur in one storage transaction. Revocation publishes a new `DEPRECATED` Decision; dispute publishes a new `DEFERRED` Decision. Re-approval after reopening publishes another immutable confirmation associated with the same review case. Existing history remains queryable.

## Identity and policy integration

The configured application supports a legacy single reviewer or `REVIEWER_IDENTITIES_JSON` for multiple bearer-token-bound actor/role identities. Role sets for proposers, normal approvers, business, compliance, emergency, and lifecycle actions are configured separately. Direct Decision creation is disabled by default in the configured runtime so clients cannot bypass the review case by omitting a risk field.

This local identity resolver demonstrates the policy boundary; it is not enterprise SSO. Organization/tenant/project and actor-tenant integrity are enforced in persistence. Enterprise identity, delegated authority feeds, group lifecycle, and revocation propagation remain adopter integrations.

## Persistence and API

Migration `0009_decision_governance.sql` adds immutable review case, event, and materialization tables with Claim/Scope/Principal foreign keys, tenant and scope triggers, append-order identity, and mutation rejection.

- `POST /v1/projects/{projectId}/decision-review-cases`
- `GET /v1/projects/{projectId}/decision-review-cases/{caseId}`
- `POST /v1/projects/{projectId}/decision-review-cases/{caseId}/events`

OpenAPI and JSON Schema exclude proposer and event actor identity from client request bodies.

## Verification

Tests cover self-approval rejection, distinct dual approvals, business/compliance role-group enforcement, atomic Decision materialization, revocation, reopening and fresh re-approval, bounded Break-glass, overdue and completed post-review, HTTP identity separation, PostgreSQL transaction history, tenant/scope integrity, contract exposure, and expired Decision authority handling.
