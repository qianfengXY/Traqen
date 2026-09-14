> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [source-truth, version-delta, regression]
doc_kind: bug-report
created: 2026-09-09
---

# 版本差异遗漏已移除来源

[English](bug-report.en.md)

报告人：砚砚 / gpt-6-astra。诊断基线：`29b9568eba8dc8dde4d12f28d3614a0048acb255`。这是 F001 实现问题记录，不是独立审阅结论。

## 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| 1. 现象 | 比较新旧冻结包时，只能选择目标包仍有的来源。基线有目录和 Git、目标只保留 Git 时，无法选择被移除的目录。文件 B §7.4、§10.4、§11 要求来源移除单独展示，不能冒称文件全删。 |
| 2. 证据 | `SourceForm` 允许取消来源；`SourceVersionView` 的差异来源下拉框仅遍历 `version.components`；`SourceDeltaService.compare` 已区分 `SOURCE_ADDED` / `SOURCE_REMOVED` / `SOURCE_SCOPE_CHANGED`。静态调用链确认，尚未声称原生浏览器复现。 |
| 3. 根因 | 来源选项误用目标版本的单边投影，应为选中两个版本按 sourceId 的并集。相同 kind 的不同登记不能合并。 |
| 4. 诊断策略 | 原样提取现有投影并接回真实 UI，再以移除、替换、同登记新组件和切换基线的测试证明行为缺口。后端契约保持不变。 |
| 5. 超时策略 | 20 分钟内测试不能准确复现时，缩小到来源投影与实际组件接线；不转去重试 Chrome 权限。 |
| 6. 预警策略 | 若只是导入或环境失败，不算 RED；若需改发布、准入或服务端 Delta 契约，停止扩面并重新定位。 |
| 7. 用户可见修正 | 新增及移除的来源都可选择，并显示仅基线/仅目标标签；切换基线后清除不属于当前版本对的选择与结果。 |
| 8. 验收 | 来源投影 3 项 RED，失效选择 1 项 RED → 同一前端 5 项及后端 1 项全部 GREEN（exit 0，0 skip，8.85s）。`00e19ea` Web 构建及 91/91 测试、严格类型、lint、双语文档 2/2、真实浏览器 8 旅程均 exit 0。 |

## 复现及修复范围

1. 基线完整包包含目录 D 和 Git G。
2. 新建完整版本，取消目录，只保留 G。
3. 打开新包的文件级版本差异，选择旧包为基线。
4. 旧实现只有 G 可选，D 的 `SOURCE_REMOVED` 结果没有入口。

修复仅限比较选择与回归测试，不修改来源材料、历史包、鉴权或服务端判定；不将 OPFS/服务端规模测试写成原生 picker、100k UI 或部署验收。

## 可重现验证

RED 命令：`node --test web/tests/source-truth-delta.test.mjs`。原样提取、接入 UI 的旧投影实际只返回 `[git]`，预期 `[git, directory]`；同类新登记只返回 `[new-directory]`，漏掉旧登记；切换基线仍保留 `old-directory`，预期回到当前可选的 `git`。总计 5 项中 4 项失败，接线检查通过，exit 1；不是语法或环境错误。

GREEN 命令：`env -u DATABASE_URL -u SOURCE_TRUTH_CONFIG -u REDIS_URL -u TRAQEN_DATA_DIR node --test web/tests/source-truth-delta.test.mjs test/source-truth-delta.test.js`。6/6 通过。后端 fixture 使用隔离 PGlite，来源移除及反向新增均返回不可逐项比较、空条目和 null 计数；原文件修改/新增/删除和分页定位仍通过。

浏览器脚本新增真实页面操作：组合包移除目录、保留 Git、冻结新版；差异页选择旧目录，展示 `SOURCE_REMOVED`；清除基线时重置选择和结果；反向比较显示 `SOURCE_ADDED`；全比较过程无写请求。该旅程已经实际通过，完整原报告保存在 [browser-00e19ea.json](browser-00e19ea.json)。

## 新提交门禁与 Dogfood

验证代码：`00e19ea69601f7224e3397c21c7c4d71b583e711`。整个托管命令 123s、exit 0。完整日志目录：`/private/tmp/traqen-f001-delta-gate.MqDhEq/`；各项 `web.log/types.log/lint.log/docs.log/browser.log` 已完整读取，全部实际 exit 0，无未运行项。Web 91、文档 2 均无跳过。构建仍报告环境代理提示和 vinext 静态路由未分类提示，未隐藏为无警告。

Dogfood 必做：`test/support/source-truth-browser-matrix.mjs` 使用真实 PostgreSQL、HTTPS Git、浏览器 OPFS，访问 `http://127.0.0.1:3188/`；Web 进程 cwd 核对为当前 `f001-source-truth/web`。非生产服务，主应用认证与来源认证均为 fixture 令牌。8 旅程报告及 6 张截图全部读取；新差异页的基线、移除来源标签及非文件删除提示可见。移动端截图是全页合成，不能据此声称 sticky 操作条在所有滚动位置都无遮挡；已有本页无横向溢出、当前节点可见断言通过。

新截图 `browser/delta-removed-source.png` SHA-256：`327780a391dc5ef060cec603eda53161330330e7c9ca6a1f9c609c6df03dd706`。原报告 SHA-256：`1f5b08510f56c7041a3ee1256184c4a4ad7902b1fed60799c98bf8adfc0af7f0`。

五轴风险：行为为比较选择可见性；数据仅只读投影，无迁移；安全/鉴权不变；沿用服务端 Delta 契约；无不可逆操作。架构边界不变。当前 worktree 的设计文件检索没有 `.pen`，不伪称 Pencil 对照通过。Traqen 未注册的 Clowder 专用检查不作为伪造通过项。

仍未完成：原生目录选择器、100k 浏览器 UI/采集负载、受保护且物理独立的主备存储部署验收、双独立 exact-HEAD 审阅及合入。已有 39d 当前 100k 服务试点、旧成功和失败报告均保留；这些证据不替代上述剩余范围。
