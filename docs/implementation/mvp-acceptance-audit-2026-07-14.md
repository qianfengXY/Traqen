# MVP acceptance audit — 2026-07-14

## Conclusion

The repository-controlled MVP mechanism satisfies all 17 acceptance capabilities in design section 20 and the technical scope in section 18.1. The built-in order reference pilot executes the complete section 18.3 chain with the same generic Scanner, Skill, governance, TestSpec, Runner, Evidence, impact, repair, and display contracts used by an external system.

This is not presented as final proof of enterprise value. Sections 18.2 and the enterprise half of 18.4 require a real medium-sized pilot system, three actual business flows, 10–20 governed Features, real test infrastructure/data, and confirmation by the responsible business, development, and test owners. Those assets and people are outside this repository and have not been fabricated.

## Section 20 acceptance matrix

| # | Result | Repository evidence |
| ---: | :---: | --- |
| 1 | PASS | `JavaScriptProjectScanner` extracts code symbols, endpoints, literal SQL, tables/columns, configuration, dependencies, and tests without invoking a Reverse Skill; Scanner regressions cover locations, diagnostics, and source fingerprints. |
| 2 | PASS | Signed, version-pinned `specone-reference` and `gsd-reference` adapters are registered, selected, blocked, and audited through one replaceable protocol. |
| 3 | PASS | Reverse runs preserve bounded raw output separately from normalized candidates; every candidate cites exact input Facts and all producer provenance survives deduplication. |
| 4 | PASS | Scope-aware opposing constraints create an explicit open `Conflict`; no score, majority, or adapter overwrites another conclusion. |
| 5 | PASS | The React Feature workbench displays product/Claim/Scope/Decision, implementation code/data/config, TestSpec/assertions, execution, and Evidence in one ordered view. |
| 6 | PASS | Authenticated statement-level review supports confirm, exception, reject, insufficient Evidence, and defer; the server owns reviewer identity and preserves the immutable decision history. |
| 7 | PASS | An authorized Claim plus its mapped Endpoint Fact deterministically generates an unapproved executable TestSpec draft; independent approval is required before execution. |
| 8 | PASS | The reference pilot runs a real local HTTP write against a PostgreSQL-compatible test environment, then verifies database state through a trusted read-only query catalog. |
| 9 | PASS | Runner-signed Evidence preserves exact versions plus request/response, normalized allowlisted SQL, query parameters/rows, assertions, lifecycle, structured LOG, and TRACE records. |
| 10 | PASS | Full-hash, no-Shell Git Diff identifies the changed artifact; Snapshot Fact comparison produces 14 changes and maps them to the affected Feature, Claim, and TestSpec. |
| 11 | PASS | Change impact invalidates only implementation mapping, conformance, coverage/verification, freshness, and trace segments; authorized reanalysis plus regression execution repairs the chain. |
| 12 | PASS | The server-derived view and product explanation answer why the current deployment is trusted using separate authority, conformance, verification, freshness, and conflict dimensions—not a composite score. |
| 13 | PASS | The reference pilot and product render the complete confirmed Claim → Scope → Decision → implementation/data/config → TestSpec → assertion → current deployment execution → Evidence chain. |
| 14 | PASS | Missing/stale/conflicting stages produce typed `TraceGap` records and force `complete=false`; the changed deployment visibly exposes three gaps before repair. |
| 15 | PASS | An implementation-only change preserves the normative Claim, Scope, human Decision, historical Facts, and historical Evidence while only derived current-state layers expire. |
| 16 | PASS | Execution domain/tests distinguish `FAIL`, `ERROR`, `INCONCLUSIVE`, `SKIPPED`, and `CANCELLED`; a nonzero trusted existing-test exit can be a product assertion failure rather than an infrastructure error. |
| 17 | PASS | Source uses Scanner bytes, Build/Deployment use a digest over actual runnable module files, and Runtime uses effective schema/config/dependency context. The signed task, running target, stored Snapshot, and every Evidence manifest must match all four IDs and SHA-256 digests. |

## Section 18.1 technical scope

- Node.js is the primary backend language; React is the product Web framework; the API is REST and PostgreSQL is the production relational store.
- One repository and the built-in order test environment are fully executable.
- The base Scanner, HTTP executor, read-only database assertion executor, controlled-write executor, and trusted existing-test executor are implemented.
- Two replaceable Reverse adapters plus a generic TEST_DESIGN capability are implemented. Skill output remains candidate knowledge pending human review.
- Human review, Feature traceability, ordered proof chains, TraceGap display, Snapshot history comparison, and Git Diff/Fact incremental impact are implemented in protocols, APIs, and the product interface.

## Executable vertical proof

`npm run pilot:order-submit` currently proves:

- 53 Fact nodes and 110 relations from the first complete Snapshot;
- two Reverse Skills, two independent sources on the merged Claim candidate, and one review-required candidate TestSpec;
- an approved `TEST-ORDER-SUBMIT@2` with `PASS` execution;
- `ASSERTION`, `DATABASE`, `HTTP`, `LOG`, `OTHER`, and `TRACE` Evidence;
- a real committed change to `src/server.js`, a changed deployment artifact digest, and 14 Git-correlated Fact changes;
- preserved `CONFIRMED` authority plus `CONFORMANCE_STALE`, `NOT_EXECUTED_ON_CURRENT_DEPLOYMENT`, and `EVIDENCE_STALE` gaps before repair;
- authorized reanalysis, `PASS` regression, rejection of historical Evidence as proof of the new deployment, and a final complete chain with zero gaps.

## External acceptance boundary

The following design outcomes cannot be truthfully completed from source code alone:

1. Section 18.2: select a real medium-sized pilot, three core business flows, and 10–20 Features.
2. Section 18.4: connect real code, test environment, redacted data, configuration, read-only database access, logs/traces, and existing tests.
3. Have the actual business, development, and test owners confirm statements and measure reverse-analysis accuracy, review cost, TestSpec executability, impact quality, regression value, high-value Feature trace-chain rate, repair time, Evidence freshness, and defect escape.

When those inputs are supplied, no Mock-only code path is required: the production API, Scanner/Fact contracts, replaceable Skill protocol, review workflow, trusted Runner catalogs, Evidence ingestion, impact service, and UI are the intended pilot path. Until that real pilot is run, the honest status is **repository MVP mechanism complete; enterprise-value acceptance pending external pilot**.
