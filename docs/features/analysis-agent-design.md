> Language: **English** · [简体中文](analysis-agent-design.zh-CN.md)

# Analysis Agent design

## Product role

The Analysis Agent is Traqen's core source-understanding capability and the successor to a flat scanner. It turns immutable, locatable source Facts into two current projections: user-recognizable business capabilities and API interfaces. Its output feeds Feature traceability, configuration and test linkage, impact analysis, review, and later automated test agents. It proposes evidence-backed candidates; it never creates business authority.

## Non-negotiable invariants

1. Freeze one Source Snapshot, then run deterministic extraction and source-analysis Skills independently. Scanner candidates cannot become a Skill's input answers or decide which capabilities the Skill is allowed to see; the lanes meet only during reconciliation.
2. Context is bounded per WorkUnit. A repository can contain 100,000 or more files without placing the whole project into one model context.
3. A checkpoint is persisted after every server WorkUnit. The local browser workflow checkpoints bounded file batches and can reuse them after the same directory is selected again.
4. The first run is full. Later `AUTO` runs use the latest completed result as the incremental baseline; callers can also explicitly request `FULL` or `INCREMENTAL`.
5. Analysis may suggest Candidate lineage by exact candidate key, stable evidence overlap, or semantic-name similarity. It never allocates, matches, or inherits a governed Feature identity.
6. Candidate lineage and change classification are advisory metadata with `identityDecision: NOT_MADE`. Only an explicit governance Decision can create or associate an opaque `Feature.id` and business authority.
7. The current Candidate tree contains only current observations. A missing observation becomes `candidateAbsences[].NO_CURRENT_OBSERVATION`; it is not a Feature retirement event.
8. Model credentials are resolved from server environment references or encrypted at rest in the device-local Traqen profile store. They are never returned by the API or persisted in a run, result, prompt record, Workspace, or browser database.
9. Extractor output is an observation, not truth. Every candidate carries its extractor, basis, source range, corroborations, contradictions, diagnostics, completeness, and a confidence cap. The model cannot raise confidence above that evidence cap, and only a governed human review can create business authority.

## Pipeline

`Source snapshot → [deterministic Fact extraction || direct-source Skills] → WorkUnit-bound CandidateBundle → deterministic evidence validation → Candidate lineage suggestion → read-only Candidate projections`

The Main Agent's task map comes only from a scanner-independent Source Manifest: paths, modules, languages, file sizes, dependency manifests, and the incremental change set. Planning Skills from scanner-discovered “features” would turn every scanner miss into an Agent blind spot. The deterministic scanner, ECC-class repository-understanding Skills, and Specone-class specification-reverse Skills start independently from the same Snapshot. The Main Agent then labels their relationship as `CORROBORATED`, `SCANNER_ONLY`, `SKILL_ONLY`, `CONFLICT`, or `INSUFFICIENT_EVIDENCE`.

A direct-source Skill does not receive arbitrary filesystem access. Traqen first supplies a bounded Source Manifest; the Skill requests specific `SourceSlice` objects through a controlled read protocol. Every slice is path/line locatable, budgeted, and Snapshot-bound. This lets a Skill discover code the scanner missed without placing 100,000 files in one context. Two Skills backed by the same model or prompt family are correlated sources, not independent corroboration, and that relationship remains explicit in provenance.

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

The built-in `specone-reference` and `gsd-reference` adapters only exercise the common protocol and still consume deterministic Fact packages. They are not external Specone/GSD integrations and do not count as independent source analysis. Real ECC, Specone, or other repository-analysis capabilities must be registered as signed, version-pinned external Skill/Agent Runtime adapters with declared source-read, model, network, and incremental capabilities. When an adapter is unavailable or unauthorized, the UI reports `NOT_CONFIGURED`; it must not pretend that a fallback executed that Skill. All outputs remain provenance-bearing candidate knowledge, never Claims or confirmations.

## Incremental Candidate behavior

