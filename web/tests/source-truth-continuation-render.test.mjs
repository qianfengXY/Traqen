import assert from "node:assert/strict";
import test from "node:test";
import { renderComponent } from "./support/render-components.mjs";
import { SourceTruthClient } from "../app/source-truth/client.ts";
const { SourceTruthWorkbench } = await import("../app/source-truth/workbench.tsx");
const { SourceVersionView } = await import("../app/source-truth/version-view.tsx");
const evidence = await import("../app/source-truth/evidence-view.tsx");
const { SourceForm } = await import("../app/source-truth/source-form.tsx");
const bundleId = "a".repeat(64);
const version = { id: bundleId, components: [], counts: { fileCount: "0", directoryCount: "0", knownBytes: "0", gapCount: "0" },
  identity: { inventoryId: "i", gapSetId: "g" }, publishedAt: "2026-10-13T00:00:00Z",
  latestReceipt: { id: "new-receipt", bundleId, status: "READY", gapCount: "0", gapSetId: "g", expiresAt: null } };

test("limited frozen results use warning semantics and a single contextual material-details sidebar", () => {
  const limited = { ...version, latestReceipt: { ...version.latestReceipt, status: "READY_WITH_ACCEPTED_GAPS", gapCount: "2" } };
  const html = renderComponent(SourceVersionView, { client: new SourceTruthClient("/api", "", "w"), version: limited, versions: [limited], writable: false, onChanged: async () => {} });
  assert.match(html, /class="st-callout warning">有限制可用/);
  assert.match(html, /aria-label="所选冻结版本的使用条件"[^>]*><section[^>]*data-material-details-host/);
});

test("a typed fixed-reference entry preserves its requested detail tab without sharing material paths in URLs", () => {
  const html = renderComponent(SourceVersionView, { client: new SourceTruthClient("/api", "", "w"), version, versions: [version], writable: false, onChanged: async () => {},
    entryContext: { mode: "REFERENCE", workspaceId: "w", bundleId, receiptId: "new-receipt", tab: "receipt" } });
  assert.match(html, /role="tab" aria-selected="true"[^>]*>Receipt</);
});

test("fixed source entry remains explicit and cannot silently turn into a capture or latest version", () => {
  const html = renderComponent(SourceTruthWorkbench, { apiBase: "/api", apiToken: "", workspaceId: "w", workspaceName: "W",
    entryContext: { mode: "REFERENCE", workspaceId: "w", bundleId, receiptId: "old-receipt" } });
  assert.match(html, /固定来源引用/);
  assert.match(html, /old-receipt/);
  assert.doesNotMatch(html, /保存来源，确认范围|创建新版本/);
});
test("a fixed historical receipt is unresolved until fetched, never substituted with latest", () => {
  const html = renderComponent(SourceVersionView, { client: new SourceTruthClient("/api", "", "w"), version, versions: [version],
    writable: false, fixedReceiptId: "old-receipt", onChanged: async () => {} });
  assert.match(html, /old-receipt/);
  assert.doesNotMatch(html, /new-receipt/);
});
test("version detail separates materials, gaps, receipt and history with real tab semantics", () => {
  const html = renderComponent(SourceVersionView, { client: new SourceTruthClient("/api", "", "w"), version, versions: [version], writable: false, onChanged: async () => {} });
  assert.match(html, /role="tablist"/);
  for (const label of ["材料清单", "限制与接受", "Receipt", "版本历史"]) assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
  assert.match(html, /当前使用条件/);
  assert.match(html, /备份覆盖：尚未核验/);
  assert.match(html, /Inventory|GapSet/);
});

test("material inspector shows the selected original identity without inventing investigation or execution success", () => {
  const html = renderComponent(evidence.MaterialInspector, { client: new SourceTruthClient("/api", "", "w"),
    reference: { bundleId, receiptId: "exact-receipt" }, component: { id: "b".repeat(64), kind: "GIT", sourceId: "git", nativeIdentity: { commit: "commit-exact" } },
    row: { componentId: "b".repeat(64), entry: { pathBytes: "cmVwb3J0LnR4dA", kind: "FILE", sizeBytes: "12", gitMode: "100644" }, disposition: { disposition: "VERIFIED", digest: "c".repeat(64) } }, onClose() {} });
  assert.match(html, /材料详情/);
  assert.match(html, /report.txt/);
  assert.match(html, /exact-receipt|commit-exact/);
  assert.match(html, /复制引用/);
  assert.match(html, /原始材料/);
  assert.match(html, /尚未提取或调查/);
  assert.match(html, /相关限制/);
  assert.doesNotMatch(html, /测试通过|<script/);
});

test("overview tabs are distinct from frozen detail and the input sidebar does not claim enumeration", async () => {
  const { SourceOverviewTabs, SourceTaskContext } = await import("../app/source-truth/layout.tsx");
  const html = renderComponent(SourceOverviewTabs, { selected: "versions", onSelect() {}, id: "overview" });
  for (const label of ["版本", "材料清单", "采集记录"]) assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
  assert.doesNotMatch(html, /限制与接受|Receipt/);
  const sidebar = renderComponent(SourceTaskContext, { workspaceName: "W", overview: { actor: { actorId: "owner" }, role: "MAINTAIN", draft: null,
    storage: { ready: true }, backup: { status: "NOT_CONFIGURED" }, policy: { maxEntries: 200000, maxFileBytes: "1073741824" } },
    input: { sources: [{ kind: "GIT", mode: "UPDATE", label: "G", ref: "main" }], baselineBundleId: null }, detail: null, current: 1, acceptedCount: "0" });
  assert.match(sidebar, /当前输入|下一站门槛/);
  assert.match(sidebar, /尚未枚举，不显示可信文件总数/);
  assert.doesNotMatch(sidebar, /文件 0|内容已验证 0/);
});

test("source input and range configuration are separate editable checkpoints", () => {
  const props = { input: { sources: [{ sourceId: "s", kind: "GIT", mode: "UPDATE", label: "Git", url: "https://git.test/a.git", ref: "main" }], baselineBundleId: null }, versions: [], disabled: false, gitEnabled: true, onChange() {}, onPickDirectory() {}, directoryName: null };
  const first = renderComponent(SourceForm, { ...props, stage: 1 });
  assert.match(first, /仓库 HTTPS 地址/);
  assert.doesNotMatch(first, /目录根（留空代表全仓库）|版本基线/);
  const range = renderComponent(SourceForm, { ...props, stage: 2 });
  assert.match(range, /版本基线|目录根（留空代表全仓库）/);
  assert.doesNotMatch(range, /disabled=""/);
});

test("verified LFS pointer is displayed as missing external body, not complete original content", () => {
  const html = renderComponent(evidence.MaterialInspector, { client: new SourceTruthClient("/api", "", "w"),
    reference: { bundleId, receiptId: "exact-receipt" }, component: { id: "b".repeat(64), kind: "GIT", sourceId: "git", nativeIdentity: { commit: "commit-exact" } },
    row: { componentId: "b".repeat(64), entry: { pathBytes: "bGZzLmJpbg", kind: "FILE", sizeBytes: "12", gitMode: "100644" },
      disposition: { disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest: "c".repeat(64), gaps: [{ ruleCode: "GIT_LFS_EXTERNAL" }] } }, onClose() {} });
  assert.match(html, /外部正文明确缺失/);
  assert.match(html, /读取已保存指针（非外部正文）/);
  assert.doesNotMatch(html, />读取原文预览</);
});
