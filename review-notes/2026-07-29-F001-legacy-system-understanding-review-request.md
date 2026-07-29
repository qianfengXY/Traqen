# Review Request: F001 Legacy-System Understanding and Traqen System Requirements

Review-Target-ID: refresh-independent-workspace-runs
Branch: codex/refresh-independent-workspace-runs
Review range: 669f6ee..HEAD

## What

Reframed F001 from a browser-refresh/durable-scan task into Traqen's P0 legacy-system understanding and canonical graph capability. Added bilingual system requirements and a detailed understanding-engine design covering complete inventory, independent evidence lanes, bounded Agent/Skill analysis, reconciliation, multi-dimensional correctness evaluation, incremental equivalence, and Traqen-on-Traqen acceptance. The durable lifecycle remains a supporting design.

## Why

Durable execution can keep a wrong or noisy analysis running. The operator's core requirement is that Traqen correctly and transparently reconstruct existing systems and connect requirements, design, code, configuration, tests, results, and Evidence for inspection, impact, and quality traceability.

## Original Requirements

> “扫描与分析 Agent 可能需要重新设计……这个需求是我最核心的需求，怎么把存量代码的分析正确。”
>
> “做一个需求、设计、代码、测试用例、测试结果、配置等图谱关联，便于之后做变更影响分析、内容查看、质量追溯等。”
>
> “拿 Traqen 项目做测试验证，通过 Traqen 自己展示自己的功能图谱。”

- Source: `feature-discussions/2026-07-29-F001-legacy-system-understanding/README.md`
- Please judge the design against these outcomes, not only against its stated ACs.

## Tradeoff

- Rejected one model or one scanner as the repository-understanding authority.
- Rejected node count and one confidence score as correctness.
- Kept human Decisions as business authority, which means self-analysis requires a reviewed seed truth set.
- Kept the first connector local and allowlisted; remote Git is an extension, not a different graph model.

## Architecture Ownership

Architecture cell: legacy-system understanding → canonical traceability graph
Map delta: update required
Why: the change expands the source-understanding boundary, defines independent analysis lanes and reconciliation, and makes evaluation plus self-dogfood release gates part of the system requirements.

Please check:

- whether the diff matches `Map delta`;
- whether any proposed object duplicates an existing Store/Queue/Router/Adapter/Dispatcher/Binding;
- whether the new system requirements conflict with ADR-0001 or the detailed architecture;
- whether lifecycle durability has correctly become supporting infrastructure.

## Open Questions

### Technical OQ

1. Can the truth-set design measure recall without leaking expected answers into production analysis?
2. Are independent lanes and iterative SourceSlice retrieval bounded enough to prevent unreviewable model behavior?
3. Are the full-versus-incremental equivalence and required/forbidden edge gates adequate?
4. Does the Traqen-on-Traqen contract prove useful traceability rather than merely self-referential node generation?

### Value OQ

No new value choice for reviewer. The operator Design Gate will approve truth-set ownership, initial release thresholds, and Local Runner as the first connector.

## Next Action

Perform an independent read-only review of `669f6ee..HEAD`, compare both languages and the existing ADR/architecture, then return `APPROVE` or prioritized findings. Do not implement changes.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/refresh-independent-workspace-runs/kimi`
- Start Command: not required for this docs-only review
- Ports: web=N/A, api=N/A
- Bootstrap: `unset NODE_ENV && npm ci`

## Self-check evidence

### Spec compliance

- operator's correctness, graph, impact/content/quality, and Traqen self-analysis requirements map to F001 ACs;
- refresh durability is retained as AC-E infrastructure rather than the Feature goal;
- system requirements and engine design have equivalent English/Chinese section structures;
- docs-only Dogfood-Your-Slice and `.pen` comparison are explicitly not applicable.

### Tests

```text
node --test test/bilingual-documentation.test.js → 1/1 pass
npm test → 231/231 pass
npm run test:web → production build + 40/40 pass
npm --prefix web run lint → exit 0
git diff --check → exit 0
relative-link audit → 21 changed/new Markdown files, all links resolve
root media artifact audit in the feature worktree → no findings
```

### Relevant documents

- Discussion: `feature-discussions/2026-07-29-F001-legacy-system-understanding/README.md`
- System requirements: `docs/architecture/traqen-system-requirements.md`
- Feature: `docs/features/F001-legacy-system-understanding.md`
- Engine: `docs/features/legacy-system-understanding-engine.md`
- ADR: `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
