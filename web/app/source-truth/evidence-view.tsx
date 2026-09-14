"use client";

import { useEffect, useState } from "react";
import { SourceTruthClient } from "./client.ts";
import { observeSourceReads } from "./observe.ts";
import { inventoryRoute, type InventoryFilter } from "./inventory.ts";
import type { ArtifactRow, Gap, GapPage, Page } from "./types.ts";

export function sourcePath(encoded: string) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0))); }
  catch { return `原始路径字节：${encoded}`; }
}

const emptyFilter: InventoryFilter = { query: "", componentId: "", disposition: "" };

export function ArtifactTable({ client, route, reference, components = [], label, live = false }: { client: SourceTruthClient; route: string; reference?: { bundleId: string; receiptId: string }; components?: { id: string; kind: string; sourceId: string }[]; label?: string; live?: boolean }) {
  const [page, setPage] = useState<(Page<ArtifactRow> & { matchedCount: string }) | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draftFilter, setDraftFilter] = useState(emptyFilter), [filter, setFilter] = useState(emptyFilter);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const applyFilter = (value: InventoryFilter) => { setFilter({ ...value }); setCursor(null); setPage(null); setError(""); };
  const componentLabel = (id: string) => {
    const component = components.find((item) => item.id === id);
    return component ? `${component.kind} · ${component.sourceId}` : id;
  };
  const download = async (row: ArtifactRow) => {
    if (!reference || !row.componentId || saving) return;
    const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }> }).showSaveFilePicker;
    if (!picker) { setError("当前浏览器不支持有界流式保存，请使用支持文件保存 API 的浏览器；不会整文件读入内存或直接执行材料。"); return; }
    setSaving(true);
    try {
      const file = await picker({ suggestedName: sourcePath(row.entry.pathBytes).split("/").at(-1)?.replace(/[\\:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "source-material" });
      const destination = await file.createWritable();
      const query = new URLSearchParams({ receiptId: reference.receiptId, componentId: row.componentId, pathBytes: row.entry.pathBytes });
      await client.download(`/bundles/${reference.bundleId}/file-history?${query}`, destination);
    } catch (error) { if (!client.signal?.aborted && (error as Error).name !== "AbortError") setError((error as Error).message); }
    finally { if (!client.signal?.aborted) setSaving(false); }
  };
  useEffect(() => {
    let active = true;
    const read = async () => {
      const value = await client.request<Page<ArtifactRow> & { matchedCount: string }>(inventoryRoute(route, filter, cursor));
      if (active && !client.signal?.aborted) { setPage(value); setError(""); }
    };
    const onError = (error: Error) => { if (active && !client.signal?.aborted) setError(error.message); };
    const stop = live ? observeSourceReads(read, { signal: client.signal, onError }) : () => {};
    if (!live) void read().catch(onError);
    return () => { active = false; stop(); };
  }, [client, route, filter, cursor, live]);
  return <div className="st-evidence"><h3>材料清单{label && ` · ${label}`}</h3><p className="st-muted">按路径文本搜索（区分大小写，最多 256 UTF-8 字节），在服务端筛选后分页。计数包含目录和不可用项，不等于完整可分析文件数。</p>
    <form className="st-actions" onSubmit={(event) => { event.preventDefault(); applyFilter(draftFilter); }}>
      <label>路径搜索<input type="search" value={draftFilter.query} maxLength={256} onChange={(event) => setDraftFilter({ ...draftFilter, query: event.target.value })} /></label>
      {components.length > 0 && <label>组件筛选<select value={draftFilter.componentId} onChange={(event) => setDraftFilter({ ...draftFilter, componentId: event.target.value })}><option value="">全部组件</option>{components.map((component) => <option value={component.id} key={component.id}>{componentLabel(component.id)}</option>)}</select></label>}
      <label>处置筛选<select value={draftFilter.disposition} onChange={(event) => setDraftFilter({ ...draftFilter, disposition: event.target.value })}><option value="">全部处置</option><option value="PENDING">待采集</option><option value="VERIFIED">已校验正文</option><option value="METADATA">仅元数据</option><option value="EXTERNAL_GAP">外部缺口</option></select></label>
      <button className="button" type="submit">搜索清单</button><button className="button" type="button" onClick={() => { setDraftFilter(emptyFilter); applyFilter(emptyFilter); }}>清除筛选</button>
    </form>
    {error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p role="status">正在读取清单…</p> : <>
      <p role="status">当前筛选匹配 {page.matchedCount} 项 · 本页 {page.items.length} 项</p>
      <div className="st-table-scroll"><table><thead><tr>{reference && <th>组件</th>}<th>路径</th><th>类型</th><th>字节</th><th>处置</th>{reference && <th>原始材料</th>}</tr></thead><tbody>{page.items.map(({ entry, disposition, componentId }) => <tr key={`${componentId ?? ""}:${entry.pathBytes}`} >{reference && <td title={componentId}>{componentId ? componentLabel(componentId) : "—"}</td>}<td title={entry.pathBytes}>{sourcePath(entry.pathBytes)}</td><td>{entry.kind}</td><td>{entry.sizeBytes ?? "—"}</td><td><span className={`st-badge ${disposition?.disposition === "EXTERNAL_GAP" ? "warning" : "muted"}`}>{disposition?.disposition ?? "待采集"}</span>{disposition?.reasonCode && <small>{disposition.reasonCode}</small>}</td>{reference && <td>{disposition?.digest && componentId ? <button className="st-link" disabled={saving} onClick={() => void download({ entry, disposition, componentId })}>保存原始文件</button> : "无已采集正文"}</td>}</tr>)}</tbody></table></div>
      {!page.items.length && <p>没有匹配条目。筛选不改变完整材料清单、覆盖计数或冻结资格。</p>}
      <div className="st-actions"><button className="button" disabled={!cursor} onClick={() => { setPage(null); setCursor(null); }}>回到首页</button><button className="button" disabled={!page.nextCursor} onClick={() => { setPage(null); setCursor(page.nextCursor); }}>下一页</button></div>
    </>}
  </div>;
}

