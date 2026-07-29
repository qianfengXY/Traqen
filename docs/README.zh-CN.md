> 语言：**简体中文** · [English](README.md)

# 文档

Traqen 的产品与工程文档同时维护英文和简体中文版本。两个版本必须表达相同的产品意图、约束、实现状态和运行指南。

## 文档导航

- [Feature 路线图](ROADMAP.zh-CN.md) · [English](ROADMAP.md)
- [F001：服务端拥有的 Workspace 扫描与 Analysis 生命周期](features/F001-server-owned-workspace-scan-and-analysis.zh-CN.md) · [English](features/F001-server-owned-workspace-scan-and-analysis.md)
- [架构与产品设计](architecture/enterprise-traceable-quality-platform-design-v0.2.md) · [English](architecture/enterprise-traceable-quality-platform-design-v0.2.en.md)
- [本地 Workspace 分析与功能树](features/workspace-analysis-design.zh-CN.md) · [English](features/workspace-analysis-design.md)
- [服务端拥有的 Workspace 扫描与 Analysis 生命周期](features/workspace-scan-and-analysis-lifecycle.zh-CN.md) · [English](features/workspace-scan-and-analysis-lifecycle.md)
- [核心分析 Agent](features/analysis-agent-design.zh-CN.md) · [English](features/analysis-agent-design.md)
- [Clowder AI 真实仓库 Workspace 验证](implementation/clowder-ai-workspace-analysis-2026-07-18.zh-CN.md) · [English](implementation/clowder-ai-workspace-analysis-2026-07-18.md)
- [实现验证记录](implementation/)
- [项目概览与运行指南](../README.zh-CN.md) · [English](../README.md)

## 双语文档策略

任何新增或修改文档的拉取请求，都必须在同一次变更中新增或更新中英文两个版本。

- 新文档优先使用英文规范文件名，例如 `guide.md`，对应的简体中文文件命名为 `guide.zh-CN.md`。
- 如果现有中文文档已经占用稳定的规范路径，则保留该路径，并添加名为 `guide.en.md` 的英文版本。当前架构设计文档采用此兼容规则。
- 每对文档开头都必须提供语言切换链接，并指向另一语言版本。
- 代码、命令、API 路径、标识符、枚举值、配置键和产品模型名称保持不变，除非文档明确说明本地化显示名称。
- 产品愿景、产品护栏、安全边界、验收状态和已知限制在两个版本中的含义必须等价；翻译不得削弱或扩大要求。
- 两个版本必须同步更新。如果其中一个版本无法准确更新，则该文档变更不得合并。

自动化测试 `test/bilingual-documentation.test.js` 会检查 `docs/` 下的 Markdown 文件和仓库 README 文件是否成对存在，并验证语言切换链接。
