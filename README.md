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
- HTTP endpoints for evaluating, appending, and querying trace chains;
- a stable error envelope, request correlation IDs, JSON media checks, and body limits;
- an OpenAPI 3.1 contract;
- a development server backed by an in-memory append-only store.

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
- a read-only database executor that accepts only trusted query-catalog references, never TestSpec SQL;
- trusted target-local Seed and cleanup handlers selected through a signed fixture catalog, with setup/cleanup results preserved separately;
- deterministic row-count and field assertions, followed by signed Evidence Bundle generation;
- guaranteed cleanup after setup, step, or assertion failure, plus isolation and compensation metadata when cleanup fails;
- distinct product assertion failures and Runner/executor errors.

The deterministic fact-foundation slice adds:

- a language-neutral, immutable `FactNode`/`FactEdge`/`FactBundle` contract with stable entity IDs and snapshot-specific fact IDs;
- a bounded JavaScript/Node scanner for modules, symbols, Express-style routes, OpenAPI JSON, PostgreSQL DDL and literal queries, configuration references, dependencies, and test assets;
- source artifact, line range, and SHA-256 location data on every fact and relation;
- explicit incomplete results for parser failures, oversized files, unsupported source languages, and unsupported OpenAPI formats;
- HMAC-SHA256 Scanner attestation and exact Snapshot Manifest binding before ingestion;
- append-only memory and PostgreSQL storage plus a filtered one-hop fact graph API;
- a self-scan command and a checked-in scanner validation report.

The Reverse Skill Framework slice adds:

- signed, versioned Skill Manifests with declared compatibility, structured input/output types, least-privilege permissions, model profiles, timeouts, and output caps;
- append-only `ALLOWED`/`OBSERVE`/`BLOCKED` supply-chain registration events bound to an installed adapter artifact digest;
- controlled, reproducibly hashed and server-size-bounded Fact input packages whose task scopes cannot escape the selected Snapshot Manifest and Source Snapshot;
- two replaceable built-in Specone- and GSD-compatible reference adapters that emit only candidate implementation knowledge from deterministic facts;
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
- append-only PostgreSQL migrations through `0007_change_impact`, plus equivalent in-memory behavior and HTTP/OpenAPI contracts.

The development server remains local-only and in-memory. Most foundation write routes are not production-authenticated; Decision, candidate-review, and TestSpec-approval routes fail closed unless `REVIEWER_ID` is configured, and may be protected with `REVIEWER_BEARER_TOKEN`. Set both `RUNNER_ID` and `RUNNER_SHARED_SECRET` to enable local ingestion of matching Runner-signed bundles; use `SCANNER_ID` and `SCANNER_SHARED_SECRET` for Scanner-signed Fact Bundles. Skill registration additionally requires `SKILL_PUBLISHER=TRAQEN` and `SKILL_PUBLISHER_SHARED_SECRET`. HMAC is the local MVP trust mechanism, not a replacement for the planned enterprise workload identity and mTLS boundary. CONTROLLED_WRITE remains disabled unless the signed target policy explicitly allows the operation level and route, names a trusted fixture protocol, permits its cleanup strategy, and the Runner has the matching local handler. DELETE, destructive execution, external side effects, TestSpec SQL, arbitrary fixture code, and cross-origin redirects remain blocked. Only compiled-in, digest-matched reference Skill adapters can execute in-process: arbitrary uploaded code, official external Specone/GSD integrations, model execution, and networked Skills are not enabled. Production-wide authentication, runtime PostgreSQL wiring, isolated external Skill workers, additional language scanners, and OpenAPI YAML extraction are not part of this slice.

## Run

Requires Node.js 20 or newer.

```bash
npm test
npm run test:storage
npm run example
npm run scan:self
npm run api:dev
```

The development API binds to `127.0.0.1:3000` by default. It is not a production authentication boundary and must not be exposed outside a local development environment; governance review operations additionally fail closed unless a trusted local reviewer is configured.

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

Reverse Skill Manifests are registered and listed at `POST/GET /v1/skills`. A bounded run pins every Skill by ID and exact version, is submitted to `POST /v1/reverse-runs`, and is queried from `GET /v1/projects/{projectId}/reverse-runs/{runId}`. Raw Skill output is never treated as a Claim or business baseline: the run stops at `WAITING_REVIEW` with candidates, conflicts, and open questions until the separate authorized review flow records an outcome.

Review one candidate with `POST /v1/projects/{projectId}/reverse-runs/{runId}/candidates/{candidateId}/reviews`, then read its governed baseline and server-derived proof chain from `GET /v1/projects/{projectId}/features/{featureId}/baseline` and `GET /v1/projects/{projectId}/features/{featureId}/traceability?snapshotManifestId=...`. Compare two manifests with `POST /v1/projects/{projectId}/change-sets`; the immutable impact record is available at `GET /v1/projects/{projectId}/change-sets/{changeSetId}/impact`.

The detailed design is in [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md).
