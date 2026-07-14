# Traqen

Traqen is an enterprise traceable-quality platform for legacy systems that do not have trustworthy product, design, or test assets.

The implementation follows one non-negotiable product vision:

> For every governed high-value feature, show an explainable chain from confirmed business intent to evidence produced against the actual deployment, and expose every missing, stale, conflicting, or failed link.

## Implemented foundation

The first executable slice is the framework-neutral domain kernel. It provides:

- immutable composite snapshot manifests;
- independent authority, conformance, verification, freshness, and conflict states;
- deterministic end-to-end trace-chain evaluation;
- explicit `TraceGap` detection;
- layered invalidation rules that do not invalidate business intent when code changes;
- a JSON command-line interface and automated tests.

The PostgreSQL storage slice adds:

- versioned tables for snapshots, features, claims, decisions, conformance, tests, evidence, and trace chains;
- append-only protection for facts, decisions, executions, evidence, and trace-chain history;
- deterministic, checksum-protected migrations;
- a storage port and PostgreSQL adapter for manifests and trace-chain revisions;
- real PostgreSQL migration tests through an embedded development-only database.

The minimal API slice adds:

- framework-neutral application services;
- API-only organization, tenant, project, principal, and Snapshot bootstrap without direct database setup;
- HTTP endpoints for evaluating, appending, and querying trace chains;
- a stable error envelope, request correlation IDs, JSON media checks, and body limits;
- an OpenAPI 3.1 contract;
- a development server backed by an in-memory append-only store;
- a PostgreSQL production process with checksum-protected automatic migrations, global API-token authentication, TLS policy, and graceful shutdown.

The governance slice adds:

- append-only Feature, ClaimScope, Claim, and human Decision records;
- write endpoints for building a governed business baseline;
- a Feature baseline query that keeps the original claim, full decision history, latest decision, and related trace chains together;
- database enforcement that a decision cannot replace its Claim's bound scope or cross the project's tenant boundary;
- stable conflict responses when immutable IDs or governed references collide.

The TestSpec validation slice adds:

- an immutable, Feature- and Claim-linked TestSpec v1alpha1 protocol;
- deterministic conversion of an authorized endpoint Claim and its exact mapped Endpoint Fact into an unapproved TestSpec draft with immutable origin provenance;
- a separate authenticated, policy-checked approval workflow whose actor, role, time, rationale, and idempotency fingerprint are assigned by the server;
- deterministic candidate and stored-spec validation endpoints;
- separate structural validity and execution eligibility results;
- approval provenance, tenant-bound approvers, and explicit operation safety levels;
- storage rejection for literal secrets, tokens, credentials, and authorization values;
- blocking policy gaps for missing assertions, missing approval, missing controlled-write Seed protocols, and missing cleanup;
- latest TestSpec versions in the Feature business baseline.

The trusted execution-ingestion slice adds:

- deterministic TestExecution status derivation from preserved attempt and assertion results;
- an attested Evidence Bundle bound to the exact TestSpec version, snapshot manifest, deployment, and Runner version;
- canonical SHA-256 Evidence hashes and HMAC-SHA256 Runner attestation verification;
- atomic append-only persistence for TestExecution and verified Evidence;
- rejection of forged status, modified Evidence, unredacted sensitive values, wrong deployments, and cross-project signatures;
- latest execution summaries in the Feature baseline and an on-demand full Evidence endpoint.

The controlled Runner slice adds:

