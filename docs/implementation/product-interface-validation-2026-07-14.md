# Product interface validation — 2026-07-14

## Outcome

This slice turns the existing protocols and APIs into the user-facing product described by the design vision. It closes the display portion of MVP acceptance items 5, 12, 13, 14, and 15, exposes the human-review workflow required by item 6, and provides the historical Snapshot comparison required by the MVP scope.

The north-star question remains: **why can the selected Feature be trusted on the selected deployment?** The interface does not replace the independent authority, conformance, verification, freshness, and conflict dimensions with a composite score.

## Product surfaces

The responsive React workbench in `web/` provides three connected surfaces:

1. **Feature traceability** — an ordered Claim → Scope → Decision → implementation/data/config → TestSpec → assertion → execution → Evidence chain, per-node provenance, independent trust dimensions, explicit TraceGap ownership, and a human-readable explanation of why the deployment can or cannot currently be trusted.
2. **Statement review** — a Reverse Run and Candidate can be loaded from the API. A reviewer must explicitly supply the normative statement, Scope, target IDs, rationale, and acknowledged conflicts. A formal decision is sent to the authenticated candidate-review endpoint. Reviewer identity and role are never accepted from the browser; the bearer token is held only in component memory and cleared after success.
3. **Change impact** — two immutable Snapshot Manifest IDs are compared through the ChangeSet endpoint. The UI shows changed Facts, affected Features/Claims/TestSpecs, invalidated derived layers, preserved normative truth and history, semantic continuities, warnings, and the server-recommended repair order.

## Truth boundary

The built-in order-submission scenario is labelled `DEMO SNAPSHOT`. Its review actions never persist anything. Live Feature traceability, candidate review, and history comparison use the Traqen API and are labelled separately.

The browser does not infer a green status from partial data. Live completeness, dimensions, segments, gaps, impact, invalidations, and continuity all come from server-derived contracts. A missing necessary link remains a visible TraceGap and prevents the chain from being represented as complete.

## Browser-to-API boundary

The local API now accepts an explicit `CORS_ALLOWED_ORIGINS` allowlist. Wildcards, origins containing paths, and credential-bearing origins are rejected during server construction. Unknown origins receive no access grant; permitted origins receive only the methods and headers needed by the product. The default remains local development only.

## Scenarios validated

- A complete current-deployment chain displays all required stages and verified HTTP, database, assertion, and lifecycle Evidence.
- A semantically changed implementation preserves the normative Claim, Scope, Decision, and historical Evidence while marking only implementation-derived and verification segments stale.
- The changed scenario explains why the new deployment cannot yet be trusted and assigns each gap to a repair role.
- Demo decisions remain non-persistent.
- Live review is fail-closed without a reviewer credential and leaves actor identity to the server.
- Historical comparison is persisted as a named ChangeSet rather than computed as ephemeral client state.

## Verification

- Root regression: 113 tests passed.
- Product build and rendered-HTML suite: 2 tests passed.
- Product ESLint: passed.
- Product dependency audit: 0 vulnerabilities.
- Self-scan: 1,057 locatable nodes and 2,858 edges. The bundle is intentionally marked incomplete because the current MVP Scanner declares JavaScript rather than TypeScript/TSX semantic support; the Scanner reports that limitation instead of presenting false completeness.

The TypeScript/TSX diagnostic is consistent with the design constraint that the MVP proves one primary backend language and framework first. It is not treated as evidence that the UI source has been semantically scanned.
