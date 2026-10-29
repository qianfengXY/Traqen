import test from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "./support/render-components.mjs";
const { GraphView } = await import("../app/business-knowledge/graph-view.tsx");
const { RelatedBusinessObjects } = await import("../app/business-knowledge/trace-panel.tsx");

const isolated = name => ({ key: "invalid", kind: "RULE", name, state: "QUARANTINED", authority: "AGENT_ANALYSIS",
  scope: "invalid model output", uncertainties: [], evidence: [], technicalRefs: [], verification: null });

test("isolated output has an honest map, card and keyboard label without changing the graph", () => {
  for (const name of [null, undefined, "unsafe model name", { invalid: "model name" }]) {
    const node = isolated(name), graph = { view: "IMPLEMENTATION", nodes: [node], edges: [], materials: [],
      coverage: [], adoptedVersionIds: [], uncertaintyCount: 1 };
    const before = structuredClone(graph);
    const html = renderComponent(GraphView, { graph, selectedKey: node.key, onSelect() {}, onMaterial() {} });
    assert.match(html, /aria-label="查看无效输出 · 已隔离"/);
    assert.match(html, /<b>无效输出 · 已隔离<\/b>/);
    assert.match(html, /tabindex="0"/);
    assert.doesNotMatch(html, /查看null|查看undefined|unsafe model name|invalid model output/);
    assert.deepEqual(graph, before);
  }
});

// This is the actual material-to-business listing rendered by TracePanel.
// HTTP/current permission/original-byte checks remain in its existing caller;
// this focused rendering check does not claim a browser or HTTP journey.
test("the material reverse-trace listing names and selects each isolated item by its original key", () => {
  const nodes = [null, undefined, "unsafe model name", { invalid: true }].map((name, i) => ({ ...isolated(name), key: `invalid-${i}` }));
  nodes.push({ ...isolated("有效业务规则"), key: "valid", state: "ANALYSIS_ACCEPTED" });
  const before = structuredClone(nodes), selected = [], props = { nodes, onSelect: key => selected.push(key) };
  const html = renderComponent(RelatedBusinessObjects, props);
  assert.equal((html.match(/>无效输出 · 已隔离<\/button>/g) ?? []).length, 4);
  assert.match(html, />有效业务规则<\/button>/);
  assert.doesNotMatch(html, /unsafe model name|>null<|>undefined<|<button[^>]*><\/button>/);
  const buttons = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.type === "button") buttons.push(value);
    visit(value.props?.children);
  };
  visit(RelatedBusinessObjects(props));
  assert.equal(buttons.length, nodes.length);
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(selected, nodes.map(node => node.key));
  assert.deepEqual(nodes, before);
});
