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

It intentionally has no web framework, database driver, LLM, or scanner dependency yet. Those integrations will be added around this kernel after the first platform and scanner technology choices are confirmed.

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
1
