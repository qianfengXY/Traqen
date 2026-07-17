> Language: **English** · [简体中文](workspace-analysis-design.zh-CN.md)

# Local Workspace analysis and Feature tree

## Vision

A user can define a Workspace, select a source-code directory, scan it without uploading source, see every discovered capability in a Feature tree, and inspect the five-part trace view for each capability. Discovery must never silently promote implementation observations into confirmed business truth.

## User flow

1. Enter a Workspace name and stable Project ID.
2. Select a local code directory through the browser directory chooser.
3. Traqen reads supported text files in the current browser tab only. Source and results are not persisted and disappear after a full browser refresh.
4. The local scanner discovers Spring MVC/WebFlux and JAX-RS endpoints, Java backend components and interface methods, HTTP routes, OpenAPI JSON operations, JavaScript/TypeScript exported capabilities, and `package.json` commands.
5. Results are grouped as Workspace → module → discovery type → candidate Feature.
6. Selecting a candidate displays Feature description, design/source, configuration clues, related tests, test results, independent trust dimensions, and TraceGap ownership.

## Workspace lifecycle and navigation

- Scanning initializes the active Workspace; it is not an isolated report owned by the analysis page.
- The initialized Workspace name, Project ID, Feature tree, selected Feature, selected trace block, and expanded tree nodes are held by the product-level session and survive navigation between product views.
- Feature traceability reuses the initialized Feature tree directly. Selecting any tree item opens that candidate's five-part trace chain without rescanning.
- Workspace analysis remains the initialization and rescan surface. Feature traceability is the primary surface for reviewing candidates one by one.
- The API connection can temporarily show a server-derived Feature. Returning to the self Workspace restores the initialized local tree and selection.
- This continuity is intentionally limited to the current browser-page session. A full refresh still clears source-derived data because Traqen does not persist local source or excerpts in browser storage.

## Trust boundary

- A discovered item is an implementation candidate, not a normative Feature.
- Authority remains `PENDING` until an authorized human confirms the business description, permissions, prerequisites, dependencies, scope, and exceptions.
- Source-to-Feature conformance remains `PARTIAL` until the mapping is reviewed.
- Related test files are clues, not approved TestSpecs.
- Scanning never executes project code. Verification remains `NOT_RUN` until a trusted Runner returns signed Evidence for the selected Snapshot and deployment.
- Missing authority, implementation review, TestSpec, or current execution remains an explicit blocking TraceGap.

## Local safety limits

- Ignore dependency, VCS, build-output, coverage, and vendor directories.
- Process supported files in bounded batches without a project-wide file-count or total-byte ceiling, so repositories with 100,000-scale file counts do not require an artificial rescan boundary.
- Retain only discovered Feature indexes, bounded source/test excerpts, and up to 12 redacted configuration clues instead of retaining the full source tree.
- Read individual supported text files only up to 768 KB.
- Expand the Feature tree on demand so unopened modules and discovery groups do not create all leaf elements in the page at once.
- Exclude real `.env` variants, allow only environment templates, and redact secret-like configuration values before display.
- Do not upload source to the hosted Traqen site or write it to browser storage.

## Current discovery coverage

The scanner recognizes Spring `@RequestMapping` and HTTP method mappings with combined class/method paths; JAX-RS `@Path` and HTTP annotations; Java Controller, Service, Repository, Component, scheduled job, and message/event listener methods; Java interfaces and public/protected backend methods; Maven/Gradle and application configuration clues; and Java test-source associations. It also recognizes common JavaScript/TypeScript exports, Python functions, C# public methods, Go functions, Rust public functions, HTTP router registrations, OpenAPI JSON paths, and npm scripts. Generated Java `target`, `out`, and Gradle cache directories remain excluded.
