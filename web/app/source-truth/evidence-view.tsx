"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SourceClientError, SourceTruthClient } from "./client.ts";
import { observeSourceReads } from "./observe.ts";
import { inventoryRoute, type InventoryFilter } from "./inventory.ts";
import type { ArtifactRow, FrozenVersion, Gap, GapPage, Page } from "./types.ts";

export function sourcePath(encoded: string) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0))); }
  catch { return `原始路径字节：${encoded}`; }
}

const emptyFilter: InventoryFilter = { query: "", componentId: "", disposition: "", availability: "", pathBytes: "" };
type MaterialComponent = Pick<FrozenVersion["components"][number], "id" | "kind" | "sourceId"> & Partial<Pick<FrozenVersion["components"][number], "nativeIdentity">>;
export const materialBodyMissing = (row: ArtifactRow) => row.disposition?.disposition === "EXTERNAL_GAP"
  || Boolean(row.disposition?.gaps?.some(gap => ["GIT_LFS_EXTERNAL", "GIT_SUBMODULE_EXTERNAL"].includes(gap.ruleCode)));

export function ArtifactTable({ client, route, reference, components = [], label, live = false, initialComponentId, initialPathBytes, inspectorTarget, onSelectionChange }: { client: SourceTruthClient; route: string; reference?: { bundleId: string; receiptId: string }; components?: MaterialComponent[]; label?: string; live?: boolean; initialComponentId?: string; initialPathBytes?: string; inspectorTarget?: HTMLElement | null; onSelectionChange?: (selected: boolean) => void }) {
  const [page, setPage] = useState<(Page<ArtifactRow> & { matchedCount: string }) | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draftFilter, setDraftFilter] = useState<InventoryFilter>({ ...emptyFilter, componentId: initialComponentId ?? "", pathBytes: initialPathBytes ?? "" }), [filter, setFilter] = useState<InventoryFilter>({ ...emptyFilter, componentId: initialComponentId ?? "", pathBytes: initialPathBytes ?? "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ArtifactRow | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const located = useRef(false);
  const clearSelection = () => { setSelected(null); onSelectionChange?.(false); };
  const applyFilter = (value: InventoryFilter) => { located.current = true; clearSelection(); setFilter({ ...value }); setCursor(null); setPage(null); setError(""); };
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
      if (active && !client.signal?.aborted) {
        setPage(value); setError("");
        if (!located.current && initialPathBytes) {
          located.current = true;
          const exact = value.items.find(row => row.componentId === initialComponentId && row.entry.pathBytes === initialPathBytes);
          if (exact) { setSelected(exact); onSelectionChange?.(true); }
        }
      }
    };
    const onError = (error: Error) => { if (active && !client.signal?.aborted) { setError(error.message); if (error instanceof SourceClientError && [401, 403].includes(error.status)) { setPage(null); setSelected(null); onSelectionChange?.(false); } } };
    // Historical views also recheck access; retained originals are cleared on
    // revocation, not treated as an offline authorization cache.
    const stop = observeSourceReads(read, { signal: client.signal, onError, intervalMs: live ? 2500 : 10000 });
    return () => { active = false; stop(); };
  }, [client, route, filter, cursor, live, initialPathBytes, initialComponentId, onSelectionChange]);
  const inspector = selected && reference ? <MaterialInspector key={`${reference.receiptId}:${selected.componentId}:${selected.entry.pathBytes}`} client={client} row={selected} reference={reference} component={components.find(item => item.id === selected.componentId)} onClose={() => { clearSelection(); trigger.current?.focus({ preventScroll: true }); }} /> : null;
  return <div className="st-evidence"><h3>材料清单{label && ` · ${label}`}</h3><p className="st-muted">按路径文本搜索（区分大小写，最多 256 UTF-8 字节），在服务端筛选后分页。计数包含目录和不可用项，不等于完整可分析文件数。</p>
    {filter.pathBytes && <p className="st-callout">精确材料定位：{sourcePath(filter.pathBytes)}；当前清单仅查此路径和原组件。清除筛选后可浏览完整清单，不自动选其他材料。</p>}
    <form className="st-actions" onSubmit={(event) => { event.preventDefault(); applyFilter(draftFilter); }}>
      <label>路径搜索<input type="search" value={draftFilter.query} maxLength={256} onChange={(event) => setDraftFilter({ ...draftFilter, query: event.target.value })} /></label>
      {components.length > 0 && <label>组件筛选<select value={draftFilter.componentId} onChange={(event) => setDraftFilter({ ...draftFilter, componentId: event.target.value })}><option value="">全部组件</option>{components.map((component) => <option value={component.id} key={component.id}>{componentLabel(component.id)}</option>)}</select></label>}
      <label>内容状态筛选<select value={draftFilter.availability} onChange={(event) => setDraftFilter({ ...draftFilter, availability: event.target.value })}><option value="">全部内容状态</option><option value="VERIFIED">已验证正文</option><option value="MISSING">明确缺失</option><option value="PENDING">待采集</option><option value="METADATA">目录元数据</option></select></label>
      <label>处置筛选<select value={draftFilter.disposition} onChange={(event) => setDraftFilter({ ...draftFilter, disposition: event.target.value })}><option value="">全部存储处置</option><option value="PENDING">待采集</option><option value="VERIFIED">已核验存储字节（可能仅指针）</option><option value="METADATA">仅元数据</option><option value="EXTERNAL_GAP">外部缺口</option></select></label>
      <button className="button" type="submit">搜索清单</button><button className="button" type="button" onClick={() => { setDraftFilter(emptyFilter); applyFilter(emptyFilter); }}>清除筛选</button>
    </form>
    {error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p role="status">正在读取清单…</p> : <>
      <p role="status">当前筛选匹配 {page.matchedCount} 项 · 本页 {page.items.length} 项</p>
      <div className="st-table-scroll"><table><thead><tr>{reference && <th>组件</th>}<th>路径</th><th>类型</th><th>字节</th><th>内容状态</th>{reference && <th>原始材料</th>}</tr></thead><tbody>{page.items.map(({ entry, disposition, componentId }) => {
        const row = { entry, disposition, componentId }, missing = materialBodyMissing(row);
        return <tr key={`${componentId ?? ""}:${entry.pathBytes}`} >{reference && <td title={componentId}>{componentId ? componentLabel(componentId) : "—"}</td>}<td title={entry.pathBytes}>{reference && componentId ? <button className="st-link" aria-label={`查看材料详情 ${sourcePath(entry.pathBytes)}`} onClick={event => { trigger.current = event.currentTarget; setSelected(row); onSelectionChange?.(true); }}>{sourcePath(entry.pathBytes)}</button> : sourcePath(entry.pathBytes)}</td><td>{entry.kind}</td><td>{entry.sizeBytes ?? "—"}</td><td><span className={`st-badge ${missing ? "warning" : "muted"}`}>{missing ? "明确缺失" : disposition?.disposition === "VERIFIED" ? "已验证正文" : disposition?.disposition === "METADATA" ? "仅元数据" : "待采集"}</span><small>{missing ? "外部正文未取得；已保存指针不代表正文" : disposition?.reasonCode}</small></td>{reference && <td>{disposition?.digest && componentId ? <button className="st-link" disabled={saving} onClick={() => void download(row)}>{missing ? "保存指针文件（非外部正文）" : "保存原始文件"}</button> : "无已采集正文"}</td>}</tr>;
      })}</tbody></table></div>
      {!page.items.length && <p>没有匹配条目。筛选不改变完整材料清单、覆盖计数或冻结资格。</p>}
      <div className="st-actions"><button className="button" disabled={!cursor} onClick={() => { clearSelection(); setPage(null); setCursor(null); }}>回到首页</button><button className="button" disabled={!page.nextCursor} onClick={() => { clearSelection(); setPage(null); setCursor(page.nextCursor); }}>下一页</button></div>
      {inspector && (inspectorTarget ? createPortal(inspector, inspectorTarget) : inspector)}
    </>}
  </div>;
}

