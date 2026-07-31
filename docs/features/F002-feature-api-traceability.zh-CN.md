> 语言：**简体中文** · [English](F002-feature-api-traceability.md)

---
feature_ids: [F002]
related_features: [F001, F003, F004, F005]
topics: [feature-tree, api-tree, traceability, history, evidence-gaps]
doc_kind: spec
created: 2026-07-31
---

# F002：功能与 API 追溯

> **Status**: spec | **Owner**: TBD | **Priority**: P0

## Why

只有当人能够选择当前 Feature 或 API，核对其需求、设计、实现、数据、配置、测试与结果是否形成完整证据链时，对存量工程的理解才真正有价值。

## What

F002 负责同一 Canonical Graph 上两种 Workspace 级投影：

- **Feature Tree：** 用户可识别能力与受治理 Feature 身份；
- **API Tree：** Endpoint、Contract、Handler、Caller、数据/配置影响、测试与结果。

两棵树默认读取最新发布的 `CurrentGraphHead`。活跃分析产生的 Working Candidate Tree 必须独立展示，绝不能冒充 Governed Tree。

## 用户旅程

1. 用户切换 Workspace，Feature/API Tree 在该 Workspace Context 下重新加载。
2. 用户选择 Feature 或 API。
3. 详情展示需求、设计、代码范围、数据、配置、测试文件、TestSpec、执行、结果、Decision、冲突与 Gap。
4. 缺失或过期证据按类别和严重级别清晰可见。
5. 用户打开历史，对比受治理 FeatureVersion 及按 Snapshot 记录的实现映射；Tree 默认仍显示最新版本。

## 完成态合同

- 每条可见关系都能解析到不可变 Evidence 或 Decision；
- 最新与历史视图使用相同 Identity/Lineage 规则；
- 代码变化可以更新实现映射和影响，但不能自动创建业务 FeatureVersion；
- 测试文件、TestSpec、执行、结果与 Evidence 必须保持不同对象；
- API Tree 不是第二套 Graph Store。

## 验收标准

- [ ] 切换 Workspace 会原子切换两棵树、选中详情、历史与订阅。
- [ ] 默认 Tree 读取最新 Published Head，并单独标记 Working Candidate。
- [ ] 选中 Feature/API 后，所有必需证据类别都有 `MISSING`、`STALE`、`CONFLICTED` 或 `NOT_APPLICABLE` 状态。
- [ ] 每个源码摘录都绑定 Snapshot，并通过内容 Digest 校验。
- [ ] Feature 历史按时间展示 FeatureVersion Decision、实现映射、影响、审核、测试、结果与 Gap。
- [ ] API 历史保留 Contract 与实现变化，但不能发明业务身份。
- [ ] Live Workspace 中不能出现 Demo Fallback。

## 当前差距

实现提交 `1682d7d` 已有 Candidate Feature/API 模式及追溯/历史 API，但主 UI 没有消费 Feature History API，并且仍混合本地 Candidate Projection、Live 与 Demo 路径。

## 依赖

- F001 提供 Workspace、Snapshot、Candidate、对账和 Published Graph 基础。
- F003 展示同一选中对象及路径。
- F004 治理证据不足或自动结果。
- F005 关联变化历史与影响。

## 非目标

- 从 Tree Label 生成业务真相；
- 为简化 UI 隐藏缺失证据；
- 存储独立的 Feature Tree 数据库。
