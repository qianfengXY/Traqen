---
feature_ids: [F007]
topics: [architecture, diagram-source]
doc_kind: diagram-source
created: 2026-09-20
status: discussion-draft-not-final
---

# 文档 v0.1 原始流程定义

保留修改前的两段关系定义供核对，不依赖 Mermaid 渲染。正文以可直接显示的 PNG 为展示入口。这里使用 text 代码块存档，内容原样保存。

## §2.2 运行单元与信任边界

```text
flowchart LR
  User[授权用户] --> Web[Web 工作台 / 操作 CLI]
  Sources[Git / 受托目录] --> Source
  subgraph Platform[Traqen 平台逻辑边界]
    API[接入与授权]
    Source[F001 来源治理]
    Access[受控材料读取入口 / 接口待对齐]
    Facts[F002 确定性事实]
    Jobs[持久作业与 F003 调查编排]
    Govern[命题与关系核查 / 人工决定]
    Ingest[执行证据验签与入库]
    Views[图谱 / 追溯 / 影响投影]
    DB[(结构化记录)]
    Bytes[(不可变来源字节)]
    API --> Source
    Source --> Bytes
    Source --> DB
    Source --> Access
    Access --> Facts
    Access --> Jobs
    Facts -->|版本化事实与限制| DB
    Jobs -->|运行与任务记录| DB
    Facts <-->|定向取证 / 依据与限制| Jobs
    API --> Jobs
    Jobs --> Govern
    API --> Govern
    Govern --> DB
    Ingest --> DB
    DB --> Views
    Views --> API
  end
  Web <-->|操作 / 结果| API
  Jobs <-->|固定配置 / 有界任务与返回| CLI[授权模型 CLI 进程]
  CLI <-->|获准上下文 / 模型输出| Model[模型服务边界]
  API -.->|执行任务传输待定| Runner[受控测试 Runner]
  Runner -->|签名证据| Ingest
  Runner <-->|白名单内测试与观察| Target[被测环境]
```

## §3.3 调查、核查、分流入图与人工回流

```text
flowchart TD
  Start[选择合格来源 / F002 参考版本 / 调查重点] --> Check[预检并读取 F006 生效配置摘要]
  Check --> Changed{首次或生效版本变化}
  Changed -->|是| Confirm[用户确认当前生效配置]
  Changed -->|否| Pin[服务端复验 / 固定输入创建 Run]
  Confirm --> Pin
  Pin -->|配置 Head 冲突 / 保留调查输入| Check
  Pin -->|成功| Ledger[建立材料与覆盖账本]
  Ledger --> Investigate[Main 规划和回读 / Child 调查取证]
  Investigate --> Merge[形成具体命题 / 去重与冲突编组]
  Merge --> Verify[核查引用 权限 版本 条件及语义支持]
  Verify -->|支撑充分 条件明确 无未决冲突| Auto[自动收录 / Agent 分析态]
  Verify -->|关键证据不足| More[有预算与停止条件的补证]
  More --> Investigate
  More -->|仍不确定| Human[一问题一卡 / 人工审核]
  Verify -->|规则或归属歧义| Human
  Verify -->|尚无可靠解释| Pending[保留材料 / 待调查]
  Verify -->|无效引用 越权 版本混用| Isolate[隔离 / 修复后按条件重试]
  Human -->|确认或修正并通过校验| Publish[限定命题或关系的图谱修订]
  Human -->|补证或回答| Investigate
  Human -->|否决或暂缓| Record[留痕 / 不强制创建成立主张]
  Auto --> Graph[同一图谱的业务 实现 覆盖视图]
  Publish --> Graph
```
