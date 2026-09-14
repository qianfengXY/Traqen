> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [git, capacity, concurrency, diagnostics]
doc_kind: bug-report
created: 2026-09-09
---

# Git 容量核验的不可归因失败

报告人：砚砚 / gpt-6-astra；验证来源：搬砖工 / gpt-5.6-terra。这是实现诊断，不是独立审阅或完成声明。

## 诊断胶囊

| 栏位 | 记录 |
| --- | --- |
| 现象 | `a6de16a` 整仓三并发 564 项中两项真实 Git 测试返回 `SOURCE_STORAGE_NOT_READY` / 503；期望正常采集和历史重放。浏览器门禁未运行。 |
| 证据 | `traqen-f001-exact-reuse-gate.40HSVk/backend.log`：562 pass、2 fail、零 skip/cancel，308.123s；同一 `source-truth-git.test.js` 隔离复现 5/5、20.069s。失败位于测试第 89、113 行，共同到达 `git-process.js:67`。 |
| 假设/根因 | 已确认监督器将所有非容量异常压缩成 `STORAGE`，丢失原始 errno 和阶段。并发 Git 原子改名与扫描的竞态是待验证假设；原失败的底层原因尚不可证明，隔离绿灯不排除间歇性产品缺陷。 |
| 诊断策略 | 先给私有控制通道补有界、白名单化的阶段/操作/errno/条目类别，不携带路径、参数、stderr 或凭据；定向 RED→GREEN 后再跑同一整仓三并发，保留失败证据。 |
| 超时策略 | 小型诊断回归单次不超过 30 秒；整仓托管不超过 3600 秒。一次有诊断的复现后按具体失败点收敛；无证据不反复盲跑。 |
| 预警策略 | 不忽略 ENOENT，不跳过计量条目，不减少整仓并发、不放宽预算。出现新错误类型先记录，不能把诊断补全当作原故障已修复。 |
| 用户交互 | 保留原错误代码、中文提示及公开 details；诊断只进入本地异常 cause，不使来源文本进入公开响应。 |
| 验收 | 私有通道完整传递安全诊断；真实缺失/不安全条目仍 fail closed；畸形控制帧和未知诊断值不能泄漏输入；原两项和整仓门禁通过后才能进入浏览器。 |

## 运行时预检

目标 checkout 为 `feat/f001-source-truth`，HEAD `a6de16a95f22b25f9e71da0616ddec99f0808471`，仅旧未跟踪 tsbuildinfo；Node v25.6.0，macOS。失败是按测试启动的瞬时 Git 监督进程，不依赖常驻 Web/API；失败 PID、启动时间和当时实时句柄不可从原日志恢复，不能伪造。当前没有同类测试或 Git 监督进程运行。隔离预检的 FD soft limit 为 1,048,575，卷可用约 92,398,444 KiB；这不是失败瞬间的资源采样。

## 历史与边界

既有 `f001-git-cache-capacity` 报告已说明累计水位、私有锁、宿主崩溃和中断锁保留；新问题不是缺少容量策略，而是动态计量失败无法归因。a6 的产品差异在组件/准入，不直接修改 Git 监督器。原报告与 PostgreSQL / pilot 原件保持不变；不访问生产，不触发 CUA 审批。

## 诊断增量与自证

- 两个新回归首先 RED：监督器 cause 为 undefined；直接扫描 cause 为含本地路径的原始 fs 错误。加入固定枚举的阶段、操作、errno、条目类别后，同一两项 GREEN。私有帧上限 512 字节，父进程也重新白名单化；未知值、畸形帧和超长帧只产生安全失败。
- 未改计量算法、扫描边界、100ms 周期、准入余量或拒绝逻辑。`sourceFailure` 只返回 code/message/requestId/details，worker 只记录原安全诊断，不公开新的 cause。没有解析或转发 Git stderr。
- `node --test --test-concurrency=3 test/source-truth-git.test.js test/source-truth-git-capacity.test.js test/source-truth-git-batch.test.js`：19/19、零 skip/cancel，15.864s，exit 0。这包括原两个失败案例，不代表整仓间歇故障已消失。
- 原失败日志 SHA256：`f79d5abb5f58dd8bab94fb3bc8ffda14fd997eeb55e544c1e4dbeda59d37ffb8`；原隔离日志 SHA256：`ea60dbcaed586c3bfafffdd7f8ef48c32b3b942d9925f2338cf5b001ac1cfcff`。原件保留。
- 风险：behavior 为内部诊断变化；data 无持久化修改；security 涉及私有控制帧和脱敏；public contract 不变；irreversible 无。归属仍为 Source Truth Git 执行面，无新 Store/权限边界或架构决策。没有 UI 改动，不重跑旧 Web 门禁。
- 下一道实际检查为同一整仓后端三并发，有诊断才能进一步定位；通过后才能跑原预算浏览器。F001 未完成、未正式审阅、未合入。
