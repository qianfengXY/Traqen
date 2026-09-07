> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001, F002, F006]
topics: [typescript, integration, validation]
doc_kind: bug-report
created: 2026-09-07
---

# F001 整仓 Web 类型门禁

报告人：砚砚 / gpt-6-astra。F001 集成自检，不是独立审阅或功能完成报告。

## 诊断胶囊

| 栏位 | 记录 |
| --- | --- |
| 现象 | 构建、84 项 Web 测试和 F001 单独类型检查通过，但整仓严格类型检查仍有 29 个错误。 |
| 证据 | 固定 `b222cda7fd0459b05414699beec43a8fd3499954`；`./web/node_modules/.bin/tsc --project web/tsconfig.json --noEmit` exit 2。托管整组 exit 1；后端 560/560、Web 84/84、source types、lint、2000 文件试点和 diff-check 分别 exit 0。 |
| 根因 | 有效能力与全局能力 Props 被交叉；原始候选误要求归一化阶段才生成的证据字段；对象属性别名未完成非空收窄；map 字面量与动态 Gap 字段丢失上下文类型；自动保存有一条裸 return；请求头联合含可选 undefined；Worker 引用不存在的环境全局 Fetcher。 |
| 诊断策略 | 实读全部 29 个编译诊断，追踪输入、归一化和渲染边界；对照现有 RawCandidate、其他请求头辅助函数，以及搬砖工 F006 提交 `0b1ce852b9a14b7c0f5e83385c39a84b0ebc3252`。 |
| 超时策略 | 单次类型检查预期秒级；修复后若仍有同类错误，先读具体调用链，不通过排除文件或关闭 strict 缩小门禁。 |
| 预警策略 | 不使用 any、ts-ignore 或虚构证据；不导入 F006 的额外 CLI/Skill 行为，不把未合入的其他功能修复整包带入。 |
| 用户交互 | 不改变 UI 或 API 数据；自动保存的过期响应明确返回 false，与其他失败路径一致，不显示保存成功。 |
| 验收 | 已有整仓 typecheck 是 RED；修复后同一命令 exit 0，Web 构建及 84/84 测试、零警告 lint、双语文档 2/2 分别 exit 0，无跳过。 |

## 归属与修复范围

这是 F001 自有分支的集成修复。已向 F006 owner thread 和 F002 平行 owner thread 发出精确范围 Claim；不转移其设计或实现责任。共享架构与文件 B 不改。

保留 `b222cda` 的类型失败事实。2000 文件校准不替代 `bcb21ac` 的历史 100k 通过，也不消除之前两次 100k 超时。

## 修复与验证

- AgentSettings 用 Omit 替换父 Props 的 capabilities 字段，不再要求一项同时属于全局和有效能力类型。
- 原始扫描、文件记录、聚合 Map 统一使用已存在的 RawCandidate；归一化函数仍负责真实生成 nodeType、governedFeatureId 和 evidenceFactIds。合并结果以 map 泛型保持 LocalCandidate 字面量类型。
- 缓存命中条件直接收窄 analysis；Gap 保留 Record 的未知字段与确定的 id/status；请求头声明为字符串字典；Worker 仅声明实际使用的 Request → Promise<Response> 绑定接口。
- 过期自动保存返回 false，不改变其他失败、CAS 或状态回写规则。没有改动 tsconfig、依赖、API 协议或运行时授权。

`tsc --project web/tsconfig.json --noEmit`：29 个错误 / exit 2 → 0 个错误 / exit 0。`npm --prefix web test` 重新构建后 84/84、零跳过；`npm --prefix web run lint -- --max-warnings 0` exit 0；双语检查 2/2。纯静态边界修复的定向自检，不表示整个 F001 已完成浏览器与独立审阅验收。

本轮完整读取 `b222cda` 后端日志 576 行及 Web、types、pilot、lint 日志；空 source-types/diff 日志结合各自 exit 0 判定。其 2000 文件最终 report 已归档到同级 Git 容量报告目录的 `pilot-2000-b222cda.json`：三版冻结，目录增量 36 字节，离线重放通过；44 次采样、tree RSS 306,429,952 字节、FD 424、采样错误 0。browserVerified 与 disasterDeploymentVerified 均为 false。后端未受本轮静态修改影响，其 560/560 证据仍明确属于 b222cda，不冒充新提交整仓重跑。
