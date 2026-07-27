> Language: **English** · [简体中文](workspace-candidate-terminology.zh-CN.md)

---
feature_ids:
  - canonical-traceability-ontology
topics:
  - candidate-projection
  - workspace
  - ontology
  - test-execution
doc_kind: bug-report
created: 2026-07-27
---

# Workspace Candidate terminology leak

## Diagnosis capsule

| Field | Evidence |
|---|---|
| Symptom | Workspace-local navigation, statistics, task copy, and graph legend used governed `Feature` or `Execution results` terminology for Candidate and test-asset observations. |
| First bad boundary | The local statistics contract exposed `featureCount`, `testCaseCount`, `executedFeatureCount`, and an execution-result distribution even though local analysis cannot create a governed Feature, TestSpec, TestExecution, or VerificationResult. |
| Minimal reproduction | Open an analyzed local Workspace, then inspect Candidate traceability or hierarchical statistics. The UI labelled the Candidate surface “Feature traceability” and rendered an execution-result distribution derived from the literal `NOT_RUN` placeholder. |
| Evidence | Kimi review findings at `traqen-product.tsx:1645`, `:1679`, `:1926`, `:1946`, `:2027`, and `:3045`; same-pattern scan additionally found `:1892`, `:2001`, `:2028`, `:2550`, `:3002`, and `:3408`. |
| Rejected hypotheses | This was not only a translation typo: both languages and the TypeScript statistics model carried the same governed vocabulary. It was also not a real execution state because local analysis has no approved TestSpec, Runner result, or signed Evidence. |
| Root-cause hypothesis | The Workspace UI reused names from the governed Feature view, while its local statistics model encoded absence as a synthetic execution distribution. The shared vocabulary allowed new surfaces to repeat the same category error. |
| Fix | Rename local types, components, counts, and test observations to Candidate/Test Asset terms; always keep the formal `NO_TEST_SPEC` gap independent from the optional `NO_TEST_ASSET_CLUE`; replace synthetic execution results with `executionEvidenceGapCount`; represent verification as `UNAVAILABLE`; make navigation and graph labels conditional on Candidate versus governed context; retain only explicit legacy IndexedDB read compatibility. |
| Prevention | Source-contract tests reject the old local identifiers and visible strings, statistics tests require Candidate/Test Asset/execution-gap fields, and scanner version 6 invalidates cached analyses with the old local shape. |

## Failure-mode sweep

Pattern searched:

- local Workspace labels that say Feature instead of Candidate;
- test-file observations labelled TestSpec/test cases;
- absence of trusted execution evidence represented as TestExecution status or result distribution;
- local internal types and counters that invite those substitutions.

Scanned surfaces:

- global navigation and breadcrumb;
- Candidate tree, detail blocks, hierarchical statistics, child-scope table;
- analysis task titles and initialization actions;
- local graph toolbar, error state, and legend;
- local analysis, statistics, graph, storage, and unused layout component contracts.

Intentionally retained:

- governed server/demo views that really display Feature, TestSpec, TestExecution, or execution results;
- explicit “Candidate → trusted Feature” promotion copy;
- `analysis.features` and legacy IndexedDB `featureCount/features` reads only at the compatibility boundary. New stored summaries use `candidateCount/candidates`.
