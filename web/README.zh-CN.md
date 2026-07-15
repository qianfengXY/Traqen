> 语言：**简体中文** · [English](README.md)

# Traqen 网页

Traqen 的证据优先 Feature 可追溯模型的产品表面。

默认屏幕是订单提交垂直切片的明确标记的综合演示。它显示了完整的当前部署证明链和更改的代码场景，其中只有实现派生层变得过时。连接面板可以从真实的 Traqen API 加载服务器衍生的 Feature 可追溯性视图；浏览器从不计算替换信任分数。

## 产品表面

- Feature具有独立权威、一致性、验证、新鲜度、冲突维度的可追溯性。
- 有序 Claim → Scope → Decision → implementation/data/config → TestSpec → 断言 → 执行 → Evidence 链。
- 可见的 TraceGap 所有权以及阻止功能显示为完整的原因。
- 语句级审核，加载真实的反向运行候选者并提交经过身份验证、服务器验证的 Decision，而不接受客户端提供的审核者身份。
- 历史 Snapshot 比较由不可变的 ChangeSet API 支持，包括保留的规范事实、无效的派生层和修复队列。
- 授权实施修复，将新的 Snapshot 反向候选链接回现有 Claim 并仅恢复实施一致性段。

## 当地发展

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
npm test
```

本地 Traqen API 默认为端口 3000，因此在 Web 预览处于活动状态时在另一个端口上运行它：

```bash
PORT=3100 CORS_ALLOWED_ORIGINS=http://localhost:3000 npm run api:dev
```

然后在产品标题中使用“连接 Traqen API”，并提供项目、Feature 和 Snapshot 清单 ID。已部署的 Web 源必须在 `CORS_ALLOWED_ORIGINS` 中明确列出；通配符来源被拒绝。

## 信任边界

演示审核按钮从不坚持商业真理，并进行相应的标记。加载真正的候选者后，正式审核需要一个不记名令牌，该令牌保留在页面内存中，并在成功后被清除；审阅者身份和角色仍然仅来自服务器。 TestSpec 批准、跟踪重新计算和 Evidence 摄取仍然是服务器授权的工作流程。 UI 使用服务器派生的 Feature 可追溯性和 ChangeSet 合约，而不是从客户端数据推断完整性或影响。
