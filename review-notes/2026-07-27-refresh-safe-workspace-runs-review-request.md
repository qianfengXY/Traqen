# Review Request: Refresh-safe Workspace analysis runs

Review-Target-ID: refresh-safe-workspace-runs
Branch: codex/refresh-safe-workspace-runs

## What

- Restore persisted `RUNNING`, `PAUSED`, and `FAILED` states without coercing every browser refresh into a pause.
- Automatically reattach a `RUNNING` analysis after refresh; keep explicit pauses manual.
- Persist `RUNNING` before exposing Pause and persist the pause request immediately.
- Reuse the same run/checkpoint identity for partial scans and model enrichment.
- Rebuild only remaining file/model queues and skip classifications already stored under the same model and evidence policy.

## Why

The analysis executor is page-owned, but its run state and bounded results are durable in IndexedDB. Refresh previously terminated the JavaScript invocation and the hydration effect then falsely rendered every checkpoint as `PAUSED`. Manual continue regenerated visible task identity and Main-Agent planning, which made recovery look and partly behave like a new analysis.

## Original Requirements

> “刷新浏览器也不改变状态，需要暂停则是我人工触发。然后恢复任务也是我人工触发，但这时候已经分析完毕的数据不需要重复分析，应该从我上次暂停的节点继续分析。”

- 来源：co-creator dispatch message（2026-07-27），诊断与需求已固化到 `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md`
- **请对照上述原话判断交付物是否保持运行状态、显式暂停语义与剩余工作续跑。**

## Tradeoff

Raw local source remains browser-local; this patch does not upload the selected directory or introduce a second server executor. A refresh therefore reattaches the new page to the durable run/checkpoint and continues it automatically. If the browser has revoked directory permission, the run remains `RUNNING` and requests reauthorization instead of claiming progress or silently becoming paused.

## Architecture Ownership

Architecture cell: browser-local Workspace analysis lifecycle (`web/app/traqen-product.tsx`, `web/app/local-workspace-store.ts`)
Map delta: none
Why: This changes lifecycle semantics inside the existing IndexedDB checkpoint boundary; it creates no parallel store, queue, router, adapter, dispatcher, binding, or deployment owner.

请 reviewer 检查：

- diff 是否与 `Map delta: none` 一致；
- `RUNNING` 自动恢复是否可能错误覆盖显式 `PAUSED`；
- partial scan 和 model enrichment 是否都复用同一 checkpoint identity；
- completed file records/model classifications 是否仍有重放路径。

## Open Questions

### 技术 OQ

1. Refresh hydration and React effects can race with model-profile loading; does the one-shot auto-resume guard prevent duplicate execution without suppressing the eventual valid resume?
2. Is every user-visible Pause action backed by a durable `RUNNING` checkpoint before it can be clicked?
3. Do scanner-version, model-profile, and evidence-policy mismatches correctly invalidate only the incompatible layer?

### 价值 OQ

无。

## Next Action

Please independently review the pushed commit in a detached/read-only sandbox, rerun the gates, and return `APPROVE` or `REQUEST_CHANGES` with file/line evidence. Do not edit the author worktree.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/refresh-safe-workspace-runs/kimi`
- Bootstrap: `env -u NODE_ENV npm ci && env -u NODE_ENV npm --prefix web ci`
- Web: `NEXT_PUBLIC_API_URL=http://127.0.0.1:3103 npm --prefix web run build && npm --prefix web start -- --port 5103 --host 127.0.0.1`
- API: `HOST=127.0.0.1 PORT=3103 CORS_ALLOWED_ORIGINS=http://127.0.0.1:5103 node src/api/dev-server.js`
- Ports: `web=5103`, `api=3103`（不要使用 3003/3004）

## 自检证据

### Spec 合规

- Refresh restores a durable `RUNNING` task as `RUNNING` and automatically calls the unified continue path.
- Only the explicit Pause handler writes `PAUSED`; failures use `FAILED`.
- New/manual-resumed runs persist `RUNNING` before Pause is available.
- Partial scanning and model enrichment reuse the same checkpoint/run ID.
- Existing compatible file records and model classifications are excluded from remaining work.
- Bilingual design and bug-report documentation match the implemented browser-local safety boundary.
- No matching `.pen` design file exists; no root-level media/design artifact was added.

### Red → Green

```text
node --test tests/local-workspace-run-lifecycle.test.mjs
→ RED: ERR_MODULE_NOT_FOUND before lifecycle implementation
→ GREEN: RUNNING/PAUSED/FAILED recovery cases pass

node --test tests/rendered-html.test.mjs
→ RED: durable-before-pause and partial-checkpoint identity assertions failed before their fixes
→ GREEN: source lifecycle contract passes
```

### Fresh full gates

```text
env -u NODE_ENV npm test
→ 225 passed, 0 failed

env -u NODE_ENV npm run test:web
→ production build succeeded; 38 passed, 0 failed

env -u NODE_ENV npm --prefix web run lint
→ 0 errors, 0 warnings

git diff --check
→ clean
```

### Browser dogfood

- Isolated production Web server: `http://127.0.0.1:5102/` → HTTP 200.
- Seeded `REFRESH-RECOVERY-QA:ACTIVE` at 5/20, status `RUNNING`, then refreshed:
  task remained **执行中**, phase **工程扫描**, current work **正在从最近检查点自动接续**.
- Changed the same checkpoint to `PAUSED`, then refreshed:
  task remained **已暂停** and said it required “继续分析” from the saved 5/20 checkpoint.
- Screenshot captured as `traqen-refresh-running-recovery.png` in the browser-preview artifact output.
- Expected preview-only console error: local API was not started; no runtime/render error was observed.

### Related documentation

- `docs/features/workspace-analysis-design.md`
- `docs/features/workspace-analysis-design.zh-CN.md`
- `docs/bug-report/workspace-analysis-refresh-resume.md`
- `docs/bug-report/workspace-analysis-refresh-resume.zh-CN.md`
- `docs/decisions/ADR-0001-canonical-traceability-ontology.md`
