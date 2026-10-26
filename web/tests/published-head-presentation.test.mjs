import test from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "./support/render-components.mjs";
const { WorkspaceOverview } = await import("../app/product-surfaces.tsx");
const props = {
  t: (zh) => zh,
  workspace: { id: "workspace", name: "Workspace" },
  job: null,
  reviewCount: 0,
  impactCount: 0,
  configValid: true,
  onNavigate: () => {},
};
const current = {
  head: {
    projectId: "workspace",
    graphRevisionId: "exact-revision",
    version: 2,
    updatedAt: "2026-10-23T00:00:00Z",
  },
  revision: {
    id: "exact-revision",
    projectId: "workspace",
    kind: "BUSINESS_KNOWLEDGE",
    status: "PUBLISHED",
  },
};
test("overview recognizes the server F003 revision type and links its exact published knowledge rather than a legacy mode", () => {
  const html = renderComponent(WorkspaceOverview, { ...props, current });
  assert.ok(!html.includes("undefined"));
  assert.ok(html.includes("BUSINESS_KNOWLEDGE · r2"));
  assert.match(
    html,
    /href="\/\?page=graph&amp;workspace=workspace&amp;knowledge=published&amp;publishedRevision=exact-revision"/,
  );
  assert.ok(!html.includes("view=legacy"));
});
test("legacy published heads keep their explicit mode and exact legacy graph route", () => {
  const html = renderComponent(WorkspaceOverview, {
    ...props,
    current: {
      ...current,
      revision: { ...current.revision, kind: undefined, mode: "INCREMENTAL" },
    },
  });
  assert.ok(html.includes("INCREMENTAL · r2"));
  assert.ok(html.includes("view=legacy"));
  assert.ok(!html.includes("knowledge=published"));
});
test("unknown or cross-version heads are not displayed as a successful publication or routed to a guessed graph type", () => {
  for (const c of [
    { ...current, revision: { ...current.revision, kind: "FUTURE_KIND", mode: "FULL" } },
    { ...current, revision: { ...current.revision, id: "another" } },
    { ...current, head: { ...current.head, projectId: "foreign" } },
  ]) {
    const html = renderComponent(WorkspaceOverview, { ...props, current: c });
    assert.ok(html.includes("发布类型或版本绑定未知"));
    assert.ok(!html.includes("undefined"));
    assert.ok(!html.includes("publishedRevision="));
    assert.ok(!html.includes("view=legacy"));
    assert.ok(!html.includes('status-light "'));
  }
  const empty = renderComponent(WorkspaceOverview, { ...props, current: null });
  assert.ok(empty.includes("尚未发布"));
  assert.ok(!empty.includes("发布类型或版本绑定未知"));
});
