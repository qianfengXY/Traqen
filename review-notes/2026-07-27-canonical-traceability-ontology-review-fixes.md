# Re-review Request: Canonical Candidate Traceability

Review-Target-ID: canonical-traceability-ontology-r2
Branch: codex/canonical-traceability-ontology
Original implementation: 0af2ffb
Review fixes: e4c41e5
Review range: b65ee13..e4c41e5

## What

All P2 findings and both P3 observations from Kimi's first review are addressed:

| Finding | Repair |
|---|---|
| P2-1 Workspace Candidate counts were labelled Feature | Local Workspace headers, summaries, statistics, tree rows, detail blocks, and accessibility text now say Candidate; persisted compatibility field names remain internal only. |
| P2-2 Public Agent reasoning said “Feature-tree admission” | Reworded to Candidate-projection admission/reconciliation in both languages. |
| P2-3 `proposal` was an open object | JSON Schema and runtime normalizer now use an explicit proposal vocabulary, reject unknown fields, and recursively reject identity/governance fields at any depth. Envelope fields smuggled into `proposal` fail closed. |
| P2-4 Empty Workspace fell back to governed demo graph | Empty local analysis now projects one Snapshot-bound `TRACE_GAP` (`NO_CANDIDATE_OBSERVATION`) and records `governedFallbackUsed: false`; Workspace graph selection no longer has a demo fallback. |
| P3 tree fields used Feature terminology | Tree nodes and selectors now use `candidateId` / `candidateCount`. |
| P3 lineage could consume unvalidated stable IDs | Extension validation requires declared stable evidence to correspond exactly to cited Facts, rejects undeclared or duplicate implementation stable IDs, and canonicalizes the implementation digest. |

The canonical ADR now records the closed proposal and exact stable-evidence rules.

## Why

Candidate discovery is not governance. Browser labels, empty states, model envelopes, and lineage matching must all preserve that boundary or users can mistake provisional analysis for approved business truth.

## Tradeoff

IndexedDB compatibility fields such as persisted `featureCount` and the internal `analysis.features` collection remain unchanged. They are not displayed as governed Features, and renaming them would require an unrelated storage migration. The user-visible tree contract and all projections use Candidate semantics.

## Open Questions

None from the author. Please specifically try nested proposal smuggling, empty Workspace graph selection, and lineage manipulation through duplicated or undeclared `design.implementation[].stableId`.

## Verification

```text
npm test
→ 225 passed, 0 failed

npm run test:web
→ production build succeeded; 34 passed, 0 failed

npm --prefix web run lint
→ 0 errors

git diff --check
→ clean
```

Focused Red→Green evidence:

- proposal authority/unknown-field tests failed before the closed schema/normalizer and now pass;
- stable evidence mismatch, undeclared design evidence, and duplicate design evidence tests failed before deterministic validation and now pass;
- empty Workspace graph and Candidate tree-field tests failed before the projection changes and now pass;
- the old Web behavior that silently ignored envelope fields inside `proposal` was changed to fail closed.

Dogfood:

```text
non-empty Workspace node types
→ CANDIDATE_FEATURE, CANDIDATE_CLAIM, CODE_SYMBOL, TRACE_GAP
governed node leak
→ none

empty Workspace node types
→ TRACE_GAP
governedFallbackUsed
→ false
```

## Next Action

Perform an independent read-only review of `e4c41e5` (or range `0af2ffb..e4c41e5`) and return `APPROVE` or `REQUEST_CHANGES` with file/line evidence. Do not edit the author worktree.

## Review Sandbox

- Suggested path: `/tmp/cat-cafe-review/canonical-traceability-ontology/kimi-r2`
- Create: `git worktree add --detach /tmp/cat-cafe-review/canonical-traceability-ontology/kimi-r2 e4c41e5`
- Web start: `npm --prefix web run dev -- --port 3201`
- Ports: `web=3201`, `api=3202`; do not use 3003/3004.

[CodeX/GPT-5.6🐾]
