# Review Request: Server-owned Workspace analysis runs

Review-Target-ID: refresh-safe-workspace-runs
Branch: codex/refresh-safe-workspace-runs

## What

- Move durable `AnalysisRun` execution, checkpoints, pause, resume, and results to the existing server Analysis Agent.
- Keep browser work bounded to deterministic `PREPARING`; send only validated derived observations, never raw source or test code.
- Persist a non-authoritative run pointer before Start, then make page mount, refresh, reconnect, and polling GET-only.
- Keep Pause and Resume as explicit user POST actions against the same run ID.
- Resume from the server checkpoint and skip completed WorkUnits.

## Why

A browser-owned Promise cannot truthfully remain `RUNNING` after the page is destroyed. IndexedDB can preserve data, but it cannot preserve execution. Refresh must therefore be irrelevant to the lifecycle of an accepted run, rather than an event that pauses, resumes, or replays it.

## Original Requirements

> “我想要的不是刷新后自动接续，我想要的是刷新浏览器，当前运行的任务状态未发生变化。”
>
> “我浏览器可能会刷新很多次，但不要影响我的分析任务。”

- 来源：co-creator dispatch message（2026-07-27），固化于 `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md`
- **请对照上面的摘录判断：刷新是否只是读取同一个服务端任务，而不是触发恢复或重新分析。**

## Tradeoff

Raw local source remains browser-local. The browser still performs deterministic source preparation before a run is accepted, and that phase is explicitly `PREPARING`, not `RUNNING`. Once the API accepts derived observations, all durable execution is server-owned. Worker re-leasing after an API process restart remains a deployment concern; persisted checkpoints remain queryable and manually resumable.

## Architecture Ownership

Architecture cell: N/A — this repository has no `docs/architecture/ownership/README.md`
Map delta: none
Why: The change removes browser lifecycle ownership and reuses the existing server AnalysisRun and Fact-store owners; it does not create a parallel queue or store.

请 reviewer 检查：

- diff 是否与 `Map delta: none` 一致；
- 是否意外保留了浏览器模型队列、auto-resume 或 mount-time mutation；
- observation normalization 是否足够封闭，且没有 raw source/secret ingress；
- pre-Start run pointer、idempotent Start、Pause/Resume 和 completed-WorkUnit skip 是否覆盖竞态。

## Open Questions

### 技术 OQ

1. Observation body sizing是否需要在当前 PR 内进一步约束，还是应由后续 chunked ingestion 处理？
2. API checkpoint/result identity 校验是否覆盖 project、Snapshot、run 和 source component 的所有错配？
3. 浏览器 `PREPARING` 与服务端 `RUNNING` 的状态转换是否还有用户可见的伪运行窗口？

### 价值 OQ

无。

## Fresh-Context Findings

Agent: `[CodeX/GPT-5🐾]`
SHA scanned: `cf40978 + working tree`
Total findings: 2（0 P1, 2 P2, 0 P3）

| # | Finding | Author 处置 | 状态 |
|---|---|---|---|
| FC-1 | Observation source identity omitted a source-content fingerprint, so same-size semantic changes could reuse a Snapshot | Added `contentFingerprint` to browser contract, schema, normalization, digest, and regression tests | ✅ |
| FC-2 | A refresh exactly around `202 Accepted` could miss the server run pointer | Persist `SUBMITTING` run pointer before Start; refresh only GETs the deterministic run ID | ✅ |

**Reviewer delta tracking**: 请将 findings 标注 `[FC:covered]`、`[FC:new]` 或 `[FC:N/A]`。

## Next Action

Please independently review the pushed HEAD in a detached/read-only sandbox, rerun the gates, and return `APPROVE` or `REQUEST_CHANGES` with file/line evidence. Do not edit the author worktree.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/refresh-safe-workspace-runs/kimi`
- Bootstrap: `unset NODE_ENV && npm ci && npm --prefix web ci`
- API: `HOST=127.0.0.1 PORT=3103 CORS_ALLOWED_ORIGINS=http://127.0.0.1:5103 node src/api/dev-server.js`
- Web: `npm --prefix web run dev -- --port 5103 --host 127.0.0.1`
- Ports: `web=5103`, `api=3103`（禁止 3003/3004）

## 自检证据

### Spec 合规

- Browser refresh/mount/reconnect paths are GET-only after Start.
- Only explicit user handlers call Pause or Resume.
- Server Start is idempotent for the deterministic run ID.
- Server resume uses the existing checkpoint and does not repeat completed WorkUnits.
- Raw source/test code is rejected; secret-like configuration must be redacted.
- Browser preparation never displays `RUNNING`.
- Bilingual design and bug-report documents match the server-owned boundary.
- Root artifact gate is clean in the target worktree.

### Red → Green

```text
node --test web/tests/workspace-analysis-run-client.test.mjs
→ RED before server client and subscription implementation
→ GREEN: request redaction, GET-only refresh, explicit mutations, pre-Start pointer

node --test test/workspace-observations.test.js
→ RED before observation normalization
→ GREEN: source-only Snapshot, deterministic Facts, content-fingerprint identity, rejection boundaries
```

### Fresh full gates

```text
unset NODE_ENV && npm test
→ 231 passed, 0 failed

unset NODE_ENV && npm run test:web
→ production build succeeded; 40 passed, 0 failed

unset NODE_ENV && npm --prefix web run lint
→ 0 errors

git diff --check
→ clean
```

### Runtime dogfood

- Isolated API `127.0.0.1:5117`: project 201, observations 201, run Start 202.
- Observation payload included `contentFingerprint: CONTENT-DOGFOOD-1`.
- Two independent GET requests returned the same `ANALYSIS-DOGFOOD-REFRESH` with status `COMPLETED`.
- Isolated browser preview `127.0.0.1:5105`: HTTP 200, accessibility tree rendered, no runtime/API console error.
- Screenshot: main-worktree browser artifact directory `.playwright-mcp/refresh-safe-workspace-server-owned.png` (not part of the target diff).

### Related documentation

- Plan: `feature-specs/2026-07-27-server-owned-workspace-analysis-runs.md`
- Design: `docs/features/workspace-analysis-design.md`
- Analysis Agent: `docs/features/analysis-agent-design.md`
- Bug report: `docs/bug-report/workspace-analysis-refresh-resume.md`
- Canonical ontology ADR: `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
