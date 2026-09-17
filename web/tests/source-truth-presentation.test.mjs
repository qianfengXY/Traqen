import assert from "node:assert/strict";
import test from "node:test";
import { renderComponent } from "./support/render-components.mjs";

const { EmptyWorkspace } = await import("../app/product-surfaces.tsx");
const { WorkspaceConnection } = await import("../app/workspace-connection.tsx");
const { SourceTruthWorkbench, SourceAccessState } = await import("../app/source-truth/workbench.tsx");
const { SourceClientError } = await import("../app/source-truth/client.ts");
const t = (zh) => zh;
const noop = () => {};
const connection = { t, checking: false, issue: "authentication", apiBase: "/api", token: "", onToken: noop, onConnect: noop, onDiagnostics: noop };

test("rendered authentication and forbidden states are not workspace creation", () => {
  for (const [issue, text] of [["authentication", "需要访问令牌"], ["forbidden", "当前身份无权访问"], ["unavailable", "暂时无法读取 Workspace"]]) {
    const html = renderComponent(WorkspaceConnection, { ...connection, issue });
    assert.match(html, new RegExp(`<strong>${text}</strong>`));
    assert.match(html, /role="alert"/);
    assert.match(html, /id="workspace-access-token"/);
    assert.doesNotMatch(html, /class="onboarding/);
  }
});

test("checking keeps the rendered recovery controls visible", () => {
  const html = renderComponent(WorkspaceConnection, { ...connection, checking: true, issue: null });
  assert.match(html, /role="status"/);
  assert.match(html, /id="workspace-access-token"/);
  assert.match(html, /<button[^>]*>连接设置<\/button>/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("rendered onboarding retains the name, error and source-first semantics", () => {
  const props = { t, workspaceName: "Retained name", setWorkspaceName: noop, working: false, onCreate: noop };
  const html = renderComponent(EmptyWorkspace, { ...props, error: "Creation unconfirmed" });
  assert.match(html, /<section class="onboarding panel">/);
  assert.match(html, /<h1>新建 Workspace<\/h1>/);
  assert.match(html, /role="alert">Creation unconfirmed<\/p>/);
  assert.match(html, /value="Retained name"/);
  assert.match(html, /来源快照/);
  assert.doesNotMatch(html, /FULL 分析|immutable execution profile/);
  assert.doesNotMatch(renderComponent(EmptyWorkspace, props), /role="alert"/);
  assert.match(renderComponent(EmptyWorkspace, { ...props, working: true }), /<button[^>]*disabled=""[^>]*>正在创建…<\/button>/);
});

test("source workbench renders a pending access state before any reads complete", () => {
  const html = renderComponent(SourceTruthWorkbench, { apiBase: "/api", apiToken: "", workspaceId: "TEST", workspaceName: "Test" });
  assert.match(html, /aria-label="来源快照工作台"/);
  assert.match(html, /role="status">正在验证来源访问权限和存储状态…<\/p>/);
  assert.doesNotMatch(html, /来源访问尚未就绪|保存来源，确认范围/);
});

test("rendered source access failures explain permission binding without an empty-state or perpetual spinner", () => {
  for (const error of [new SourceClientError("Denied", "SOURCE_FORBIDDEN", 403), new Error("Offline")]) {
    const html = renderComponent(SourceAccessState, { error });
    assert.match(html, /<h2>来源访问尚未就绪<\/h2>/);
    assert.match(html, /不代表没有材料或任务/);
    assert.doesNotMatch(html, /role="status"|保存来源，确认范围/);
    if (error.status === 403) assert.match(html, /来源权限需要管理员绑定到当前成员和 Workspace/);
    else assert.match(html, /不会重复创建任务，也不会修改既有版本/);
  }
});