- signed Runner tasks with a maximum five-minute validity window, replay-resistant nonces, local policy hashes, target Runner binding, and an injectable nonce registry;
- explicit target and route allowlists, response-size limits, timeouts, and redirect blocking;
- local-only `secretRef` resolution with recursive request, response, row, assertion, and error redaction;
- a SAFE_READ HTTP executor for GET/HEAD plus an explicitly allowlisted CONTROLLED_WRITE executor for bounded POST/PUT/PATCH requests;
- a read-only database executor that accepts only trusted query-catalog references, never TestSpec SQL, while preserving the executed normalized catalog SQL in signed Evidence;
- an existing-test executor that accepts only a trusted local `testRef` catalog entry, runs without a shell or task-supplied environment, bounds output and time, and preserves exit code/stdout/stderr for deterministic assertions;
- trusted target-local Seed and cleanup handlers selected through a signed fixture catalog, with setup/cleanup results preserved separately;
- trusted target-local LOG, TRACE, COVERAGE, SCREENSHOT, or OTHER collectors selected by signed policy declarations, with redaction and Snapshot binding;
- deterministic row-count and field assertions, followed by signed Evidence Bundle generation;
- guaranteed cleanup after setup, step, or assertion failure, plus isolation and compensation metadata when cleanup fails;
- distinct product failure, execution error, insufficient Evidence, skipped, and cancelled states;
- exact Source, Build, Deployment, and Runtime component identity/digest matching between the signed task, stored Snapshot Manifest, running target, and every Evidence manifest.

The deterministic fact-foundation slice adds:

- a language-neutral, immutable `FactNode`/`FactEdge`/`FactBundle` contract with stable entity IDs and snapshot-specific fact IDs;
- a bounded JavaScript/Node scanner for modules, symbols, Express-style routes, OpenAPI JSON, PostgreSQL DDL and literal queries, configuration references, dependencies, and test assets;
- source artifact, line range, and SHA-256 location data on every fact and relation;
- explicit incomplete results for parser failures, oversized files, unsupported source languages, and unsupported OpenAPI formats;
- a deterministic source fingerprint API used as the Source Snapshot digest;
- HMAC-SHA256 Scanner attestation plus exact Snapshot Manifest, Source component ID, and Source component digest binding before ingestion;
- append-only memory and PostgreSQL storage plus a filtered one-hop fact graph API;
- a self-scan command and a checked-in scanner validation report.

The Reverse Skill Framework slice adds:

- signed, versioned Skill Manifests with declared compatibility, structured input/output types, least-privilege permissions, model profiles, timeouts, and output caps;
- append-only `ALLOWED`/`OBSERVE`/`BLOCKED` supply-chain registration events bound to an installed adapter artifact digest;
- controlled, reproducibly hashed and server-size-bounded Fact input packages whose task scopes cannot escape the selected Snapshot Manifest and Source Snapshot;
- two replaceable built-in Specone- and GSD-compatible reference adapters that emit only candidate implementation knowledge from deterministic facts;
- a generic TEST_DESIGN capability that proposes human-review-required TestSpec candidates from endpoint Facts without approving or executing them;
- timeout, retry, cancellation-signal, sensitive-output, undeclared-output, incomplete-fact, publisher, model, and policy checks;
- canonical structured candidate output with mandatory fact provenance and separately preserved raw output;
- exact deterministic deduplication that preserves every source, plus scope-aware explicit conflicts and open questions instead of majority voting;
- append-only PostgreSQL run events, per-Skill attempts, raw and normalized outputs, conflicts, and open questions;
- APIs for Skill registration/listing and synchronous bounded Reverse Runs.

The governed Feature-traceability slice adds:

