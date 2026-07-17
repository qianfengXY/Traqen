> Language: **English** · [简体中文](workspace-analysis-design.zh-CN.md)

# Local Workspace analysis and Feature tree

## Vision

A user can define a Workspace, select a source-code directory, scan it without uploading source, see every discovered capability in a Feature tree, and inspect the five-part trace view for each capability. Discovery must never silently promote implementation observations into confirmed business truth.

## User flow

1. Enter a Workspace name and stable Project ID.
2. Select a local code directory through the browser directory chooser.
3. Traqen reads supported text files locally. Raw source is never uploaded or persisted; a bounded derived index is saved in browser IndexedDB.
4. The local scanner discovers Spring MVC/WebFlux and JAX-RS endpoints, Java backend components and interface methods, HTTP routes, OpenAPI JSON operations, JavaScript/TypeScript exported capabilities, and `package.json` commands.
5. Results are grouped as Workspace → readable module/domain → external API services, business capabilities, data/integrations, background jobs/messaging, or project/runtime operations → candidate Feature. Parent counts always mean descendant Features, not direct folders.
6. Workspace analysis first presents project-wide statistics. Selecting any Workspace, module, discovery group, or Feature node recalculates the same measures for that node and every descendant.
7. Feature traceability remains the detail surface: selecting a candidate there displays Feature description, design/source, configuration clues, related tests, test results, independent trust dimensions, and TraceGap ownership.

## Hierarchical analysis statistics

- Statistics include Feature count, located design/implementation, unique module-relevant or project-global configuration clues, unique related test cases, and execution-result distribution.
- Governance statistics keep pending human confirmation, implementation awaiting review, conflicts, and explicit nonconformance separate.
- Evidence statistics show complete and incomplete chains plus blocking and warning TraceGaps. There is no composite green score.
- `PARTIAL`, `UNKNOWN`, and `NOT_RUN` are missing or unverified states, not nonconformance. The nonconformance count includes only an explicit nonconforming state, failed/error execution, or a corresponding violation gap. Conflicts remain a separate measure.
- The next-level table repeats the measures for each immediate child, allowing the user to drill from Workspace to module, discovery group, and individual Feature without mixing data from another project.

## Workspace lifecycle and navigation

- The left Workspace switcher can create and retain multiple local projects. Selecting a project makes it the active data boundary for every product view.
- The first scan initializes a project; it is not an isolated report owned by the analysis page.
- A later scan of the same root compares relative path, byte size, last-modified time, and scanner version. Unchanged file records are reused; added or modified supported files are reread; deleted paths are removed before the Feature tree is rebuilt. A scanner upgrade invalidates stale records automatically.
- The initialized Workspace name, Project ID, Feature tree, selected Feature, selected trace block, and expanded tree nodes are held by the product-level session and survive navigation between product views.
- Feature traceability reuses the initialized Feature tree directly. Selecting any tree item opens that candidate's five-part trace chain without rescanning.
- Workspace analysis remains the initialization and rescan surface. Feature traceability is the primary surface for reviewing candidates one by one.
- The API connection can temporarily show a server-derived Feature. Returning to the self Workspace restores the initialized local tree and selection.
- Feature traceability and the trace graph both use the active project's Feature tree and selected Feature. Neither falls back to another Workspace while a local project is active.
- Project summaries and derived scan records survive a full refresh on the same browser profile. Directory `File` handles are not retained, so the user selects the original root again before an incremental scan.

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
- Persist only file metadata, discovered Feature indexes, bounded source/test excerpts, and redacted configuration clues instead of retaining the full source tree. The persisted snapshot stores scan records once and rebuilds aggregate analysis when loaded.
- Read individual supported text files only up to 768 KB.
- Expand the Feature tree on demand so unopened modules and discovery groups do not create all leaf elements in the page at once.
- Exclude real `.env` variants, allow only environment templates, and redact secret-like configuration values before display.
- Do not upload source to the hosted Traqen site. Do not persist complete source files, real `.env` values, or unredacted secret-like configuration.

## Current discovery coverage

The scanner recognizes Spring `@RequestMapping` and HTTP method mappings with combined class/method paths; JAX-RS `@Path` and HTTP annotations; Java Controller, Service, Repository, Component, scheduled job, and message/event listener methods; Java interfaces and meaningful public/protected backend methods; Maven/Gradle and application configuration clues; and Java test-source associations. Trivial getters/setters and configuration factory methods are not promoted into Features. Endpoint leaves prefer the Java method, router handler, or OpenAPI summary/operation ID as the readable label while retaining the HTTP method and route as technical detail. The scanner also recognizes common JavaScript/TypeScript exports, Python functions, C# public methods, Go functions, Rust public functions, HTTP router registrations, OpenAPI JSON paths, and npm scripts. Generated Java `target`, `out`, and Gradle cache directories remain excluded.
