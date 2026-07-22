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
8. Model credentials are resolved from server environment references or encrypted at rest in the device-local Traqen profile store. They are never returned by the API or persisted in a run, result, prompt record, Workspace, or browser database.
9. Extractor output is an observation, not truth. Every candidate carries its extractor, basis, source range, corroborations, contradictions, diagnostics, completeness, and a confidence cap. The model cannot raise confidence above that evidence cap, and only a governed human review can create business authority.

## Pipeline

`Source snapshot → deterministic Fact graph → bounded WorkUnits → deterministic candidates → optional model/Skills → evidence validation → stable Feature reconciliation → current result + immutable history`

The server-side deterministic scanner currently extracts JavaScript/Node and Java source. Java uses a Tree-sitter-compatible AST through ast-grep and recognizes Spring and JAX-RS endpoints, controller/service/repository roles, methods, DTO/entity types, security and validation annotations, method calls, and configuration references. JavaScript extraction preserves routes, symbols, guards, state changes, SQL relations, configuration, and tests. Both produce the same language-neutral Fact contract. The browser directory workflow is a separate lightweight path: its current Java and multi-language discovery includes declaration patterns and must identify them as heuristic rather than claiming AST verification.

AST validity is never inferred from “the parser returned a node.” Traqen records parser diagnostics and source locations, then looks for independent observations such as an OpenAPI operation, handler implementation, call edge, configuration reference, and related test. A single heuristic observation is capped at `LOW`; independent evidence kinds may raise the cap to `MEDIUM` or `HIGH`. Contradictions or incomplete parsing stay visible and keep the candidate pending. The LLM receives this evidence assessment and must preserve uncertainties; output validation rejects missing IDs, invented IDs, malformed fields, and confidence above the cap.

WorkUnit roots are endpoints and meaningful business implementation roots. Breadth-first graph neighborhoods are capped by the configured input-token budget and depth. The Agent reserves at least 20% of the configured model context window and rejects profiles that exceed that boundary.

## Analysis modes

- `DETERMINISTIC`: no external model call. Suitable for private/offline use and reproducible baselines.
- `HYBRID`: runs deterministic analysis first, then a configured OpenAI-compatible model and optional registered Skills. Extensions may refine grouping and descriptions, but cannot cite evidence or stable nodes outside their WorkUnit.

Profiles can be configured before analysis from the global **Configure model** panel. The user can add multiple profiles, edit them without re-entering an unchanged key, delete runtime profiles, and select one verified profile as the current analysis model. Traqen sends a live structured-output verification request before marking a profile ready. Stream profiles send `stream: true`, merge bounded text deltas on the server, and apply the same final JSON and evidence validation as non-streaming responses. Runtime profiles are encrypted with AES-256-GCM under the device-local Traqen configuration directory; the encryption key is stored separately with owner-only file permissions. `ANALYSIS_MODEL_STORE_PATH` can override the encrypted store location.

For managed deployments, `ANALYSIS_MODEL_PROFILES_JSON` configures server-side profiles. Each entry contains `id`, HTTPS `endpoint` (HTTP is accepted only for loopback), `model`, optional `timeoutMs`, optional `stream`, and `apiKeyEnvironment`. The named environment variable holds the secret.

Example:

```json
[
  {
    "id": "private-model",
    "endpoint": "https://model-gateway.example/v1/chat/completions",
    "model": "source-analysis-model",
    "timeoutMs": 120000,
    "stream": true,
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
- `GET/POST /v1/analysis-model-profiles` — list secret-free profiles or configure a runtime profile.
- `POST /v1/analysis-model-profiles/{profileId}/verify`
- `POST /v1/analysis-model-profiles/{profileId}/select` — select one verified profile as the current model.
- `DELETE /v1/analysis-model-profiles/{profileId}` — remove a persisted runtime profile; environment profiles remain deployment-managed.
- `POST /v1/analysis-model-profiles/{profileId}/workspace-enrichment` — accept at most 24 evidence-assessed candidates per bounded model batch. `Accept: application/x-ndjson` streams secret-free interaction telemetry followed by the validated result.

Every run is bound to one project, Snapshot Manifest, and Source component. The application refuses analysis without a deterministic Fact graph or with a mismatched Source component.

## Local Workspace experience

The browser requires a verified model profile before starting a new Workspace analysis. It performs bounded local extraction, labels the actual extractor basis, calculates an evidence assessment, then sends candidate names, paths, descriptions, necessary code excerpts, independent corroborations, diagnostics, completeness, and a confidence cap through the Traqen API. Batches contain at most 24 candidates and are also split by serialized size. A checkpoint is stored after every model batch. On an incremental run, unchanged candidates already classified by the same profile do not consume another model call. Raw project files are not persisted; IndexedDB contains extracted candidate records, necessary code/test excerpts, redacted configuration clues, active checkpoints, and compact history summaries.

Model classifications carry an evidence-policy version. When confidence or validation rules change, older classifications are re-enriched even if the source file and model profile are unchanged; legacy results cannot silently bypass the current evidence policy.

The analysis task console presents the plan before execution and then reports the active profile, transport strategy, current phase, file and model-batch counters, overall weighted progress, elapsed time, checkpoints, validation summaries, completion, pause, or failure events. For every LLM call it streams a request ID, endpoint, prompt/evidence preview, input size, gateway status and time to first byte, response chunk and character progress, structured output preview, provider token usage when available, validation outcome, and call duration. Prompts and structured answers are expandable. API keys, authorization headers, and private model chain-of-thought are never exposed.

Multiple projects can remain stored while only selected projects appear in the sidebar. Removing a Workspace from display is non-destructive: its lightweight summary remains available in Workspace visibility management, but its source index, Feature tree, and traceability snapshot are not loaded. Re-enabling it restores on-demand access without rescanning.

The Feature tree has two projections. Pure business mode suppresses endpoints, commands, repositories, adapters, interfaces, utilities, configuration code, and other technical support symbols. API mode shows endpoint design data and matched handler/call implementation blocks. Both projections come from the same latest Workspace analysis.

## Deliberate boundaries

The Agent does not approve Claims, execute tests, or turn an LLM statement into business truth. The browser orchestrates hybrid progress, but all model calls and credentials remain behind the authenticated Traqen API. Model names, business grouping, confidence, and rationale remain candidate metadata until governed human confirmation. Multi-instance worker leasing and a distributed queue remain deployment infrastructure concerns. OpenAPI YAML and additional deterministic language AST adapters remain explicit future extensions rather than silently incomplete analysis.
