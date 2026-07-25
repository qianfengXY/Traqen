> 语言：**简体中文** · [English](feature-evolution-validation-2026-07-15.md)

# Feature 进化验证 — 2026-07-15

此增量实现了设计要求，即 Feature 必须能够承受重命名、别名、合并和拆分，而不依赖于显示名称或代码位置来进行标识。

## 受管制的行为

- 新的稳定 Feature ID 从版本 1 开始；后来的名称和描述一次只推进一个不可变的版本。
- 别名绑定到确切的 Feature 版本。 Unicode 规范化、不区分大小写的别名键在项目内是唯一的，因此导入和搜索无法将一个标签解析为两个 Features。
- `PREDECESSOR_OF`、`SUCCESSOR_OF`、`MERGED_INTO` 和 `SPLIT_INTO` 谱系边缘保留其经过验证的人类演员、角色、基本原理和时间戳。
- 两个沿袭端点必须已存在于同一项目中。自链接、重复的不可变边、悬空端点和循环都会被拒绝。
- 演员身份和时间由服务器分配。配置的 `allowedFeatureGovernanceRoles` 策略无法关闭别名和沿袭写入。

## 持久性和 API

- 迁移 `0012_feature_evolution.sql` 扩展了现有 `feature_lineage` 关系并添加了版本绑定的 `feature_alias` 表。
- 内存和 PostgreSQL 存储实现相同的仅附加语义。
- `POST/GET /v1/projects/{projectId}/features/{featureId}/aliases` 管理受管理的别名。
- `POST/GET /v1/projects/{projectId}/feature-lineages` 追加或查询演化图； GET 接受可选的 `featureId` 过滤器。

## 验证

- Domain/application 测试涵盖顺序版本控制、别名标准化、人工归因和循环拒绝。
- HTTP 测试涵盖身份验证和读取集合。
- PostgreSQL 测试适用于每个迁移和往返别名和沿袭。
- OpenAPI 和 JSON Schema 合约公开了所有四个谱系关系和服务器拥有的治理领域。