The result stores semantic fingerprints for nodes and relations. An incremental run plans only WorkUnits whose bounded neighborhoods intersect changed Facts; unchanged Candidate observations are carried forward into a new immutable Candidate for the new run. Candidate reconciliation records one of:

- `NEW`
- `BUSINESS_SEMANTICS_CHANGED`
- `IMPLEMENTATION_REMAPPED`
- `EVIDENCE_REFRESHED`
- `UNCHANGED`

Each run creates new Candidate IDs and may retain a non-authoritative `previousCandidateId` suggestion. All matches are `SUGGESTED`, `governedFeatureId` remains null, and no authority is copied from the governed Feature store. Candidates not observed in the current run are listed under `candidateAbsences` as `NO_CURRENT_OBSERVATION`; this never means a Feature was retired.

## Persistence and API

PostgreSQL stores mutable run checkpoints separately from immutable completed results. The public API is:

- `POST /v1/projects/{projectId}/analysis-runs` — asynchronous by default; `?async=false` waits for bounded completion.
- `GET /v1/projects/{projectId}/analysis-runs/{analysisRunId}`
- `POST .../{analysisRunId}/pause`
- `POST .../{analysisRunId}/resume`
- `GET /v1/projects/{projectId}/analysis-results/latest`
- `GET /v1/projects/{projectId}/analysis-candidates/{candidateId}/history`
- `GET/POST /v1/analysis-model-profiles` — list secret-free profiles or configure a runtime profile.
- `POST /v1/analysis-model-profiles/{profileId}/verify`
- `POST /v1/analysis-model-profiles/{profileId}/select` — select one verified profile as the current model.
- `DELETE /v1/analysis-model-profiles/{profileId}` — remove a persisted runtime profile; environment profiles remain deployment-managed.
- `POST /v1/analysis-model-profiles/{profileId}/workspace-enrichment` — accept at most 24 evidence-assessed candidates per bounded model batch. `Accept: application/x-ndjson` streams secret-free interaction telemetry followed by the validated result.
- `POST /v1/analysis-model-profiles/{profileId}/workspace-plan` — ask the Main Agent model for one public plan and exactly three child-Agent assignments; NDJSON streams the public message before the validated plan.

Every run is bound to one project, Snapshot Manifest, and Source component. The application refuses analysis without a deterministic Fact graph or with a mismatched Source component.

## Local Workspace experience

The browser requires a verified model profile before starting a new Workspace analysis. It performs bounded local extraction, labels the actual extractor basis, calculates an evidence assessment, then sends candidate names, paths, descriptions, necessary code excerpts, independent corroborations, diagnostics, completeness, and a confidence cap through the Traqen API. The API contract accepts at most 24 candidates, while the local orchestrator defaults to 10 and also splits by serialized size. If a provider reports `length`, `max_tokens`, or another incomplete-output condition, the client treats it as truncation and recursively bisects the bounded batch up to a fixed retry depth; it never repairs missing JSON by inventing fields. If the smallest atomic unit still lacks a complete valid object or array, the orchestrator emits `BATCH_SKIPPED`, retains its deterministic evidence without a model classification, records the unit as pending, and continues the Workspace run. This is a partial-evidence outcome, not a successful model conclusion and not a run-level failure. A checkpoint is stored after every completed or explicitly skipped model work unit. On an incremental run, unchanged candidates already classified by the same profile do not consume another model call; pending candidates remain eligible for a later retry. Raw project files are not persisted; IndexedDB contains extracted candidate records, necessary code/test excerpts, redacted configuration clues, active checkpoints, and compact history summaries.

Model classifications carry an evidence-policy version. When confidence or validation rules change, older classifications are re-enriched even if the source file and model profile are unchanged; legacy results cannot silently bypass the current evidence policy.

A Workspace project identity and its first analysis are separate stages. The user creates and persists the project record before selecting a directory and starting the first full analysis; directory selection no longer creates or renames a project implicitly. While the current project is analyzing, creating another project adds only its lightweight record and does not switch the active context. Operations that would change context—opening another project or hiding the active project—remain unavailable until the task completes or pauses.

