> Language: **English** · [简体中文](README.zh-CN.md)

# Traqen

Traqen is an enterprise traceable-quality platform for legacy systems that do not have trustworthy product, design, or test assets.

The implementation follows one non-negotiable product vision:

> For every governed high-value Feature, present an explainable traceability chain from confirmed business intent to Evidence from the actual deployment, and expose every missing, stale, conflicting, or failed link.

The local Workspace Analysis Agent has also been exercised against the real [`zts212653/clowder-ai`](https://github.com/zts212653/clowder-ai) monorepo at a pinned commit. The resulting [bilingual validation report](docs/implementation/clowder-ai-workspace-analysis-2026-07-18.md) records the observed scale, false-positive corrections, domain tree, conservative test/configuration associations, and the distinction between implementation candidates and confirmed business Features.

The initialized Feature tree offers two global projections without rescanning: a pure business-capability view that excludes APIs and engineering commands, and an API-only view containing HTTP/OpenAPI endpoints. Workspace statistics, Feature traceability, and the trace graph follow the same active projection.

Before starting a local Workspace analysis, open **Configure model** in the global header and add one or more OpenAI-compatible profiles with an API URL, model name, API key, and optional Stream/SSE strategy. Runtime profiles and credentials are encrypted in the current device's Traqen configuration directory; the UI can edit, verify, select, and delete them without re-entering an unchanged key. The Web and API processes must run from the same repository revision; an older API does not expose the model-profile routes. The analysis task console shows every LLM request, expandable prompt/evidence input, gateway and stream progress, expandable structured output, validation, Token usage when available, checkpoints, overall percentage, and elapsed time. Extractor observations carry independent corroborations, diagnostics, completeness, and a confidence cap; an AST or pattern match is never treated as business truth. Workspace visibility management lets you remove projects from the sidebar without deleting their scan results; hidden projects do not load their source index, Feature tree, or traceability snapshot.

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

The governed business-process slice adds:

- immutable, Feature-version-bound Actor/Role, BusinessState, StateTransition, guard, exception, and DesignElement records;
- structural checks for exactly one initial state, terminal outcomes, valid actor/state references, no self transitions, and no unreachable states;
- authenticated policy-controlled human authority, with actor identity and confirmation time assigned by the server rather than accepted from a client or Skill;
- Snapshot-bound links from transitions and design elements to existing deterministic implementation Facts, rejecting missing Facts instead of inventing mappings;
- a real business-process graph preset with `HAS_ROLE`, `HAS_STATE`, `HAS_TRANSITION`, `TRANSITIONS_TO`, `PERFORMS`, `DESIGNED_BY`, and `IMPLEMENTED_BY` relations;
- PostgreSQL migration `0008_business_process_model`, memory parity, HTTP/OpenAPI contracts, UI demonstration, and reference-pilot coverage across changed Snapshots.

The high-risk Decision-governance slice adds:

- append-only Decision review cases and events for `SINGLE`, `DUAL`, `BUSINESS_COMPLIANCE`, and bounded `BREAK_GLASS` approval modes;
- strict separation of proposer and approver identity, distinct-person counting, required business/compliance role groups, rejection, revocation, dispute, and explicit reopening with fresh approvals;
- time-limited emergency exceptions, policy-capped validity, named emergency reasons, post-review deadlines, and a visible `POST_REVIEW_OVERDUE` state;
- atomic publication of a normal Decision only after the configured approval rule is satisfied, plus append-only `DEPRECATED`/`DEFERRED` authority records for revocation and dispute;
- a multi-reviewer bearer directory for local/production integration, while leaving enterprise SSO, delegation directories, and organization ABAC to the adopting identity boundary;
- PostgreSQL migration `0009_decision_governance`, HTTP/OpenAPI contracts, and memory/PostgreSQL tests for multi-person materialization.

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

The Evidence-lifecycle slice adds:

- immutable, versioned retention policies scoped by data classification and Evidence type, with separate archive and retention deadlines;
- append-only archive, Legal Hold placement/release, deletion request, deletion proof, access, and export events;
- explicit `DELETION_BLOCKED_LEGAL_HOLD` and `DELETION_DUE` states rather than silently deleting or indefinitely retaining content;
- role-filtered access/export audit, lifecycle-governance authorization, and required irreversible external-object deletion proof while retaining hashes and audit history;
- PostgreSQL migration `0011_evidence_lifecycle`, memory parity, HTTP/OpenAPI contracts, and domain/API/PostgreSQL tests.

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
- a bounded JavaScript/Node and Java AST scanner for modules, symbols, state enums/transitions, condition and permission guards, exception paths, Express/Spring/JAX-RS routes, OpenAPI JSON, PostgreSQL DDL and literal queries, configuration references, dependencies, and test assets;
- source artifact, line range, and SHA-256 location data on every fact and relation;
- explicit incomplete results for parser failures, oversized files, unsupported source languages, and unsupported OpenAPI formats;
- a deterministic source fingerprint API used as the Source Snapshot digest;
- HMAC-SHA256 Scanner attestation plus exact Snapshot Manifest, Source component ID, and Source component digest binding before ingestion;
- append-only memory and PostgreSQL storage plus a filtered one-hop fact graph API;
- a self-scan command and a checked-in scanner validation report.

The Analysis Agent slice adds:

- deterministic and configurable hybrid model modes over the same immutable Fact graph;
- graph-partitioned WorkUnits with explicit context budgets, reserved model headroom, bounded evidence packages, and per-unit checkpoints;
- asynchronous start, immediate pause, persisted resume, full-first and later incremental execution;
- exact evidence-boundary validation for model and Skill outputs, including stable-node references;
- stable Feature reconciliation that preserves human authority across implementation remapping and near-full rescans, while requiring review for business-semantic changes;
- separate latest business/API projections, immutable result history, retirement events, and per-Feature history queries;
- PostgreSQL checkpoint/result storage and a browser-local deterministic workflow with resumable IndexedDB batches;
- a configurable OpenAI-compatible model adapter whose credentials stay in server environment variables, plus bounded reference Skill adapters.

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
- APIs for Skill registration/listing, synchronous bounded Reverse Runs, and opt-in durable asynchronous jobs.

The asynchronous Reverse Run slice adds:

- `Prefer: respond-async` or `?async=true` submission with immediate `202` and a queryable job projection;
- append-only `QUEUED`, `STARTED`, `CANCEL_REQUESTED`, `COMPLETED`, `FAILED`, and `CANCELLED` events instead of an overwritten task row;
- active AbortSignal cancellation through the existing Skill timeout boundary, terminal-state conflict protection, and deterministic error summaries;
- persisted recovery of an interrupted nonterminal request through an explicit resume operation, while preserving every prior attempt event;
- PostgreSQL migration `0010_reverse_run_job`, in-memory parity, HTTP/OpenAPI contracts, and tests for ordered persistence, cancellation, recovery, and immutable job history.

The governed Feature-traceability slice adds:

- authenticated, policy-checked, statement-level candidate review with `CONFIRMED`, `EXCEPTION_RECORDED`, `REJECTED`, `INSUFFICIENT_EVIDENCE`, and `DEFERRED` outcomes;
- atomic conversion of an approved implementation candidate into a distinct human-authored normative Claim, bound Scope, append-only Decision, exact Fact mapping, and deterministic conformance result;
- explicit protection against client-supplied reviewer identity, candidate restatement, unrelated conflict acknowledgement, cross-Scope decisions, and direct promotion of Skill output into business truth;
- a server-derived Feature traceability view whose authority, conformance, verification, freshness, and conflict dimensions remain independent;
- a bounded Cytoscape Feature graph and shortest-path API projected from that same traceability source, with typed assertions, conflicts, TraceGaps, provenance, Snapshot binding, and progressive expansion;
- ordered trace segments covering Feature, Claim, Decision, Scope, conformance, implementation Facts, TestSpec, execution, and Evidence, with explicit `TraceGap` records instead of a composite green score;
- immutable Snapshot-to-Snapshot `ChangeSet`, impact, invalidation, and semantic-continuity records with affected Feature/Claim/TestSpec selection, Scope, reasons, and recommended actions;
- deterministic carry-forward of unchanged Fact mappings and conformance into a new Snapshot, while changed implementation invalidates only its derived layers and preserves normative Claims, business Decisions, historical Facts, Evidence, and audit history;
- a no-Shell Git Diff analyzer that accepts only full commit hashes, preserves add/delete/modify/rename paths, and deterministically correlates changed artifacts with Snapshot Fact changes;
- an authenticated implementation-reanalysis workflow that binds a reviewed current-Snapshot Reverse Candidate back to the existing normative Claim, records reviewer provenance in immutable conformance analysis, and closes the stale implementation segment without creating a replacement business Decision;
- governed Feature evolution with sequential immutable versions, version-bound aliases, and human-attributed merge/split lineage that rejects dangling or cyclic edges;
- append-only PostgreSQL migrations through `0012_feature_evolution`, plus equivalent in-memory behavior and HTTP/OpenAPI contracts.

The product-interface slice adds:

- a responsive Feature traceability workbench under `web/` that leads with “why the current deployment is trusted” rather than a composite quality score;
- independent authority, conformance, verification, freshness, and conflict status cards;
- live platform operations observations for Reverse Runs, Scanner volume, test execution, Evidence, and impact analysis, with unavailable external telemetry shown explicitly;
- a five-block product projection—Feature description, design/implementation, configuration, test cases, and test results—with each feature narrative and test strategy presented as one continuous document instead of nested field cards, a repository-backed Markdown design reader, raw Markdown, business code blocks and complete source-file views, a DEV/SIT/UAT/PROD configuration matrix, expandable versioned cases, and scenario-grouped results with failure drill-down;
- an Apple-inspired responsive visual system tuned for a 27-inch desktop workspace, with larger typography, restrained system colors, wider document reading measures, consistent spacing, and unified navigation, panels, forms, graphs, reviews, impact, and metrics surfaces;
- a stable future-Agent boundary in which an Agent consumes an approved versioned TestSpec and returns structured step, assertion, Evidence, runner identity, and attestation data, without being allowed to rewrite business confirmation or decide the final trusted state;
- explicit TraceGap ownership, an authenticated statement-level human review flow, and API-backed Snapshot history comparison with change-impact repair guidance;
- a Traqen `SELF WORKSPACE` projection backed by this repository's real design, source, configuration contract, tests, and results, plus a connection panel that loads the server-derived Feature traceability API without reinterpreting trust on the client;
- an API token field kept only in page memory and sent through `x-traqen-api-token`, leaving reviewer Authorization credentials independent;
- an explicit CORS origin allowlist for connecting the browser product to a Traqen API.

The built-in reference-pilot slice adds:

- a runnable synthetic order platform with a real HTTP endpoint, PostgreSQL-compatible state, configuration, role and state guards, idempotency, an inventory dependency, transaction rollback, and same-order concurrency serialization;
- one command that scans the reference source, runs both replaceable Reverse Skills, performs an authorized statement review, generates and approves a controlled-write TestSpec, executes API plus database assertions, stores signed Evidence, and proves a complete trace chain;
- Source digests computed by the generic Scanner, Deployment/Build digests computed over the actual runnable module files, Runtime digests computed from the effective schema/config/inventory context, and LOG/TRACE telemetry collected from the running target;
- a real source modification in an isolated copy, Snapshot comparison, affected-Feature invalidation, explicit stale gaps, authorized implementation reanalysis, regression execution on the new deployment, and restoration of a complete chain;
- reuse of the unchanged approved TestSpec across Snapshots: its `sourceSnapshotId` remains generation provenance, while the signed Runner task and Evidence bind the actual execution Snapshot and deployment.
- bounded endpoint implementation context that retains state/permission guards, state transitions, and exception-path Facts through review, mapping, change impact, graph exploration, and repair without treating them as business authority.

The continuous-protection slice adds:

- a server-derived regression plan that selects mapped affected TestSpecs union an operator-configured fixed high-risk set;
- conservative fallback expansion whenever Fact comparison is incomplete or emits warnings;
- explicit unresolved tests, per-Feature independent dimensions, TraceGaps, selection reasons, and required repair actions;
- separate `PASS`, `BLOCKED`, and `UNKNOWN` assessment from `ADVISORY`, `MANUAL_APPROVAL`, and `ENFORCED` policy enforcement;
- an API, CI exit-code CLI, product gate panel, and vertical-pilot proof that transitions from blocked after change to pass after reanalysis and current-deployment execution.

The product-effectiveness metrics slice adds a Snapshot-bound dashboard and API for high-value valid-chain rate, Claim confirmation, confirmed-rule TestSpec coverage, meaningful assertions, Evidence freshness, TraceGap type/severity/owner, and per-Feature layer presence. Every ratio keeps its numerator and denominator, every Feature keeps its independent trust dimensions, and metrics that require external longitudinal, CI/CD, or defect data are explicitly unavailable instead of estimated. `HIGH_VALUE_FEATURE_IDS` optionally narrows the north-star population; without it, all governed Features are included.

The development server remains local-only and in-memory. The production process requires PostgreSQL and a global API token. Decision review, candidate-review, TestSpec-approval, and business-process confirmation routes additionally fail closed unless a reviewer identity is configured. Use legacy `REVIEWER_ID`/`REVIEWER_ROLE` with an optional `REVIEWER_BEARER_TOKEN`, or `REVIEWER_IDENTITIES_JSON` for multiple token-bound actor/role identities; direct Decision creation is disabled by default and requires the review-case API unless `ALLOW_DIRECT_DECISIONS=true` is explicitly set. Decision proposer/approver/business/compliance/Break-glass/lifecycle roles and maximum emergency minutes are independently configurable. Implementation reanalysis has the distinct `IMPLEMENTATION_REVIEWER_*` boundary. Set both `RUNNER_ID` and `RUNNER_SHARED_SECRET` to ingest matching Runner-signed bundles, `SCANNER_ID` and `SCANNER_SHARED_SECRET` for Scanner-signed Fact Bundles, and `SKILL_PUBLISHER=TRAQEN` plus `SKILL_PUBLISHER_SHARED_SECRET` for Skill registration. HMAC is the local MVP trust mechanism, not a replacement for enterprise workload identity and mTLS. CONTROLLED_WRITE remains disabled unless the signed target policy explicitly allows the operation and route, binds every Snapshot component, names trusted fixture and cleanup protocols, and the Runner has matching local handlers. DELETE, destructive execution, task-authored commands/SQL/fixture code, external side effects, and cross-origin redirects remain blocked. Configured Analysis Agent model adapters use bounded evidence and server-resolved secrets; third-party Skills, isolated Skill workers, additional deterministic language AST adapters, and OpenAPI YAML extraction remain outside the repository-controlled MVP.

## Quick start

The complete local stack requires Node.js 22.13 or newer. On the first checkout, or after a lockfile changes, install both root and Web dependencies once:

```bash
npm run setup
```

After that, one command starts the local API and Web application together:

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. The command starts the in-memory API at `http://127.0.0.1:3100`, configures the exact local CORS origins, and stops both processes when you press `Ctrl+C`. It does not enable production credentials or weaken any governance boundary.

The API can still be run independently on its default port with `npm run api:dev`; this path requires Node.js 20 or newer. Other focused commands remain available:

```bash
npm test
npm run test:storage
npm run test:web
npm run test:reference
npm run example
npm run pilot:order-submit
npm run quality-gate -- --base-url http://127.0.0.1:3100 --project PROJECT-001 --change-set CHANGESET-001
npm run scan:self
npm run api:serve
```

The development API remains loopback-only and in-memory. It is not a production authentication boundary and must not be exposed outside a local development environment; governance review operations additionally fail closed unless a trusted local reviewer is configured.

The production API binds to `0.0.0.0:3000` by default and requires `DATABASE_URL` plus `API_BEARER_TOKEN`. `POSTGRES_SSL` is `require` by default and also accepts `no-verify` or `disable` for explicitly controlled environments. `CORS_ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist. On startup the process connects through the pinned `pg` client, verifies and applies pending migrations, then serves the PostgreSQL-backed application. Create the initial boundary through `POST /v1/projects`, register immutable execution context through `POST /v1/projects/{projectId}/snapshots`, and send the API token through `Authorization: Bearer ...` or `x-traqen-api-token`. The API and product UI can discover available resources through `GET /v1/projects/{projectId}/features` and `GET /v1/projects/{projectId}/snapshots`; Snapshot results are newest first, so service verification does not require copying opaque IDs from storage.

`QUALITY_GATE_MODE` defaults to `ADVISORY` and may be set to `MANUAL_APPROVAL` or `ENFORCED`. `HIGH_RISK_FEATURE_IDS`, `FIXED_HIGH_RISK_TEST_SPEC_IDS`, and `CONSERVATIVE_REGRESSION_TEST_SPEC_IDS` are comma-separated policy inputs. The quality-gate CLI reads its credential from `TRAQEN_API_TOKEN` (or `API_BEARER_TOKEN`), returns 0 for pass/advisory warning, 1 for enforced failure, 2 when manual approval is required, and 3 for API/configuration failure.

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

Start the Analysis Agent after the selected Snapshot has deterministic Facts with `POST /v1/projects/{projectId}/analysis-runs`. Runs are asynchronous by default and can be queried, paused, and resumed under the same `/analysis-runs/{analysisRunId}` resource. Read the latest current projection from `/analysis-results/latest` and immutable Feature evolution from `/features/{featureId}/analysis-history`. Configure and verify a runtime model through `/v1/analysis-model-profiles` or provision managed profiles through `ANALYSIS_MODEL_PROFILES_JSON`; see the [bilingual Analysis Agent design](docs/features/analysis-agent-design.md) for credentials, bounded Workspace enrichment, incremental behavior, and authority-inheritance rules.

`npm run pilot:order-submit` is the reproducible in-repository MVP proof. It uses only synthetic data and the same generic Scanner, Skill, review, TestSpec, Runner, Evidence, impact, and repair paths that a real pilot uses; no order-specific behavior exists in the Traqen core.

Reverse Skill Manifests are registered and listed at `POST/GET /v1/skills`. A bounded run pins every Skill by ID and exact version, is submitted to `POST /v1/reverse-runs`, and is queried from `GET /v1/projects/{projectId}/reverse-runs/{runId}`. Raw Skill output is never treated as a Claim or business baseline: the run stops at `WAITING_REVIEW` with candidates, conflicts, and open questions until the separate authorized review flow records an outcome.

For long-running work, send `Prefer: respond-async` or `?async=true`. Poll the same run URL; cancel with `POST .../cancel`, or resume a persisted nonterminal job after process recovery with `POST .../resume`. Job state is append-only in PostgreSQL. The repository does not claim that this single-process worker is a distributed lease coordinator; multi-instance ownership and queue infrastructure remain deployment integrations.

Review one candidate with `POST /v1/projects/{projectId}/reverse-runs/{runId}/candidates/{candidateId}/reviews`, then read its governed baseline and server-derived proof chain from `GET /v1/projects/{projectId}/features/{featureId}` and `GET /v1/projects/{projectId}/features/{featureId}/traceability?snapshotManifestId=...`. The compatibility `/baseline` route exposes the same governed baseline. Snapshot-bound conflict and chain collections are available at `/features/{featureId}/conflicts` and `/features/{featureId}/trace-chains`; both are projections of the same traceability computation. Authorized product/business reviewers append or read the Feature state machine at `POST/GET /v1/projects/{projectId}/features/{featureId}/process-model`. Explore the same data through `GET /v1/projects/{projectId}/features/{featureId}/graph?snapshotManifestId=...&view=business` and the bounded path-query endpoint. Compare two manifests with `POST /v1/projects/{projectId}/change-sets`; the immutable impact record is available at `GET /v1/projects/{projectId}/change-sets/{changeSetId}/impact`.

Create a high-risk or emergency authority proposal with `POST /v1/projects/{projectId}/decision-review-cases`, append independent approval/lifecycle events at `POST /v1/projects/{projectId}/decision-review-cases/{caseId}/events`, and inspect the current replayed status at `GET /v1/projects/{projectId}/decision-review-cases/{caseId}`. No Decision is published until the configured role and separation rule is satisfied.

Derive its incremental regression and policy-controlled CI result from `GET /v1/projects/{projectId}/change-sets/{changeSetId}/continuous-protection`. This endpoint never turns incomplete impact into a pass and never replaces the individual Feature trust dimensions with one composite score.

Read the current Snapshot's product-effectiveness view from `GET /v1/projects/{projectId}/metrics/product-effectiveness?snapshotManifestId=...`. The response intentionally has no composite score.

Govern Evidence retention with `POST /v1/projects/{projectId}/evidence-retention-policies`, append archive/Legal Hold/deletion/access events at `POST /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle-events`, and read the replayed state from `GET .../lifecycle?policyId=...`. A `DELETED` event proves deletion of external raw content; it never removes the immutable hash and audit proof. The adopting enterprise still supplies encrypted object storage and executes the physical object operation.

After a changed implementation is analyzed in a new Reverse Run, an authorized developer or architect can repair the stale implementation segment with `POST /v1/projects/{projectId}/features/{featureId}/claims/{claimId}/implementation-reanalyses`. This creates a new Snapshot-bound mapping and conformance record for the existing Claim and Scope; it never edits or replaces the normative Decision.

The detailed design is in [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md). The current repository acceptance result and the explicit external-pilot boundary are recorded in [docs/implementation/mvp-acceptance-audit-2026-07-14.md](docs/implementation/mvp-acceptance-audit-2026-07-14.md); production startup and bootstrap are covered by [docs/implementation/production-runtime-validation-2026-07-14.md](docs/implementation/production-runtime-validation-2026-07-14.md). See the [documentation index and bilingual maintenance policy](docs/README.md) for the complete convention.
