# Fact scanner validation — 2026-07-14

## Scope and result

This report validates the deterministic fact-foundation slice against Traqen itself. The command below completed without diagnostics:

```bash
npm run scan:self
```

The scan covered 59 eligible artifacts and produced 645 locatable nodes and 1,740 relations. Every node contained a source artifact, positive line range, and SHA-256 content hash.

| Node type | Count |
| --- | ---: |
| Artifact | 59 |
| Module | 1 |
| CodeSymbol | 319 |
| Endpoint | 17 |
| DataObject | 208 |
| Configuration | 13 |
| ExternalDependency | 15 |
| TestAsset | 13 |

| Predicate | Count |
| --- | ---: |
| CONTAINS | 1,292 |
| DEPENDS_ON | 124 |
| CALLS | 223 |
| READS | 27 |
| WRITES | 39 |
| CONTROLLED_BY | 9 |
| EXERCISES | 26 |

The exact bundle ID and source digest are intentionally not treated as permanent report identifiers: both change when eligible source files change. `npm run scan:self` is the reproducible current result.

## Deterministic spot checks

The following samples were checked against their source locations:

- OpenAPI extraction found `GET /health` and `GET /v1/projects/{projectId}/facts` in `contracts/openapi.json`.
- SQL extraction found the `audit_event` table and its columns in `db/migrations/0001_core_traceability.sql`, including exact declaration lines.
- environment extraction found `HOST`, `PORT`, Runner credentials, and Scanner credentials in `src/api/dev-server.js` without recording their runtime values.
- JavaScript AST extraction found `createTraceabilityHttpHandler`, `createTraceabilityHttpServer`, and their internal call relationships.
- literal SQL analysis found read/write relations in the PostgreSQL store and migration tests.
- static named imports connected test assets to imported code symbols; unresolved or side-effect imports stop at the target artifact and are marked with the import basis instead of claiming symbol-level execution.

Automated tests also exercise an Express-style route and verify `Endpoint IMPLEMENTED_BY CodeSymbol`, `CodeSymbol CALLS CodeSymbol`, `CodeSymbol READS DataObject`, and `TestAsset EXERCISES CodeSymbol` relations.

## Integrity and query boundary

- Fact entities have stable project/type/natural-key IDs; their fact records remain Snapshot Manifest-specific.
- bundles are canonicalized and HMAC-SHA256 attested by a named Scanner.
- ingestion rejects an unknown Scanner, invalid signature, project mismatch, missing Snapshot Manifest, or a Source Snapshot that is not a member of that manifest.
- Fact Bundles, nodes, and edges are append-only in PostgreSQL; update and delete triggers reject mutation.
- fact queries are parameterized, capped at 500 matching nodes, and return bounded one-hop neighbors with explicit truncation flags.
- oversized eligible files and unsupported source or OpenAPI formats produce `ERROR` diagnostics and force `complete: false` rather than silently implying full coverage.

## Declared capability boundary

This Scanner version covers JavaScript ES modules/CommonJS, package metadata, Express-style literal routes, OpenAPI JSON, PostgreSQL `CREATE TABLE` DDL, literal SQL passed to `query`, `.env`/YAML/properties top-level keys, and Node-style test assets.

It does not yet claim semantic coverage for TypeScript/JSX or other languages, OpenAPI YAML, dynamically constructed routes/SQL/configuration keys, framework dependency injection, runtime-only calls, branch reachability, database views/indexes/triggers, or actual test coverage. Encountered unsupported source languages and OpenAPI YAML make the bundle incomplete. Dynamic constructs that remain valid JavaScript are not converted into facts unless their value is statically unambiguous; absence of a relation is therefore not evidence that the relation does not exist.