export function GapList({ gaps }: { gaps: Gap[] }) {
  return <div className="st-gap-list">{gaps.map((gap) => <article className="st-callout warning" key={`${gap.componentId}:${gap.gapKey}`}><strong>{gap.ruleCode === "GIT_LFS_EXTERNAL" ? "Git LFS 外部内容未采集" : gap.ruleCode === "GIT_SUBMODULE_EXTERNAL" ? "Git 子模块未递归采集" : gap.ruleCode}</strong><p>{gap.sourceId} / {sourcePath(gap.pathBytes)}</p><p>影响范围：{gap.affectedScope} · {gap.severity === "NON_BLOCKING" ? "非阻断，但必须显式接受" : "阻断，不可接受"}</p><small>Gap {gap.gapKey}</small></article>)}</div>;
}

export function GapBrowser({ client, route }: { client: SourceTruthClient; route: string }) {
  const [page, setPage] = useState<GapPage | null>(null), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.request<GapPage>(`${route}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).then((result) => { if (active) { setPage(result); setError(""); } }).catch((error) => { if (active && !client.signal?.aborted) setError(error.message); });
    return () => { active = false; };
  }, [client, route, cursor]);
  return <section>{error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p>正在读取缺口…</p> : <><h3>已知 Gap · 共 {page.total} 项</h3><GapList gaps={page.items} />{page.total === "0" && <p>无已知采集缺口。是否可进行具体分析仍由后续能力判断。</p>}{page.nextCursor && <button className="button" onClick={() => { setPage(null); setCursor(page.nextCursor); }}>下一页缺口</button>}{cursor && <button className="button" onClick={() => setCursor(null)}>缺口首页</button>}</>}</section>;
}
