> Language: **English** · [简体中文](clowder-ai-workspace-analysis-2026-07-18.zh-CN.md)

# Clowder AI Workspace scan validation — 2026-07-18

## Objective and source

This validation uses the real public repository [`zts212653/clowder-ai`](https://github.com/zts212653/clowder-ai), whose README describes a TypeScript/pnpm multi-agent orchestration platform with API, Web, MCP, shared-memory, identity, collaboration, and integration surfaces.

- Default branch: `main`
- Pinned source commit: `d606aab859883422b04d996cf223560fc20ae232`
- Repository files reported by Git: 5,357
- Materialized source-focused checkout records analyzed by Traqen: 4,802
- Supported records: 4,621
- Skipped records: 181

The checkout intentionally materialized the product source, desktop, scripts, skills, feature-specification, and SOP surfaces needed for static Feature discovery. Large binary assets and unrelated non-source content were not downloaded. Traqen did not execute any Clowder AI code, install its dependencies, or treat its documentation as approved business authority.

## What the first real scan exposed

Scanner version 3 could process the repository, but its output was not yet suitable as a readable Feature tree:

- anonymous route callbacks were displayed as `Async` because the route extractor treated the JavaScript keyword as a handler name;
- every exported constant, Schema, test helper, Mock, and fixture could be promoted to a Feature candidate;
- generic token overlap associated nearly every candidate with tests;
- project-global package/configuration files made every candidate appear configured;
- the tree stopped at eight broad modules and placed thousands of leaves directly beneath discovery groups.

These are scanner-quality failures, not defects in the analyzed repository.

## Version 4 correction and observed result

| Measure | Version 3 baseline | Version 4 result |
| --- | ---: | ---: |
| Candidate Features | 5,442 | 4,324 |
| HTTP endpoints | 472 | 459 |
| Callable code symbols | 4,832 | 3,727 |
| Project/runtime commands | 138 | 138 |
| Distinct linked configuration clues | 30 | 14 |
| Candidates linked to configuration | 5,442 | 427 |
| Distinct related test clues | 2,181 | 1,941 |
| Candidates linked to tests | 5,435 | 2,657 |
| Misleading `Async` endpoint labels | Present | 0 |

The lower counts are intentional. Version 4 excludes test, Mock, fixture, sample, and story sources from Feature promotion; excludes plain exported constants and Schemas; keeps exported functions, classes, callable variables, endpoints, meaningful backend methods, and commands; and associates tests/configuration only through stronger same-module and domain-proximity evidence.

## Resulting hierarchy

The 4,324 implementation candidates are now arranged as Workspace → module → domain/product area → discovery group → candidate Feature.

| Module | Candidates | Domains / product areas |
| --- | ---: | ---: |
| API | 2,745 | 132 |
| Web Package | 1,164 | 46 |
| MCP Server Package | 149 | 3 |
| Scripts | 89 | 5 |
| Root | 88 | 1 |
| Shared Package | 74 | 6 |
| Finance Package | 11 | 2 |
| Desktop | 4 | 1 |

The largest detected areas include API `Cats` (653 candidates), `Config` (200), `Harness Eval` (176), `Memory` (147), and `Connectors` (97), plus Web `Shared UI` (323), `Hooks` (123), `Settings` (105), and `Memory` (49). These names and boundaries come from source paths and route structure. They are navigational hypotheses, not an approved product taxonomy.

## Traceability interpretation

- All 4,324 candidates remain `PENDING` for business authority and `PARTIAL` for implementation conformance.
- All 4,324 evidence chains remain incomplete because no authorized person confirmed business descriptions and no trusted Runner returned deployment-bound execution Evidence.
- The scan records 14,639 blocking TraceGaps across missing authority, implementation review, approved TestSpecs, and current execution.
- Explicit nonconformance remains 0. Unknown or unreviewed state is not silently relabeled as failure.
- The 1,941 related test files are code-level clues, not approved TestSpecs or execution results.

This is the required behavior for Traqen's product vision: a large repository may yield many implementation candidates, but the platform must not pretend that static discovery has already reconstructed the business truth or proven production behavior.

## Verification and remaining boundary

The Workspace scanner/build regression suite passes with a Clowder-shaped fixture covering anonymous async routes, callable exports, constant/Schema exclusion, support-artifact exclusion, conservative test association, and the new domain layer.

The current end-user workflow still scans a locally selected checkout in the browser; GitHub-URL ingestion is not implemented by this validation. This run obtained a controlled GitHub checkout externally and passed that checkout through the same local scanner. A future GitHub importer must preserve the same source-size limits, secret exclusions, incremental snapshot identity, and no-silent-authority-promotion rules.
