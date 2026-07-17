> 语言：**简体中文** · [English](workspace-analysis-design.md)

# 本地 Workspace 分析与功能树

## 实现愿景

用户可以自定义 Workspace、选择一个代码工程，在不上传源码的前提下自行扫描，查看工程中发现的全部能力形成的功能树，并对每一个功能查看五段式追溯。扫描发现不能静默地把实现观察晋升为已确认的业务真相。

## 用户流程

1. 输入 Workspace 名称与稳定的 Project ID。
2. 通过浏览器目录选择器选择本地代码工程。
3. Traqen 只在当前浏览器页签内存中读取受支持的文本文件；源码和结果都不持久化，完整刷新浏览器页面后消失。
4. 本地扫描器发现 Spring MVC/WebFlux 和 JAX-RS 接口、Java 后端组件与接口方法、HTTP 路由、OpenAPI JSON 操作、JavaScript/TypeScript 导出能力和 `package.json` 命令。
5. 结果按照“Workspace → 模块 → 发现类型 → 候选 Feature”组织成功能树。
6. 点击候选功能后，展示功能描述、设计源码、配置线索、关联测试、测试结果、独立可信维度和 TraceGap 责任归属。

## Workspace 生命周期与全局导航

- 扫描用于初始化当前 Workspace；它不是仅属于“Workspace 分析”页面的一份孤立报告。
- 初始化后的 Workspace 名称、Project ID、功能树、当前功能、当前追溯块和树展开状态由产品级会话统一持有，在各产品页面之间切换时不会丢失。
- “功能追溯”直接复用初始化得到的功能树。点击任一功能即可查看该候选的五段追溯链，不需要重新扫描。
- “Workspace 分析”保留为初始化和重新扫描入口；“功能追溯”是逐项审核候选功能的主要工作界面。
- 连接 API 后可以临时查看服务端派生的 Feature；返回自 Workspace 时恢复本地初始化的功能树和选择位置。
- 这种连续性有意限定在当前浏览器页面会话内。完整刷新页面仍会清除源码派生数据，因为 Traqen 不把本地源码或片段写入浏览器存储。

## 可信边界

- 扫描发现项是实现候选，不是规范性 Feature。
- 在授权人员确认业务说明、权限、前置条件、依赖、适用范围和例外前，业务权威保持 `PENDING`。
- 在实现映射经过审核前，源码到 Feature 的符合性保持 `PARTIAL`。
- 关联测试文件只是线索，不是已批准 TestSpec。
- 扫描不会执行工程代码。在可信 Runner 针对所选 Snapshot 和部署回传签名 Evidence 前，验证结果保持 `NOT_RUN`。
- 缺少业务权威、实现审核、TestSpec 或当前执行时，必须保留明确的阻断级 TraceGap。

## 本地安全限制

- 忽略依赖、版本控制、构建产物、覆盖率和 vendor 目录。
- 对受支持文件进行有界分批处理，不设置工程级文件数量或总字节上限，使十万级文件工程不再因人为上限而必须拆分扫描。
- 只保留已发现的功能索引、有界的源码/测试片段和最多 12 份脱敏配置线索，不在内存中保留完整源码树。
- 单个受支持文本文件最多读取 768 KB。
- 功能树按需展开，未打开的模块和发现类型不会一次性在页面中创建全部叶子节点。
- 排除真实 `.env` 变体，仅允许环境模板，并在展示前脱敏配置中的疑似密钥值。
- 不向托管的 Traqen 站点上传源码，也不把源码写入浏览器存储。

## 当前发现范围

扫描器识别 Spring `@RequestMapping` 和各 HTTP 方法映射，并合并类级与方法级路径；识别 JAX-RS `@Path` 与 HTTP 注解；识别 Java Controller、Service、Repository、Component、定时任务、消息/事件监听方法、接口方法以及公开/受保护的后端方法；关联 Maven/Gradle 与 application 配置线索和 Java 测试源码。同时继续识别常见 JavaScript/TypeScript 导出能力、Python 函数、C# 公共方法、Go 函数、Rust 公共函数、HTTP 路由注册、OpenAPI JSON 路径和 npm scripts。Java 生成目录 `target`、`out` 与 Gradle 缓存仍会被排除。
