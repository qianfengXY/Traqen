# Production runtime validation — 2026-07-14

## Outcome

Traqen now has a PostgreSQL-backed production API process rather than only a local in-memory development server. Startup performs the complete repository-controlled sequence:

```text
validate production configuration
→ connect one pinned PostgreSQL client
→ verify checksums and apply pending migrations
→ construct the shared traceability application
→ require a global API token on every non-health route
→ serve the REST API
→ drain HTTP and close PostgreSQL on SIGINT/SIGTERM
```

The single-client database adapter is intentional: the store's explicit `BEGIN`/`COMMIT`/`ROLLBACK` sequences remain on one PostgreSQL session. Connection failure or migration checksum failure prevents the API from serving; migration failure also closes the connection.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | production | PostgreSQL connection string |
| `API_BEARER_TOKEN` | production | global API credential |
| `POSTGRES_SSL` | no | `require` (default), `no-verify`, or `disable` |
| `HOST`, `PORT` | no | listen address; defaults to `0.0.0.0:3000` |
| `CORS_ALLOWED_ORIGINS` | browser use | comma-separated exact origins |
| `RUNNER_ID`, `RUNNER_SHARED_SECRET` | Evidence ingestion | trusted local MVP Runner identity |
| `SCANNER_ID`, `SCANNER_SHARED_SECRET` | Fact ingestion | trusted local MVP Scanner identity |
| `SKILL_PUBLISHER`, `SKILL_PUBLISHER_SHARED_SECRET` | Skill registration | trusted local MVP publisher identity |
| `REVIEWER_ID`, `REVIEWER_ROLE`, `REVIEWER_BEARER_TOKEN` | business review | fail-closed reviewer identity/policy |
| `IMPLEMENTATION_REVIEWER_ID`, `IMPLEMENTATION_REVIEWER_ROLE`, `IMPLEMENTATION_REVIEWER_BEARER_TOKEN` | reanalysis | fail-closed implementation reviewer identity/policy |
| `QUALITY_GATE_MODE` | no | `ADVISORY` (default), `MANUAL_APPROVAL`, or `ENFORCED` |
| `HIGH_RISK_FEATURE_IDS`, `FIXED_HIGH_RISK_TEST_SPEC_IDS` | no | comma-separated fixed high-risk regression policy |
| `CONSERVATIVE_REGRESSION_TEST_SPEC_IDS` | no | comma-separated fallback set used when impact is incomplete |
| `HIGH_VALUE_FEATURE_IDS` | no | comma-separated north-star Feature population; defaults to all governed Features |

The global token may be sent as `Authorization: Bearer ...` or `x-traqen-api-token`. The second form exists so reviewer endpoints can independently use `Authorization` for the narrower reviewer credential. Token comparison is constant-time. `GET /health` and CORS preflight remain public; every other route is protected in production.

## API-only bootstrap

Operators do not insert foundation rows manually:

1. `POST /v1/projects` creates the Organization, Tenant, Project, and tenant Principals in one idempotent transaction.
2. `GET /v1/projects/{projectId}` returns the derived boundary.
3. `POST /v1/projects/{projectId}/snapshots` validates component SHA-256 digests, recomputes completeness and content identity server-side, and appends the immutable Snapshot.

An identical bootstrap is idempotent. Reusing an ID with different immutable content returns a conflict and rolls back the whole transaction. Normalized Snapshot manifests can be re-registered without losing their components or changing their content ID.

## Verification

- PostgreSQL integration tests start from migrations only, create a Project through the application, register a complete Snapshot, query the resulting rows, repeat the same request idempotently, and reject a conflicting foundation.
- HTTP integration tests prove project/Snapshot bootstrap with only API calls and prove that production authentication protects every non-health route.
- Database adapter tests prove connection options, query/exec delegation, idempotent close, and refusal to operate after close.
- OpenAPI 3.1 documents both global token forms and the three bootstrap routes.

## Deliberate enterprise boundary

The runtime is deployable, but the repository does not pretend HMAC secrets and one static API token equal enterprise identity. Production hardening still requires the adopting organization to provide secret/KMS integration, certificate-based workload identity and mTLS, enterprise SSO/ABAC, durable task leasing, backup/restore, external Evidence object storage and retention policy, and its normal ingress/observability controls.
