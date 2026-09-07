"use client";

import { useEffect, useRef, useState } from "react";
import { SourceTruthClient } from "./client.ts";
import type { Page, Receipt } from "./types.ts";

export function ReceiptHistory({ client, bundleId, selected, onSelect }: { client: SourceTruthClient; bundleId: string; selected: Receipt | null; onSelect: (receipt: Receipt) => void }) {
  const [page, setPage] = useState<Page<Receipt> | null>(null), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.request<Page<Receipt>>(`/bundles/${bundleId}/receipts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      .then((value) => { if (active) { setPage(value); setError(""); } }).catch((error) => { if (active && !client.signal?.aborted) setError(error.message); });
    return () => { active = false; };
  }, [client, bundleId, cursor, selected?.id]);
  return <details className="st-receipt-history"><summary>选择本包的历史凭据</summary><p>选择只改变当前查看对象，不重绑既有分析。续签产生新凭据，旧凭据与接受记录永久保留。</p>
    {error ? <p role="alert" className="st-callout danger">{error}</p> : !page ? <p>正在读取凭据历史…</p> : <>
      {page.items.map((receipt) => <button className={`st-history-row ${selected?.id === receipt.id ? "selected" : ""}`} key={receipt.id} onClick={() => onSelect(receipt)} aria-pressed={selected?.id === receipt.id}><strong>{receipt.id}</strong><small>{receipt.issuedAt ? new Date(receipt.issuedAt).toLocaleString("zh-CN") : "签发时间待核对"} · {receipt.status} · Gap {receipt.gapCount}</small></button>)}
      <div className="st-actions"><button className="button" disabled={!cursor} onClick={() => { setPage(null); setCursor(null); }}>最新凭据</button><button className="button" disabled={!page.nextCursor} onClick={() => { setPage(null); setCursor(page.nextCursor); }}>更早凭据</button></div>
    </>}
  </details>;
}

type Coverage = { status: string; bundleId: string; receiptId: string; backupId?: string; waterline?: string; verifiedAt?: string };
export function BackupCoverage({ client, bundleId, receiptId }: { client: SourceTruthClient; bundleId: string; receiptId: string }) {
  const [busy, setBusy] = useState(false), [proof, setProof] = useState<Coverage | null>(null), [error, setError] = useState("");
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const check = async () => {
    setBusy(true); setError(""); setProof(null);
    try { const value = await client.request<Coverage>("/backup-coverage", "POST", { bundleId, receiptId }); if (alive.current) setProof(value); }
    catch (error) { if (alive.current && !client.signal?.aborted) setError((error as Error).message); }
    finally { if (alive.current) setBusy(false); }
  };
  const label = { COVERED: "本次核验：该包及该凭据已被完整备份覆盖", NOT_COVERED: "没有覆盖这对包与凭据的完成证明", NOT_CONFIGURED: "尚未配置配套备份，没有覆盖证明", UNAVAILABLE: "目标不可读或校验失败，当前无法证明备份覆盖" }[proof?.status ?? ""];
  return <section><h3>配套备份覆盖</h3><p>独立核对所选 Bundle + Receipt，不由历史 READY 推定，也不启动备份或分析任务。</p><button className="button" disabled={busy} onClick={() => void check()}>{busy ? "正在核验目标完成证明和引用字节…" : "核验这一对包与凭据的备份"}</button>
    {error && <p role="alert" className="st-callout danger">{error}</p>}{proof && <div className={`st-callout ${proof.status === "COVERED" ? "" : "warning"}`}><p>{label ?? "备份状态未确认"}</p>{proof.verifiedAt && <p>核验时间：{proof.verifiedAt}；恢复水位：{proof.waterline}；备份：{proof.backupId}。该证明不覆盖水位后的新凭据。</p>}</div>}
  </section>;
}