export function MaterialInspector({ client, row, reference, component, onClose }: { client: SourceTruthClient; row: ArtifactRow; reference: { bundleId: string; receiptId: string }; component?: MaterialComponent; onClose: () => void }) {
  const missing = materialBodyMissing(row);
  const [preview, setPreview] = useState<{ text: string | null; truncated: boolean; bytes: number } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null), pending = useRef(false), heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); return () => { controller.current?.abort(); }; }, []);
  const fileRoute = `/bundles/${reference.bundleId}/file-history?${new URLSearchParams({ receiptId: reference.receiptId, componentId: row.componentId ?? "", pathBytes: row.entry.pathBytes })}`;
  const read = async () => {
    if (pending.current || !row.disposition?.digest || !row.componentId) return;
    pending.current = true; setBusy(true); setError(""); setPreview(null);
    const action = new AbortController(); controller.current = action;
    try { const value = await client.preview(fileRoute, 65536, action.signal); if (!action.signal.aborted) setPreview(value); }
    catch (error) { if (!action.signal.aborted) { setPreview(null); setError((error as Error).message); } }
    finally { pending.current = false; if (!action.signal.aborted) setBusy(false); }
  };
  const copy = async (original: boolean) => {
    setNotice("");
    try {
      // Recheck current ACL/binding even when copying an already displayed text.
      await client.request(`/bundles/${reference.bundleId}/receipt?receiptId=${encodeURIComponent(reference.receiptId)}`);
      await navigator.clipboard.writeText(original ? preview?.text ?? "" : JSON.stringify({ bundleId: reference.bundleId, receiptId: reference.receiptId, componentId: row.componentId, pathBytes: row.entry.pathBytes }));
      setNotice(original ? "已复制当前原文预览；截取范围不代表全文。" : "已复制精确材料引用，不包含正文或凭据。");
    } catch (error) { setPreview(null); setError((error as Error).message); }
  };
  return <aside className="st-material-inspector st-panel" aria-label="材料详情" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="st-card-head"><h3 ref={heading} tabIndex={-1}>材料详情</h3><button className="button" onClick={onClose}>关闭材料详情</button></div>
    <dl><dt>路径</dt><dd>{sourcePath(row.entry.pathBytes)}</dd><dt>组件 / 来源</dt><dd>{component?.kind} · {component?.sourceId} · {row.componentId}</dd>
      <dt>Bundle</dt><dd>{reference.bundleId}</dd><dt>Receipt</dt><dd>{reference.receiptId}</dd><dt>原生定位</dt><dd>{component?.nativeIdentity?.commit ?? "目录快照中的原始路径"} · {row.entry.gitMode ?? row.entry.kind}</dd>
      <dt>内容状态</dt><dd>{missing ? "明确缺失 · 存储字节或指针已核验不代表外部正文" : row.disposition?.disposition ?? "尚待处置"}</dd><dt>存储处置记录</dt><dd>{row.disposition?.disposition ?? "尚待处置"} · {row.disposition?.reasonCode ?? "尚无终态规则"}</dd><dt>当前访问</dt><dd>读取时复验权限与绑定；历史可读不代表可启动新分析。</dd></dl>
    <p className="st-callout">尚未提取或调查不等于文件缺失。材料内容写 PASS 不构成可信执行结果；此处不显示下游解释为原文。</p>
    {missing && <p className="st-callout warning">外部正文明确缺失，接受不会变成内容已验证。已保存的 Git 指针不是外部正文；相关限制可在下方逐项回查。</p>}
    <section aria-label="相关限制"><h4>相关限制</h4>{row.componentId && <GapBrowser client={client} route={`/bundles/${reference.bundleId}/gap-history?${new URLSearchParams({ receiptId: reference.receiptId, componentId: row.componentId, pathBytes: row.entry.pathBytes })}`} related />}</section>
    <section><h4>原始材料</h4><p>仅在你明确读取后展示最多 64 KiB 的 UTF-8 纯文本；不执行脚本、不嵌入文档、不整文件载入内存。</p>
      <button className="button" disabled={busy || !row.disposition?.digest || !row.componentId} onClick={() => void read()}>{busy ? "正在核对并读取…" : missing ? "读取已保存指针（非外部正文）" : "读取原文预览"}</button>
      {!row.disposition?.digest && <p>此项没有已采集正文；请按元数据或明确缺口阅读，不能假装正在加载。</p>}
      {error && <p className="st-callout danger" role="alert">{error}</p>}
      {preview && <>{preview.text === null ? <p>这不是可安全展示的 UTF-8 文本；可使用清单中的流式保存读取原始文件。</p> : <pre className="st-original" tabIndex={0}>{preview.text}</pre>}{preview.truncated && <p className="st-callout warning">仅展示前 {preview.bytes} 字节，后续内容未展示；复制预览不等于复制完整原文。</p>}</>}
    </section>
    <div className="st-actions"><button className="button" onClick={() => void copy(false)}>复制引用</button><button className="button" disabled={preview?.text == null} onClick={() => void copy(true)}>复制原文预览</button></div>{notice && <p role="status">{notice}</p>}
  </aside>;
}

