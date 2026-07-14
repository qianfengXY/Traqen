# Fact scanner validation — 2026-07-14

## Scope and result

This report validates the deterministic fact-foundation slice against Traqen itself:

```bash
npm run scan:self
```

The current scan covers 111 artifacts and produces 1,179 locatable nodes and 3,222 relations. Every emitted node contains a source artifact, positive line range, and SHA-256 content hash. The bundle is deliberately `complete: false` because six TypeScript/TSX product files are outside this Scanner version's declared JavaScript capability; each is reported as an explicit error diagnostic instead of being silently skipped.

| Node type | Count |
| --- | ---: |
| Artifact | 111 |
| Module | 1 |
| CodeSymbol | 601 |
| Endpoint | 34 |
| DataObject | 363 |
| Configuration | 22 |
| ExternalDependency | 22 |
| TestAsset | 25 |

| Predicate | Count |
| --- | ---: |
| CONTAINS | 2,404 |
| DEPENDS_ON | 227 |
| CALLS | 407 |
| IMPLEMENTED_BY | 1 |
| READS | 57 |
| WRITES | 69 |
| CONTROLLED_BY | 15 |
| EXERCISES | 42 |

The exact bundle ID and source digest are intentionally not treated as permanent report identifiers: both change when eligible source files change. `npm run scan:self` is the reproducible current result.

## Deterministic spot checks

The following samples were checked against their source locations:

- OpenAPI extraction found `GET /health` and `GET /v1/projects/{projectId}/facts` in `contracts/openapi.json`.
- SQL extraction found the `audit_event` table and its columns in `db/migrations/0001_core_traceability.sql`, including exact declaration lines.
- environment extraction found production PostgreSQL, API-token, CORS, Runner, Scanner, Skill-publisher, and reviewer configuration references without recording their runtime values.
- JavaScript AST extraction found `createTraceabilityHttpHandler`, `createTraceabilityHttpServer`, and their internal call relationships.
- literal SQL analysis found read/write relations in the PostgreSQL store and migration tests.
- static named imports connected test assets to imported code symbols; unresolved or side-effect imports stop at the target artifact and are marked with the import basis instead of claiming symbol-level execution.

Automated tests also exercise an Express-style route and verify `Endpoint IMPLEMENTED_BY CodeSymbol`, `CodeSymbol CALLS CodeSymbol`, `CodeSymbol READS DataObject`, and `TestAsset EXERCISES CodeSymbol` relations.

## Integrity and query boundary

- Fact entities have stable project/type/natural-key IDs; their fact records remain Snapshot Manifest-specific.
- bundles are canonicalized and HMAC-SHA256 attested by a named Scanner; the Scanner exposes the same deterministic repository fingerprint used for the Source component digest.
- ingestion rejects an unknown Scanner, invalid signature, project mismatch, missing Snapshot Manifest, Source component ID mismatch, or Source SHA-256 digest mismatch. A bundle cannot merely name a Source Snapshot while carrying facts from different source bytes.
- Fact Bundles, nodes, and edges are append-only in PostgreSQL; update and delete triggers reject mutation.
- fact queries are parameterized, capped at 500 matching nodes, and return bounded one-hop neighbors with explicit truncation flags.
- oversized eligible files and unsupported source or OpenAPI formats produce `ERROR` diagnostics and force `complete: false` rather than silently implying full coverage.

## Declared capability boundary

This Scanner version covers JavaScript ES modules/CommonJS, package metadata, Express-style literal routes, OpenAPI JSON, PostgreSQL `CREATE TABLE` DDL, literal SQL passed to `query`, `.env`/YAML/properties top-level keys, and Node-style test assets.

It does not yet claim semantic coverage for TypeScript/JSX or other languages, OpenAPI YAML, dynamically constructed routes/SQL/configuration keys, framework dependency injection, runtime-only calls, branch reachability, database views/indexes/triggers, or actual test coverage. Encountered unsupported source languages and OpenAPI YAML make the bundle incomplete. Dynamic constructs that remain valid JavaScript are not converted into facts unless their value is statically unambiguous; absence of a relation is therefore not evidence that the relation does not exist.
