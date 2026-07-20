> Language: **English** · [简体中文](analysis-agent-design.zh-CN.md)

# Analysis Agent design

## Product role

The Analysis Agent is Traqen's core source-understanding capability and the successor to a flat scanner. It turns immutable, locatable source Facts into two current projections: user-recognizable business capabilities and API interfaces. Its output feeds Feature traceability, configuration and test linkage, impact analysis, review, and later automated test agents. It proposes evidence-backed candidates; it never creates business authority.

## Non-negotiable invariants

1. Deterministic extraction precedes semantic inference. Every model or Skill conclusion cites Facts from one bounded WorkUnit.
2. Context is bounded per WorkUnit. A repository can contain 100,000 or more files without placing the whole project into one model context.
3. A checkpoint is persisted after every server WorkUnit. The local browser workflow checkpoints bounded file batches and can reuse them after the same directory is selected again.
4. The first run is full. Later `AUTO` runs use the latest completed result as the incremental baseline; callers can also explicitly request `FULL` or `INCREMENTAL`.
5. Feature identity is matched by exact candidate key, then stable evidence overlap and semantic-name similarity. A near-full rescan does not by itself invalidate human confirmation.
6. Business semantic changes require review. Implementation remapping and evidence refresh preserve inherited business authority while remaining visible as distinct change types.
7. The current Feature tree contains only the latest current Features. Removed implementations become immutable retirement/history events and do not remain in the current tree.
8. Model credentials are resolved from server environment references and are never persisted in a run, result, prompt record, or browser database.

## Pipeline

`Source snapshot → deterministic Fact graph → bounded WorkUnits → deterministic candidates → optional model/Skills → evidence validation → stable Feature reconciliation → current result + immutable history`

The deterministic scanner currently extracts JavaScript/Node and Java source. Java uses a Tree-sitter-compatible AST through ast-grep and recognizes Spring and JAX-RS endpoints, controller/service/repository roles, methods, DTO/entity types, security and validation annotations, method calls, and configuration references. JavaScript extraction preserves routes, symbols, guards, state changes, SQL relations, configuration, and tests. Both produce the same language-neutral Fact contract.

WorkUnit roots are endpoints and meaningful business implementation roots. Breadth-first graph neighborhoods are capped by the configured input-token budget and depth. The Agent reserves at least 20% of the configured model context window and rejects profiles that exceed that boundary.

## Analysis modes

- `DETERMINISTIC`: no external model call. Suitable for private/offline use and reproducible baselines.
- `HYBRID`: runs deterministic analysis first, then a configured OpenAI-compatible model and optional registered Skills. Extensions may refine grouping and descriptions, but cannot cite evidence or stable nodes outside their WorkUnit.

`ANALYSIS_MODEL_PROFILES_JSON` configures server-side profiles. Each entry contains `id`, HTTPS `endpoint` (HTTP is accepted only for loopback), `model`, optional `timeoutMs`, and `apiKeyEnvironment`. The named environment variable holds the secret.

Example:

```json
[
  {
    "id": "private-model",
    "endpoint": "https://model-gateway.example/v1/chat/completions",
    "model": "source-analysis-model",
    "timeoutMs": 120000,
    "apiKeyEnvironment": "PRIVATE_MODEL_API_KEY"
  }
]
```

The built-in Specone- and GSD-compatible reference adapters can be selected as bounded Analysis Skills. Their output remains provenance-bearing candidate knowledge, not a Claim or confirmation.

## Incremental and authority behavior

The result stores semantic fingerprints for nodes and relations. An incremental run plans only WorkUnits whose bounded neighborhoods intersect changed Facts; unchanged candidates are carried forward. Current Features receive one of:

- `NEW`
- `BUSINESS_SEMANTICS_CHANGED`
- `IMPLEMENTATION_REMAPPED`
- `EVIDENCE_REFRESHED`
- `UNCHANGED`

Features with no current implementation are emitted under `retiredFeatures` as `NO_CURRENT_IMPLEMENTATION`. Confirmed authority is inherited across stable matches. A business-semantic change sets `authority.review` to `REQUIRED`; implementation or evidence-only changes do not silently force all previously confirmed Features back through review.

## Persistence and API

PostgreSQL stores mutable run checkpoints separately from immutable completed results. The public API is:

- `POST /v1/projects/{projectId}/analysis-runs` — asynchronous by default; `?async=false` waits for bounded completion.
- `GET /v1/projects/{projectId}/analysis-runs/{analysisRunId}`
- `POST .../{analysisRunId}/pause`
- `POST .../{analysisRunId}/resume`
- `GET /v1/projects/{projectId}/analysis-results/latest`
- `GET /v1/projects/{projectId}/features/{featureId}/analysis-history`

Every run is bound to one project, Snapshot Manifest, and Source component. The application refuses analysis without a deterministic Fact graph or with a mismatched Source component.

## Local Workspace experience

The browser uses the deterministic profile and keeps multiple projects in IndexedDB. It stores the latest project index, resumable active-run checkpoints, and compact historical result summaries. Raw project source is not persisted; only extracted candidate records, necessary code/test excerpts, and redacted configuration clues are stored.

The Feature tree has two projections. Pure business mode suppresses endpoints, commands, repositories, adapters, interfaces, utilities, configuration code, and other technical support symbols. API mode shows endpoint design data and matched handler/call implementation blocks. Both projections come from the same latest Workspace analysis.

## Deliberate boundaries

The Agent does not approve Claims, execute tests, or turn an LLM statement into business truth. Browser-side hybrid inference is intentionally absent because secrets must not be stored in the browser; hybrid runs use the authenticated server API. Multi-instance worker leasing and a distributed queue remain deployment infrastructure concerns. OpenAPI YAML and additional deterministic language AST adapters remain explicit future extensions rather than silently incomplete analysis.
