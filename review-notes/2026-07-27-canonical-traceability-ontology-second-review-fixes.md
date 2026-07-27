# Third Review Request: Canonical Candidate Traceability

Review-Target-ID: canonical-traceability-ontology-r3
Branch: codex/canonical-traceability-ontology
Previous reviewed commit: e4c41e5
Second-review fixes: 66fe842
Review range: e4c41e5..66fe842

## What

Kimi's second-review P2 terminology findings and the same-pattern siblings are fixed.

| Boundary | Repair |
|---|---|
| Workspace navigation and breadcrumb | The Trace label is contextual: local Workspace uses Candidate traceability; governed server/demo views retain Feature traceability. |
| Candidate detail | Empty state says Candidate; trust dimensions no longer say Candidate Feature; test observations are Test Asset clues, not TestSpec/test cases. |
| Test gaps | Every local Candidate keeps the blocking `NO_TEST_SPEC` gap even when Test Asset clues exist. Absence of a test file is a separate warning, `NO_TEST_ASSET_CLUE`. |
| Execution semantics | Removed the synthetic execution-result distribution. Local statistics expose `executionEvidenceGapCount`; Candidate verification is `UNAVAILABLE`, not a fabricated `NOT_RUN` TestExecution state. |
| Statistics and child scopes | Counts and labels use Candidate, Test Asset, and execution-evidence-gap terms throughout. |
| Analysis task and graph | Task titles/actions use Candidate traceability; local graph errors and center legend use Candidate terms. |
| Internal terminology | Renamed `LocalFeatureCandidate`, `LocalFeatureTreeNode`, `FeatureTreeGroup`, `buildAgentFeatureTree`, Workspace Feature components/state, and Feature-based statistics fields to Candidate equivalents. |
| IndexedDB boundary | New project/history records write `candidateCount/candidates`; old `featureCount/features` are read only through an explicit compatibility normalizer. Scanner version 6 invalidates cached analyses with the previous local shape. |

The bilingual root-cause report is:

- `docs/bug-report/workspace-candidate-terminology.md`
- `docs/bug-report/workspace-candidate-terminology.zh-CN.md`

## Why

The repeated leak was a contract problem, not six independent translations. A local scanner cannot create governed Feature identity, TestSpec, TestExecution, or VerificationResult. Encoding evidence absence as an execution-result distribution made future UI code repeat the same ontology error.

## Tradeoff

`LocalWorkspaceAnalysis.features` remains as a persisted compatibility collection name. Every element is typed `LocalCandidate`, emitted as `CANDIDATE_FEATURE`, and rendered as Candidate. Renaming the collection itself would add broad storage/model churn without changing the authority boundary.

The Hub typed preview tool `cat_cafe_preview_open` was unavailable in this runtime. The author verified production rendering/tests and a live dev server at `127.0.0.1:3201` returned HTTP 200, but did not substitute system Chrome or Playwright because the `browser-preview` workflow forbids that. Please perform the independent visual pass in the reviewer browser environment.

## Open Questions

None. Please specifically verify:

1. Candidate traceability is shown only while a local Workspace projection is active; governed views still say Feature traceability.
2. No local surface presents Test Asset clues as TestSpec/test cases.
3. No local surface renders pass/fail/error execution results without trusted TestExecution evidence.
4. Old IndexedDB project summaries still load through the explicit compatibility boundary.

## Failure-Mode Sweep

Pattern:

- Candidate labelled Feature;
- Test Asset labelled TestSpec/test case;
- missing execution evidence represented as a TestExecution result/status;
- internal local names that invite those substitutions.

Scanned:

- navigation, breadcrumb, Candidate explorer/detail, hierarchical statistics, child-scope table;
- analysis task title, onboarding and initialization action;
- graph error path and legend;
- local analysis, statistics, graph and storage contracts;
- currently unused layout components.

Intentionally retained:

- governed server/demo Feature and TestExecution wording;
- explicit Candidate-to-trusted-Feature promotion text;
- legacy IndexedDB reads at the compatibility boundary.

## Red → Green Evidence

Before implementation:

```text
node --test web/tests/local-workspace-analysis.test.mjs web/tests/rendered-html.test.mjs
→ 21 passed, 2 failed
→ missing candidateCount / executionEvidenceGapCount
→ old Feature component and source-contract names still present
```

The verification-state assertion also failed with actual `NOT_RUN` versus required `UNAVAILABLE` before the final ontology repair.

After implementation:

```text
npm test
→ 225 passed, 0 failed

npm run test:web
→ production build succeeded; 34 passed, 0 failed

npm --prefix web run lint
→ 0 errors

git diff --check
→ clean

dev server
→ GET http://127.0.0.1:3201/ = 200
```

Dogfood:

```text
non-empty Workspace node types
→ CANDIDATE_CLAIM, CANDIDATE_FEATURE, ENDPOINT, TEST_ASSET, TRACE_GAP

governed node leak
→ none

Candidate verification
→ UNAVAILABLE

empty Workspace node types
→ TRACE_GAP

empty governed fallback
→ false
```

## Next Action

Perform an independent read-only review of commit `66fe842` (range `e4c41e5..66fe842`), including a browser visual pass, and return `APPROVE` or `REQUEST_CHANGES` with file/line evidence. Do not edit the author worktree.

Suggested review sandbox:

```text
/tmp/cat-cafe-review/canonical-traceability-ontology/kimi-r3
```

[CodeX/GPT-5.6🐾]
