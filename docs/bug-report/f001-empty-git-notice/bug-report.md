> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [source-truth, empty-git, browser-regression]
doc_kind: bug-report
created: 2026-09-11
---

# 空 Git 版本缺少明确确认提示

[English](bug-report.en.md)

报告人：砚砚 / gpt-6-astra。依据文件 B §8.2、B-13，在实现分支自检中发现；不是正式 review。

## 诊断胶囊

| 栏位 | 记录 |
| --- | --- |
| 现象 | 合法空 Git 可冻结并准入，但第 7/8 站和历史视图只有通用零计数，缺少“已确认空 Git 版本，0 个文件”。 |
| 证据 | 基线 7865227；四项浏览器报告 SHA256 `3e88b71bc6c9ec860f7b13e18cd7313a33cf45d4e55f9ce8815c8c6282a0b889`。报告、日志、两脚本指纹及四截图已核对，原测试没有覆盖提示。 |
| 根因 | query-service 的 run read model 已提供 nativeIdentity、manifestId、enumerationClosed 和 summary；workbench 仅渲染通用身份/计数，历史视图也没有空 Git 状态说明。不是后端空树失败或服务未更新。 |
| 诊断策略 | 对照文件 B、原浏览器截图、读取模型和实际渲染分支；新增第 7 站与历史视图精确文本断言。 |
| 超时策略 | 1.5 秒可见断言；未按缺失文本失败时先查实际调用点，不用反复重跑掩盖环境失败。 |
| 预警策略 | 未闭合、缺失 commit/manifest、目录输入、非空或阻断数据均不得显示确认空 Git；零计数不是充分证据。 |
| 交互修正 | 使用现有组件样式，明确已确认空 Git、精确 commit、范围和 manifest；不新增准入或自动分析能力。 |
| 验收 | 新增真实浏览器提示断言先 RED；修复后同一断言 GREEN，加负例回归、Web build/types/lint。原 4 项 PASS 只证明其已有断言，不覆盖本缺口。 |

## 范围

仅补已确认设计的功能表现，不修改设计、容量预算或权限合同。原生 picker、规模采集、正式 review 和部署验收不由此报告证明。100k 按 operator `0001789020316461-000158-b51cf784` 暂缓，保留原失败证据。

## 已执行的 RED

新增精确提示断言后，隔离 B-13 浏览器在 23 秒后 exit 1：第 7 站已有明确 commit、零文件/目录/字节、候选和未勾选的人工确认，唯独目标提示不存在。失败调用为 `source-truth-browser-empty.mjs:59`，不是枚举、权限或环境错误。

[完整 RED 报告](red-report.json) SHA-256 `1d97aaecdca6f2334837bdbae773e9b46af6f16094c46e07543a86fad1f3782f`；完整日志解析后与报告相等，日志 SHA-256 `5767f8e8882502ebc00e2ae69fd7122a2b9dbe49a44641dedb036e6245e0eb59`。RED 脚本指纹为 `a46337e9f48c6fe27b9baf393c846d77ae8ecd780de7a0f39da917d5ffb4867a`，原 4 项报告未覆盖该断言，不能替代它。

## 实现边界

`empty-git.ts` 仅投影服务端证据：Git 原生 commit/tree、闭合 manifest 与严格零条目/字节；活动来源还需无未处置条目、当前候选组件绑定和复核/冻结状态。缺失来源/对象/manifest、未闭合、失败、取消、目录和非空数据均不显示确认提示。组合包按组件判断，不将一个空 Git 组件等同于整个包无材料。

第 7/8 站保留人工确认与原操作；历史组件显示精确 commit、范围、空 manifest 摘要，并明确历史冻结不等于当前准入。没有改写后端、存储、Receipt、预算、权限或准入路径。

## GREEN 与作者质量门禁

2026-09-11，新隔离环境的托管命令 exit 0 / 204 秒。工作树父路径 `/Volumes/WorkSSD/projects/Traqen-worktrees/`，子路径 `f001-source-truth`；Web 为该 checkout 的 `http://127.0.0.1:3188/`，不是 Clowder runtime。PG、HTTPS Git 和 OPFS 均为独立 fixture；没有操作原试点或生产数据。

- `npm --prefix web test`：构建成功，94/94、零跳过；`tsc --noEmit --project web/tsconfig.json`、Web lint 均 exit 0。保留 npm 环境键、代理和 vinext 路由静态分类警告，不将警告写成编译错误或吞掉。
- [B-13 GREEN](green-report.json)：4/4，SHA-256 `79fc6e34a2ce10b36c334f44ec45e6c76f0dc8b63ba21b0ff6e7f0f023e9014c`。第 7/8 站与历史空 Git 提示、精确 commit/范围/manifest、全删除三页、旧历史不变、两种空目录拒绝和零字节文件正例均实际通过。
- [既有十二旅程](recovery-report.json)：12/12，SHA-256 `51330975d25d04a0de868cbcfa48dcbf832194f8eeea9675e9b5555dc5093d5c`，issues 为空；取消、失败重试、变更重选、绝对期限过期后的同候选重确认全部保留。
- 两份完整浏览器日志解析后与报告相等；日志 SHA-256 分别为 `aafc671bb7b16191ba40d2aca30862deec4b406b56654a8fb7bc80097b25564b`、`d67a87ad0c25064cd8d1e759d81b4de10e4f14ab4b533942e456ad5c14d79b84`。GREEN 报告内六个源码指纹逐项匹配当前文件。
- 作者已看完六张 B-13 截图：两张第 7 站、空首版、全删除及两个目录拒绝。提示可见，未勾选时确认仍禁用，未发布目录不冒充空 Git；全局旧 jobs 配置警告沿用已查明的 fixture 边界，没有隐藏它。
- 双语文档检查 2/2、`git diff --check` 通过；未发现 `.pen`，沿用当前工作台样式并对照文件 B，而不是修改原设计。工作树及提交差异的根目录无媒体工件。

五轴：behavior=低风险证据提示；data/security/contract/irreversible=本修复不改变。架构位置为既有来源快照 Web 投影，map delta=none，没有新增存储、路由或权限层。Clowder 专用 hotfix/fallback/ownership/tips 脚本在本外部项目不存在，不复制家内工具链或伪造通过。此次是作者自证，不是独立审查 verdict 或部署完成声明。

原始证据父路径 `/private/tmp/`，子路径 `traqen-f001-empty-notice-green.r3hshI/`；截图在其 `empty/` 内，构建/类型/lint 日志在根层。原 RED 与原四项 PASS 均保留，不能被 GREEN 覆盖。
