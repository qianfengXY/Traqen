# Traqen

Traqen is an enterprise traceable-quality platform for legacy systems that do not have trustworthy product, design, or test assets.

The implementation follows one non-negotiable product vision:

> For every governed high-value feature, show an explainable chain from confirmed business intent to evidence produced against the actual deployment, and expose every missing, stale, conflicting, or failed link.

## Current implementation slice

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
- deterministic candidate and stored-spec validation endpoints;
- separate structural validity and execution eligibility results;
- approval provenance, tenant-bound approvers, and explicit operation safety levels;
- storage rejection for literal secrets, tokens, credentials, and authorization values;
- blocking policy gaps for missing assertions, missing approval, unsafe writes, and missing cleanup;
- latest TestSpec versions in the Feature business baseline.

The development server remains intentionally unauthenticated and in-memory. Validation decides whether a TestSpec is eligible for a future Runner; this slice does not execute requests or manufacture Evidence. Production authentication, runtime PostgreSQL wiring, scanners, and LLM-assisted extraction are not part of this slice.

## Run

Requires Node.js 20 or newer.

```bash
npm test
npm run test:storage
npm run example
npm run api:dev
```

The development API binds to `127.0.0.1:3000` by default. It is intentionally unauthenticated and must not be exposed outside a local development environment.

Evaluate another trace-chain input:

```bash
node src/cli/evaluate-trace-chain.js path/to/input.json
```

The detailed design is in [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md).
