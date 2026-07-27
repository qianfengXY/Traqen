# Review Request: Canonical Candidate Traceability

Review-Target-ID: canonical-traceability-ontology
Branch: codex/canonical-traceability-ontology
Commit: 0af2ffb

## What

Traqen now uses one Snapshot-bound `WorkUnit` / `CandidateBundle` contract across the browser and server. Deterministic validation rejects missing, duplicate, cross-WorkUnit, cross-Snapshot, and over-cap evidence. Browser projections explicitly render Candidate and test-asset semantics, while the server Analysis Agent returns Candidate-only results without Feature identity, inherited authority, or retirement semantics.

## Why

The previous browser and server pipelines could make model reconciliation resemble governed business truth. This change preserves the useful scan → Candidate → reconciliation → projection pipeline while making the canonical graph, identity boundary, and authority boundary explicit and enforceable.

## Original Requirements

> 图谱是唯一真相模型，功能树只是只读投影。
> 每条模型结论必须包含 evidenceFactIds，验证器必须拒绝引用工作单元外证据的结论。
> 测试文件线索 ≠ TestSpec；候选说明 ≠ Claim；没有测试结果 ≠ TestExecution；模型对账成功 ≠ 业务确认。
> Feature 身份必须独立于源码位置和功能树层级。

- 来源：co-creator dispatch mission，已整理为 `feature-specs/2026-07-25-canonical-traceability-ontology.md`
- 请对照上述要求判断交付物是否阻止 Candidate 被误当成权威 Feature。

## Tradeoff

This slice does not migrate every governed object into a new physical graph database and does not add the human identity-resolution UI. Existing governed Feature, Claim, TestSpec, execution, and Evidence stores remain authoritative. IndexedDB remains a recoverable cache/checkpoint, not a second truth source.

## Architecture Ownership

Architecture cell: none — this repository has no `docs/architecture/ownership/` map
Map delta: none
Why: The change unifies contracts inside the existing analysis boundary and adds no new runtime, store, queue, or deployment owner.

Please verify that the diff does not accidentally create a parallel truth store or a second governed identity path.

## Open Questions

### Technical OQ

1. Can any model/Skill response still smuggle evidence or confidence through nested `proposal` fields?
2. Does `previousCandidateId` remain an explicitly non-authoritative lineage suggestion in every history/absence path?
3. Do the JSON Schema, OpenAPI envelope, runtime normalizer, browser client, and Analysis Agent agree on identity and evidence boundaries?
4. Does any browser projection still fabricate `FEATURE`, `CLAIM`, `TEST_SPEC`, `TEST_EXECUTION`, or business authority?

### Value OQ

None.

## Fresh-Context Findings

Agent: [CodeX/GPT-5.6🐾]
Scope: worktree diff over 74f2be4
Total findings: 1 (0 P1, 1 P2, 0 P3)

| # | Finding | Author disposition | Status |
|---|---|---|---|
| FC-1 | A user-visible Agent progress message still said reconciliation would decide “功能树准入,” implying governance authority. | Reworded to “候选投影准入” in 0af2ffb. | fixed |

Finding generator only; this is not an approval verdict.

## Next Action

Please perform an independent read-only review of commit `0af2ffb`, report P0/P1/P2 findings with file and line evidence, and return `APPROVE` or `REQUEST_CHANGES`. Do not edit the author worktree.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/canonical-traceability-ontology/kimi`
- Source worktree: `/Volumes/WorkSSD/projects/Traqen-worktrees/canonical-traceability-ontology`
- Create: `git worktree add --detach /tmp/cat-cafe-review/canonical-traceability-ontology/kimi 0af2ffb`
- Web start: `npm --prefix web run dev -- --port 3201`
- Ports: `web=3201`, `api=3202`; do not use 3003/3004.

## Self-check Evidence

### Spec compliance

- AC-1–AC-7 are covered by the ADR, shared contract, browser projection, and server Analysis Agent changes.
- AC-8 verification is green.
- No matching `.pen` design file exists.
- Root artifact-hygiene scans returned no media/design artifacts.
- The repository `quality-gate` command is a runtime continuous-protection client requiring a live project/change-set, so its behavior is covered by the passing CLI tests rather than invoked without a target.

### Verification

```text
npm test
→ 221 passed, 0 failed

npm run test:web
→ production Web build succeeded; 33 passed, 0 failed

npm --prefix web run lint
→ 0 errors

git diff --check
→ clean
```

Dogfood path:

```text
scanLocalWorkspaceFile
→ analyzeLocalWorkspaceRecords
→ createLocalWorkspaceCandidateGraph

Result:
- SnapshotManifest: LOCAL-SNAPSHOT-F1DB8FF6C60510D6
- Candidate count: 2
- Node types: CANDIDATE_FEATURE, CANDIDATE_CLAIM, ENDPOINT, TRACE_GAP
- Forbidden governed/fabricated node types: none
```

The worktree Web server returned HTTP 200 on port 3000 during author verification. The required Hub `cat_cafe_preview_open` typed tool was unavailable in this invocation, so no Hub screenshot was fabricated with an external browser tool. Please include visual inspection from the review sandbox if the reviewer has that tool.

### Relevant documents

- Plan: `feature-specs/2026-07-25-canonical-traceability-ontology.md`
- ADR: `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
- Chinese ADR: `docs/decisions/ADR-0001-canonical-traceability-ontology.zh-CN.md`
