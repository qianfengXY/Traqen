> 语言：**简体中文** · [English](evidence-lifecycle-validation-2026-07-15.md)

# Evidence 生命周期验证 — 2026-07-15

## 设计义务

Evidence 必须保持可验证性，且不能永远保留可识别的原始内容。保留因 tenant/project 分类和 Evidence 类型而异；合法保留必须阻止删除；归档、访问、导出、物理删除和删除证明必须是可审计的。

## 实施模型

`EvidenceRetentionPolicy` 是不可变的和版本化的。它命名数据分类、涵盖的 Evidence 类型、存档截止日期、保留截止日期、默认合法保留行为以及允许访问或导出派生 Evidence 的角色。权限身份是服务器拥有的。

`EvidenceLifecycleEvent` 仅用于附加并支持：

- `ARCHIVED`
- `LEGAL_HOLD_PLACED` / `LEGAL_HOLD_RELEASED`
- `DELETION_REQUESTED` / `DELETED`
- `ACCESSED` / `EXPORTED`

生命周期投影重播事件并独立公开存档状态、删除请求、合法保留、删除证明和访问计数。合法保留下的删除请求将变为 `DELETION_BLOCKED_LEGAL_HOLD`。在请求之前或保留处于活动状态时无法记录物理删除。 `DELETED` 需要 SHA-256 证明和存储提供商身份。

## Raw/derived 边界

Runner-摄取的 Evidence 清单已经经过敏感字段编辑和哈希绑定。 Large/raw 加密对象由 `storageUri` 引用并保留在企业 object/file 存储中。 Traqen 记录生命周期意图和证据；企业存储适配器执行归档或删除。删除后，不可变的 Evidence 哈希值、派生清单、策略参考、事件历史记录和不可逆删除证明将保留，而原始外部字节则不会。

存储库不会假装其 PostgreSQL 元数据行是加密的对象存储或 KMS。存储加密、短期对象授权、物理对象执行、密钥轮换和提供商合法保留实施仍然是部署集成。

## API 和坚持

- `POST /v1/projects/{projectId}/evidence-retention-policies`
- `POST /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle-events`
- `GET /v1/projects/{projectId}/evidence/{evidenceId}/lifecycle?policyId=...&policyVersion=...`

迁移 `0011_evidence_lifecycle.sql` 添加了不可变的 policy/event 表、参与者-租户检查、Evidence 和策略外键、追加顺序身份和突变拒绝。

## 验证

测试涵盖存档期限、保留期限、法律 Hold/deletion 冲突、删除请求排序、防删除验证、访问角色审核、HTTP 合同、PostgreSQL 排序和外键，以及原始验证的 Evidence 元数据的保存。
