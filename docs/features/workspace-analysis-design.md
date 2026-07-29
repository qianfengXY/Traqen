> Language: **English** · [简体中文](workspace-analysis-design.zh-CN.md)

# Local Workspace analysis and Feature tree

## Vision

A user can define a Workspace, select a source-code directory, analyze it without uploading source, see evidence-backed current capabilities in a Feature tree, and inspect the five-part trace view for each capability. Discovery must never silently promote implementation observations into confirmed business truth. The server-side architecture and authority-preserving incremental rules are defined in the [Analysis Agent design](analysis-agent-design.md).

## Lifecycle status and P0 follow-up

The currently shipped implementation still performs deterministic source scanning inside the browser page and creates the durable server `AnalysisRun` only after that scan has finished. Refreshing or closing the browser during this source-scan phase destroys the active scan executor. The server-owned AnalysisRun change fixed refresh safety only after derived observations were accepted; it did not make source scanning durable.

This is a confirmed product gap, not the intended finish line. The supporting [durable Workspace scan and Analysis lifecycle](workspace-scan-and-analysis-lifecycle.md) defines one user-visible `WorkspaceAnalysisJob` containing two separately checkpointed server phases: `SourceScanRun` and `AnalysisRun`. The broader P0 objective and correctness contract are defined by [F001 legacy-system understanding](F001-legacy-system-understanding.md). Until those requirements are delivered, browser-scanning statements below describe current implementation behavior rather than the target lifecycle.

## User flow

1. Enter a Workspace name and stable Project ID.
2. Select a local code directory through the browser directory chooser.
3. Traqen reads supported text files locally. Raw source is never uploaded or persisted; a bounded derived index is saved in browser IndexedDB.
4. The local deterministic Analysis Agent discovers Spring MVC/WebFlux and JAX-RS endpoints, Java backend components and interface methods, HTTP routes, OpenAPI JSON operations, public/callable JavaScript/TypeScript capabilities, and `package.json` commands.
5. One analysis projects into two exclusive Feature-tree modes. **Business features** suppresses HTTP endpoints, commands, repositories, adapters, interfaces, utilities, and configuration support code. **API endpoints** contains only discovered HTTP/OpenAPI operations and shows protocol, method, path, handler, and matched implementation blocks. Switching modes never reanalyzes or duplicates stored records.
6. Within either mode, results are grouped as Workspace → readable module → business domain or product area → discovery group → candidate Feature. Parent counts always mean descendant Features in the active mode, not direct folders or the unfiltered scan total.
7. Workspace analysis first presents project-wide statistics for the active tree mode. Selecting any Workspace, module, domain/product area, discovery group, or Feature node recalculates the same measures for that node and every descendant.
8. Feature traceability remains the detail surface: selecting a candidate there displays Feature description, design/source, configuration clues, related tests, test results, independent trust dimensions, and TraceGap ownership. Workspace analysis, Feature traceability, and the trace graph share one global tree mode and selection.

## Hierarchical analysis statistics

- Statistics include Feature count, located design/implementation, unique module-relevant or project-global configuration clues, unique related test cases, and execution-result distribution.
- Governance statistics keep pending human confirmation, implementation awaiting review, conflicts, and explicit nonconformance separate.
- Evidence statistics show complete and incomplete chains plus blocking and warning TraceGaps. There is no composite green score.
- `PARTIAL`, `UNKNOWN`, and `NOT_RUN` are missing or unverified states, not nonconformance. The nonconformance count includes only an explicit nonconforming state, failed/error execution, or a corresponding violation gap. Conflicts remain a separate measure.
- The next-level table repeats the measures for each immediate child, allowing the user to drill from Workspace to module, domain/product area, discovery group, and individual Feature without mixing data from another project.

## Workspace lifecycle and navigation