- authenticated, policy-checked, statement-level candidate review with `CONFIRMED`, `EXCEPTION_RECORDED`, `REJECTED`, `INSUFFICIENT_EVIDENCE`, and `DEFERRED` outcomes;
- atomic conversion of an approved implementation candidate into a distinct human-authored normative Claim, bound Scope, append-only Decision, exact Fact mapping, and deterministic conformance result;
- explicit protection against client-supplied reviewer identity, candidate restatement, unrelated conflict acknowledgement, cross-Scope decisions, and direct promotion of Skill output into business truth;
- a server-derived Feature traceability view whose authority, conformance, verification, freshness, and conflict dimensions remain independent;
- ordered trace segments covering Feature, Claim, Decision, Scope, conformance, implementation Facts, TestSpec, execution, and Evidence, with explicit `TraceGap` records instead of a composite green score;
- immutable Snapshot-to-Snapshot `ChangeSet`, impact, invalidation, and semantic-continuity records with affected Feature/Claim/TestSpec selection, Scope, reasons, and recommended actions;
- deterministic carry-forward of unchanged Fact mappings and conformance into a new Snapshot, while changed implementation invalidates only its derived layers and preserves normative Claims, business Decisions, historical Facts, Evidence, and audit history;
- a no-Shell Git Diff analyzer that accepts only full commit hashes, preserves add/delete/modify/rename paths, and deterministically correlates changed artifacts with Snapshot Fact changes;
- an authenticated implementation-reanalysis workflow that binds a reviewed current-Snapshot Reverse Candidate back to the existing normative Claim, records reviewer provenance in immutable conformance analysis, and closes the stale implementation segment without creating a replacement business Decision;
- append-only PostgreSQL migrations through `0007_change_impact`, plus equivalent in-memory behavior and HTTP/OpenAPI contracts.

The product-interface slice adds:

- a responsive Feature traceability workbench under `web/` that leads with “why the current deployment is trusted” rather than a composite quality score;
- independent authority, conformance, verification, freshness, and conflict status cards;
- an ordered Claim, Scope, Decision, implementation/data/config, TestSpec, assertion, execution, and Evidence chain with node provenance;
- explicit TraceGap ownership, an authenticated statement-level human review flow, and API-backed Snapshot history comparison with change-impact repair guidance;
- an explicitly labelled synthetic demonstration plus a connection panel that loads the server-derived Feature traceability API without reinterpreting trust on the client;
- an API token field kept only in page memory and sent through `x-traqen-api-token`, leaving reviewer Authorization credentials independent;
- an explicit CORS origin allowlist for connecting the browser product to a Traqen API.

The built-in reference-pilot slice adds:

- a runnable synthetic order platform with a real HTTP endpoint, PostgreSQL-compatible state, configuration, role and state guards, idempotency, an inventory dependency, transaction rollback, and same-order concurrency serialization;
- one command that scans the reference source, runs both replaceable Reverse Skills, performs an authorized statement review, generates and approves a controlled-write TestSpec, executes API plus database assertions, stores signed Evidence, and proves a complete trace chain;
- Source digests computed by the generic Scanner, Deployment/Build digests computed over the actual runnable module files, Runtime digests computed from the effective schema/config/inventory context, and LOG/TRACE telemetry collected from the running target;
- a real source modification in an isolated copy, Snapshot comparison, affected-Feature invalidation, explicit stale gaps, authorized implementation reanalysis, regression execution on the new deployment, and restoration of a complete chain;
- reuse of the unchanged approved TestSpec across Snapshots: its `sourceSnapshotId` remains generation provenance, while the signed Runner task and Evidence bind the actual execution Snapshot and deployment.

The development server remains local-only and in-memory. The production process requires PostgreSQL and a global API token. Decision, candidate-review, and TestSpec-approval routes additionally fail closed unless `REVIEWER_ID` is configured, and may use a distinct `REVIEWER_BEARER_TOKEN`; implementation reanalysis has the equivalent `IMPLEMENTATION_REVIEWER_*` boundary. Set both `RUNNER_ID` and `RUNNER_SHARED_SECRET` to ingest matching Runner-signed bundles, `SCANNER_ID` and `SCANNER_SHARED_SECRET` for Scanner-signed Fact Bundles, and `SKILL_PUBLISHER=TRAQEN` plus `SKILL_PUBLISHER_SHARED_SECRET` for Skill registration. HMAC is the local MVP trust mechanism, not a replacement for enterprise workload identity and mTLS. CONTROLLED_WRITE remains disabled unless the signed target policy explicitly allows the operation and route, binds every Snapshot component, names trusted fixture and cleanup protocols, and the Runner has matching local handlers. DELETE, destructive execution, task-authored commands/SQL/fixture code, external side effects, and cross-origin redirects remain blocked. Only compiled-in, digest-matched reference Skill adapters execute in-process; official external Specone/GSD integrations, model-backed or third-party Skills, isolated Skill workers, additional language scanners, and OpenAPI YAML extraction remain outside the repository-controlled MVP.