export function GapList({ gaps }: { gaps: Gap[] }) {
  return <div className="st-gap-list">{gaps.map((gap) => <article className="st-callout warning" key={`${gap.componentId}:${gap.gapKey}`}><strong>{gap.ruleCode === "GIT_LFS_EXTERNAL" ? "Git LFS 外部内容未采集" : gap.ruleCode === "GIT_SUBMODULE_EXTERNAL" ? "Git 子模块未递归采集" : gap.ruleCode}</strong><p>{gap.sourceId} / {sourcePath(gap.pathBytes)}</p><p>影响范围：{gap.affectedScope} · {gap.severity === "NON_BLOCKING" ? "非阻断，但必须显式接受" : "阻断，不可接受"}</p><small>Gap {gap.gapKey}</small>{gap.acceptance && <dl><dt>接受责任人</dt><dd>{gap.acceptance.actorId}</dd><dt>理由</dt><dd>{gap.acceptance.reason}</dd><dt>绝对有效期</dt><dd>{gap.acceptance.expiresAt} · {gap.acceptance.currentlyValid ? "当前有效，仍需复验" : "已过期，不允许新准入"}</dd><dt>接受记录</dt><dd>{gap.acceptance.id}</dd></dl>}</article>)}</div>;
}

export function GapBrowser({ client, route, related = false }: { client: SourceTruthClient; route: string; related?: boolean }) {
  const [page, setPage] = useState<(GapPage & { matchedCount?: string }) | null>(null), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.request<GapPage>(`${route}${route.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).then((result) => { if (active) { setPage(result); setError(""); } }).catch((error) => { if (active && !client.signal?.aborted) { setPage(null); setError(error.message); } });
    return () => { active = false; };
  }, [client, route, cursor]);
  return <section>{error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p>正在读取缺口…</p> : <><h3>{related ? "此材料相关 Gap" : "已知 Gap"} · 共 {related ? page.matchedCount ?? "尚未核验" : page.total} 项</h3><GapList gaps={page.items} />{(related ? page.matchedCount : page.total) === "0" && <p>无已知采集缺口。是否可进行具体分析仍由后续能力判断。</p>}{page.nextCursor && <button className="button" onClick={() => { setPage(null); setCursor(page.nextCursor); }}>下一页缺口</button>}{cursor && <button className="button" onClick={() => setCursor(null)}>缺口首页</button>}</>}</section>;
}