- With no local project, the Workspace route shows only a focused onboarding surface. The analysis form, Agent sessions, Feature tree, and statistics are not mounted until a project identity has been created.
- Workspace creation is a dedicated route-scoped page state opened from the compact `+` control beside the Workspace heading. While it is active, the current project's analysis surface is not mounted; analysis appears only after creation completes or the user cancels. Navigating to any other product view closes creation, so its state cannot leak across pages.
- The left Workspace switcher can create and retain multiple local projects. Selecting a project makes it the active data boundary for every product view.
- The first scan initializes a project; it is not an isolated report owned by the analysis page.
- A later analysis of the same root compares relative path, byte size, last-modified time, and scanner version. Unchanged file records are reused; added or modified supported files are reread; deleted paths are removed before the Feature tree is rebuilt. A scanner upgrade invalidates stale records automatically.
- The browser may checkpoint bounded deterministic source preparation, but it never owns or reports a running AnalysisRun. After derived observations are accepted, the API creates one durable server AnalysisRun. Page mount, refresh, reconnect, and polling issue only read requests; only explicit Pause and Resume actions change lifecycle state. Resume keeps the same run identity and server checkpoint, so completed WorkUnits are neither replanned nor analyzed again.
- The initialized Workspace name, Project ID, Feature tree, selected Feature, selected trace block, and expanded tree nodes are held by the product-level session and survive navigation between product views.
- Feature traceability reuses the initialized Feature tree directly. Selecting any tree item opens that candidate's five-part trace chain without rescanning.
- Workspace analysis remains the initialization and rescan surface. Feature traceability is the primary surface for reviewing candidates one by one.
- The API connection can temporarily show a server-derived Feature. Returning to the self Workspace restores the initialized local tree and selection.
- Feature traceability and the trace graph both use the active project's Feature tree and selected Feature. Neither falls back to another Workspace while a local project is active.
- The Business/API tree mode is global across Workspace analysis, Feature traceability, and the trace graph. Changing it selects the first available candidate only when the previous selection is absent from the new mode.
- Project summaries, derived analysis records, source-preparation checkpoints, server-run subscriptions, and supported directory handles survive a full refresh on the same browser profile. A running server task does not depend on the retained directory handle and continues while the page is absent. Revoked directory permission affects only a later local rescan; it cannot pause or resume an accepted server run.
- The analysis Agent uses the same global theme tokens and responsive desktop layout as the rest of the product. Wide displays use the available content width with compact outer gutters rather than a centered 1920-pixel cap. Main- and child-Agent transcripts scroll inside fixed-height surfaces instead of creating an unbounded terminal-style page.

## Trust boundary

- A discovered item is an implementation candidate, not a normative Feature.
- Authority remains `PENDING` until an authorized human confirms the business description, permissions, prerequisites, dependencies, scope, and exceptions.
- Source-to-Feature conformance remains `PARTIAL` until the mapping is reviewed.
- Related test files are clues, not approved TestSpecs. Association requires an exact test/source basename or callable-symbol match inside the same module; generic word overlap is not coverage evidence.
- Scanning never executes project code. Verification remains `NOT_RUN` until a trusted Runner returns signed Evidence for the selected Snapshot and deployment.
- Missing authority, implementation review, TestSpec, or current execution remains an explicit blocking TraceGap.

## Local safety limits

- Ignore dependency, VCS, build-output, coverage, and vendor directories.
- Process supported files in bounded batches without a project-wide file-count or total-byte ceiling, so repositories with 100,000-scale file counts do not require an artificial rescan boundary.
- Persist only file metadata, discovered Feature indexes, bounded source/test excerpts, and redacted configuration clues instead of retaining the full source tree. The persisted snapshot stores scan records once and rebuilds aggregate analysis when loaded.
- Read individual supported text files only up to 768 KB.
- Expand the Feature tree on demand so unopened modules and discovery groups do not create all leaf elements in the page at once.
- Exclude real `.env` variants, allow only environment templates, and redact secret-like configuration values before display.
- Do not upload source to the hosted Traqen site. Do not persist complete source files, real `.env` values, or unredacted secret-like configuration.

## Current discovery coverage

The scanner recognizes Spring `@RequestMapping` and HTTP method mappings with combined class/method paths; JAX-RS `@Path` and HTTP annotations; Java Controller, Service, Repository, Component, scheduled job, and message/event listener methods; Java interfaces and meaningful public/protected backend methods; Maven/Gradle and application configuration clues; and Java test-source associations. Trivial getters/setters and configuration factory methods are not promoted into Features. Endpoint leaves prefer the Java method, router handler, or OpenAPI summary/operation ID as the readable label while retaining the HTTP method and route as technical detail; anonymous `async` handlers never become a misleading `Async` label. The scanner also recognizes JavaScript/TypeScript exported functions, classes, and callable variables, public Python functions, C# public methods, exported Go functions, Rust public functions, HTTP router registrations, OpenAPI JSON paths, and npm scripts. Plain constants and schemas are not promoted solely because they are exported. Tests, mocks, fixtures, samples, and stories contribute support evidence but do not become Feature candidates. Configuration clues are limited to configuration-shaped files, exclude test fixtures and package manifests, and link conservatively by module/domain proximity. Generated Java `target`, `out`, and Gradle cache directories remain excluded.

Project/runtime commands remain available in the underlying scan inventory and statistics model, but are deliberately absent from both user-facing Feature-tree modes so that engineering operations cannot masquerade as pure business functions or API endpoints.

The real-repository validation against `zts212653/clowder-ai` is recorded in [Clowder AI Workspace scan validation](../implementation/clowder-ai-workspace-analysis-2026-07-18.md). Its thousands of discovered items are implementation candidates, not a claim that the repository contains the same number of confirmed business Features.
