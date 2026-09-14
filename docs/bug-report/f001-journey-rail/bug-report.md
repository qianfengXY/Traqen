> 语言：**简体中文** · [English](bug-report.en.md)

---
feature_ids: [F001]
topics: [browser, journey, responsive-layout]
doc_kind: bug-report
created: 2026-09-07
---

# F001 窄屏旅程定位

作者诊断：砚砚 / gpt-6-astra；不是独立审阅或完整功能验收。

## 诊断与根因

文件 B §10.1 要求流程图在自身容器内横向滚动，并定位当前站。`9955570` 的两个返回按钮只重置所选节点，没有滚动容器；窗口缩窄时也没有重定位。

在真实工作台通过隔离 API 创建目录任务，停在第 7 站。390px 视口下，流程图可见横坐标为 51–339，第 7 站为 555–639。点击“回到当前”后等待 4 秒，`scrollLeft=0`，节点仍不可见，行为断言 exit 1。页面宽度仍为 390px，所以不是全局导航或页面横向溢出问题。

## 修复与验证

- `revealSourceStation` 只把目标站的被裁剪部分滚入当前流程图，不滚动文档、不移动键盘焦点。
- 顶部及底部返回按钮都调用定位；即使已经选中当前站、React 状态没有变化，也能返回。
- 所选站变化、首次加载及容器缩放时重新定位；目标已可见则不滚动，卸载时断开尺寸观察。
- 同一浏览器断言 GREEN：`scrollLeft=300`，第 7 站为 255–339，完整可见。底部返回、1280→390 缩放、未来节点不提供冻结动作、导航不发写请求均通过。
- 来源快照 Web 测试 19/19；定向 strict ES2017 类型检查 exit 0；零警告 lint exit 0。首次 lint 指出多余 effect 依赖，移除后复验通过；未修改或关闭规则。

可重放脚本：`test/support/source-truth-rail-browser.mjs`。先用受托管的隔离 fixture 启动 API 3187 和当前工作树 Web 3188，再传入已安装 Playwright 模块、Chromium headless 可执行文件及临时证据目录三个绝对路径参数。脚本既检查按钮行为，也记录是否发起写请求，原行为下会失败。

## 证据边界

本次使用 Playwright 1.61.1、Chromium headless shell 1234、PGlite 测试记录与独立临时内容存储。OPFS 提供真实目录句柄，替代原生选择器的返回值；不证明原生 OS 文件选择器、Git 浏览器采集、真实 PostgreSQL 部署或灾备。RED/GREEN 原件分别在临时目录 `traqen-f001-browser-acceptance.nPLEtj` / `traqen-f001-rail-green.7YdaD1`，关键坐标与退出结果已在本记录固定，不依赖临时目录长期存在。早前临时环境在主机重启后消失，本轮重新复现而非声称旧截图仍在。

预览服务为 `running/origin=launchd`，HTTP 200；Hub 投递为 `unconfirmed/no_matching_client`，未声称面板已打开。无 `.pen` 设计稿；依据文件 B 的窄屏行为合同验证，不修改 F005 全局导航。

五轴风险：仅工作台可见区域行为改变；不修改数据、鉴权、外部接口、冻结逻辑或存储。定向检查仅证明此处修复；整仓 29 项类型错误、Git 总缓存控制及其余浏览器/运行验收仍需处理，F001 未完成。