## Run

Requires Node.js 20 or newer.

```bash
npm test
npm run test:storage
npm run test:web
npm run test:reference
npm run example
npm run pilot:order-submit
npm run scan:self
npm run api:dev
npm run api:serve
```

The development API binds to `127.0.0.1:3000` by default. It is not a production authentication boundary and must not be exposed outside a local development environment; governance review operations additionally fail closed unless a trusted local reviewer is configured.

The production API binds to `0.0.0.0:3000` by default and requires `DATABASE_URL` plus `API_BEARER_TOKEN`. `POSTGRES_SSL` is `require` by default and also accepts `no-verify` or `disable` for explicitly controlled environments. `CORS_ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist. On startup the process connects through the pinned `pg` client, verifies and applies pending migrations, then serves the PostgreSQL-backed application. Create the initial boundary through `POST /v1/projects`, register immutable execution context through `POST /v1/projects/{projectId}/snapshots`, and send the API token through `Authorization: Bearer ...` or `x-traqen-api-token`.

Evaluate another trace-chain input:

```bash
node src/cli/evaluate-trace-chain.js path/to/input.json
```

Emit a complete signed Fact Bundle for ingestion:

```bash
SCANNER_ID=javascript-node-scanner \
SCANNER_SHARED_SECRET=local-development-secret \
node src/cli/scan-facts.js --root . --project PROJECT-001 \
  --snapshot SNAPSHOT-MANIFEST-001 --source-component SOURCE-SNAPSHOT-001
```

The Fact API accepts signed bundles at `POST /v1/projects/{projectId}/fact-scans` and returns filtered one-hop graphs from `GET /v1/projects/{projectId}/facts`. Its `type`, `predicate`, `q`, `snapshotManifestId`, and `limit` query parameters are optional.

`npm run pilot:order-submit` is the reproducible in-repository MVP proof. It uses only synthetic data and the same generic Scanner, Skill, review, TestSpec, Runner, Evidence, impact, and repair paths that a real pilot uses; no order-specific behavior exists in the Traqen core.

Reverse Skill Manifests are registered and listed at `POST/GET /v1/skills`. A bounded run pins every Skill by ID and exact version, is submitted to `POST /v1/reverse-runs`, and is queried from `GET /v1/projects/{projectId}/reverse-runs/{runId}`. Raw Skill output is never treated as a Claim or business baseline: the run stops at `WAITING_REVIEW` with candidates, conflicts, and open questions until the separate authorized review flow records an outcome.

Review one candidate with `POST /v1/projects/{projectId}/reverse-runs/{runId}/candidates/{candidateId}/reviews`, then read its governed baseline and server-derived proof chain from `GET /v1/projects/{projectId}/features/{featureId}/baseline` and `GET /v1/projects/{projectId}/features/{featureId}/traceability?snapshotManifestId=...`. Compare two manifests with `POST /v1/projects/{projectId}/change-sets`; the immutable impact record is available at `GET /v1/projects/{projectId}/change-sets/{changeSetId}/impact`.

After a changed implementation is analyzed in a new Reverse Run, an authorized developer or architect can repair the stale implementation segment with `POST /v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses`. This creates a new Snapshot-bound mapping and conformance record for the existing Claim and Scope; it never edits or replaces the normative Decision.

The detailed design is in [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md). The current repository acceptance result and the explicit external-pilot boundary are recorded in [docs/implementation/mvp-acceptance-audit-2026-07-14.md](docs/implementation/mvp-acceptance-audit-2026-07-14.md); production startup and bootstrap are covered by [docs/implementation/production-runtime-validation-2026-07-14.md](docs/implementation/production-runtime-validation-2026-07-14.md).