The analysis surface is a real bounded Agent session rather than a relabeled sequential log. A streaming Main Agent conversation sits above exactly three child-Agent windows. All four windows have a fixed visible height and scroll internally, so long runs never grow the page without bound. The Workspace analysis surface remains mounted while the user visits traceability, graph, review, impact, or metrics pages, preserving the active task, transcripts, elapsed time, and progress. After a page reload, pause, or process failure, the latest IndexedDB checkpoint is restored as a resumable session. Once deterministic extraction is complete, “Continue analysis” restores the saved Snapshot and unfinished model WorkUnits without traversing the source directory again. Matching records and completed classifications are reused only under the same evidence policy and model profile. Every checkpoint produces a progressive Candidate-tree projection; IndexedDB is a cache/checkpoint, not truth. Project snapshots and active checkpoints persist their current projection separately from bulk scanner records. Public messages expose goals, bounded inputs, evidence, uncertainty, checkpoint state, and next actions without rendering raw model JSON or private chain-of-thought. The three browser queues are bounded semantic-analysis workers partitioned from one Source Manifest; optional external analysis sources remain labelled unavailable until genuinely configured.

The visible Candidate tree is a Main-Agent reconciliation projection, not a scanner-symbol browser or governed Feature tree. After every child WorkUnit returns, deterministic code validates its CandidateBundle, classifies each bounded conclusion for a business/API Candidate projection, checkpoints, and refreshes both trees. Evidence validation never means business confirmation. An evidence-validated endpoint Candidate may appear in both projections when it describes a user-recognizable behavior; its node type remains `CANDIDATE_FEATURE` and `governedFeatureId` remains null. A deterministic endpoint with no child response can appear only as a low-confidence provisional API Candidate. Candidate taxonomy uses **business module → business submodule → user-recognizable behavior** labels; source folders, packages, classes, frameworks, and raw symbols cannot become hierarchy labels. Multiple observations may be grouped by a validated business matching key while retaining all evidence, but that key is never a Feature ID.

Every child slot has a generation and a context-character safety budget. At 70% of the configured local budget, the worker stops claiming new work after its current atomic unit, saves a compact handoff/checkpoint, retires that generation, and starts the next generation in the same visual slot. Completed work units retain their model classification and are not repeated. This local orchestration is native Traqen behavior; Claude Code or Codex CLI can later be added behind the same runtime/event boundary but are not required to obtain the interaction model.

Low-level transport telemetry remains available behind a default-off **Technical diagnostics** control. It can show request identifiers, input/output size, gateway timing, stream progress, bounded prompt/evidence previews, structured-output previews, provider token usage when available, and validation data. This diagnostic view is not the primary experience. API keys, authorization headers, and private model chain-of-thought are never exposed.

Multiple projects can remain stored while only selected projects appear in the sidebar. Removing a Workspace from display is non-destructive: its lightweight summary remains available in Workspace visibility management, but its source index, Candidate tree, and traceability snapshot are not loaded. Re-enabling it restores on-demand access without rescanning.

The Candidate tree has two projections. Business mode suppresses endpoints, commands, repositories, adapters, interfaces, utilities, configuration code, and other technical support symbols. API mode shows endpoint clues and matched handler/call implementation blocks. Both projections come from the same latest Workspace analysis and neither carries governed Feature authority.

## Deliberate boundaries

The Agent does not approve Claims, execute tests, or turn an LLM statement into business truth. The browser orchestrates hybrid progress, but all model calls and credentials remain behind the authenticated Traqen API. Model names, business grouping, confidence, and rationale remain candidate metadata until governed human confirmation. Multi-instance worker leasing and a distributed queue remain deployment infrastructure concerns. OpenAPI YAML and additional deterministic language AST adapters remain explicit future extensions rather than silently incomplete analysis.
