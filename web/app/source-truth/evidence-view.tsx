"use client";

import { useEffect, useState } from "react";
import { SourceTruthClient } from "./client.ts";
import type { ArtifactRow, Gap, GapPage, Page } from "./types.ts";

export function sourcePath(encoded: string) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0))); }
  catch { return `原始路径字节：${encoded}`; }
}

export function ArtifactTable({ client, route, reference }: { client: SourceTruthClient; route: string; reference?: { bundleId: string; receiptId: string } }) {
  const [page, setPage] = useState<Page<ArtifactRow> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
    client.request<Page<ArtifactRow>>(`${route}${route.includes("?") ? "&" : "?"}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      .then((value) => { if (active) { setPage(value); setError(""); } }).catch((error) => { if (active && !client.signal?.aborted) setError(error.message); });
    return () => { active = false; };
  }, [client, route, cursor]);
  return <div className="st-evidence"><h3>材料清单</h3><p className="st-muted">分页展示所有条目与处置。计数包含目录和不可用项，不等于完整可分析文件数。</p>
    {error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p role="status">正在读取清单…</p> : <>
      <div className="st-table-scroll"><table><thead><tr><th>路径</th><th>类型</th><th>字节</th><th>处置</th>{reference && <th>原始材料</th>}</tr></thead><tbody>{page.items.map(({ entry, disposition, componentId }) => <tr key={`${componentId ?? ""}:${entry.pathBytes}`}><td title={entry.pathBytes}>{sourcePath(entry.pathBytes)}</td><td>{entry.kind}</td><td>{entry.sizeBytes ?? "—"}</td><td><span className={`st-badge ${disposition?.disposition === "EXTERNAL_GAP" ? "warning" : "muted"}`}>{disposition?.disposition ?? "待采集"}</span>{disposition?.reasonCode && <small>{disposition.reasonCode}</small>}</td>{reference && <td>{disposition?.digest && componentId ? <button className="st-link" disabled={saving} onClick={() => void download({ entry, disposition, componentId })}>保存原始文件</button> : "无已采集正文"}</td>}</tr>)}</tbody></table></div>
      {!page.items.length && <p>当前清单没有条目。空 Git tree 可以合法存在；零文件目录不能发布。</p>}
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
