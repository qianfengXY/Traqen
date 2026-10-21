"use client";

import { useEffect, useId, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import { readRequestMaterial, readRequestMaterialPage, type MaterialOption, type VerifiedMaterialSelection } from "./request-material.ts";

export function RequestMaterialPicker({ client, workspaceId, graphVersionId, materialId, disabled, onChoose, onVerified, onAccessLost }: {
  client: DeterministicFactsClient; workspaceId: string; graphVersionId?: string; materialId?: string; disabled: boolean;
  onChoose: (id: string | undefined) => void; onVerified: (value: VerifiedMaterialSelection | null) => void; onAccessLost: (error: Error) => void;
}) {
  const hintId = useId(), reference = JSON.stringify([workspaceId, graphVersionId]);
  const [query, setQuery] = useState<{ reference: string; cursor: string | null; history: string[] } | null>(null), [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<{ client: DeterministicFactsClient; query: typeof query; items: MaterialOption[]; nextCursor: string | null; error: Error | null } | null>(null);
  const [selected, setSelected] = useState<{ client: DeterministicFactsClient; reference: string; id: string; material: MaterialOption | null; error: Error | null } | null>(null);
  const valid = /^[a-f0-9]{64}$/.test(graphVersionId ?? "");
  useEffect(() => {
    onVerified(null);
    if (!materialId || !valid) return;
    const controller = new AbortController(), signal = client.signal ? AbortSignal.any([client.signal, controller.signal]) : controller.signal;
    const binding = { workspaceId, graphVersionId };
    void readRequestMaterial(client.withSignal(signal), binding, materialId).then(material => {
      if (signal.aborted) return;
      setSelected({ client, reference, id: materialId, material, error: null });
      onVerified({ client, workspaceId, graphVersionId: graphVersionId!, materialId });
    }).catch(error => {
      if (signal.aborted) return;
      setSelected({ client, reference, id: materialId, material: null, error });
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
    });
    return () => controller.abort();
  }, [client, workspaceId, graphVersionId, reference, materialId, valid, refresh, onVerified, onAccessLost]);
  useEffect(() => {
    if (!valid || !query || query.reference !== reference) return;
    const controller = new AbortController(), signal = client.signal ? AbortSignal.any([client.signal, controller.signal]) : controller.signal;
    void readRequestMaterialPage(client.withSignal(signal), { workspaceId, graphVersionId }, query.cursor).then(value => {
      if (signal.aborted) return;
      if (value.nextCursor && query.history.includes(value.nextCursor)) throw new FactsClientError("材料分页游标重复，未采用循环清单。", "F002_MATERIAL_REFERENCE_MISMATCH");
      setPage({ client, query, ...value, error: null });
    }).catch(error => {
      if (signal.aborted) return;
      setPage({ client, query, items: [], nextCursor: null, error });
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
    });
    return () => controller.abort();
  }, [client, workspaceId, graphVersionId, reference, query, valid, onAccessLost]);
  const current = !client.signal?.aborted && query?.reference === reference && page?.client === client && page.query === query ? page : null;
  const choice = !client.signal?.aborted && selected?.client === client && selected.reference === reference && selected.id === materialId ? selected : null;
  const active = query?.reference === reference;
  return <section className="f002-material-picker" aria-label="取证材料重选">
    <h3>修正取证材料位置</h3>
    <p id={hintId} className="f002-caption">只从当前固定版本的登记材料中选择；不改变正在阅读的引用，也不清空问题、类型或能力。材料可读不等于调查获准，提交仍由服务端复验。</p>
    <div className="f002-actions"><button className="button" aria-describedby={hintId} disabled={disabled || !valid} onClick={() => {
      onVerified(null); setPage(null); setSelected(null); setQuery({ reference, cursor: null, history: [] }); setRefresh(value => value + 1);
    }}>从当前来源选择</button>
      <button className="button" disabled={disabled || !materialId} onClick={() => { onVerified(null); onChoose(undefined); }}>恢复正在阅读的原引用</button></div>
    {materialId && (!choice ? <p role="status">正在按当前成员复验已保存的材料定位，尚不可提交；其他输入已保留。</p>
      : choice.error ? <p role="alert">材料位置未确认：{choice.error.message}。未改用其他版本；请重选或恢复原引用。</p>
        : <p role="status">已复验重选材料：{choice.material?.label} · {materialId}</p>)}
    {!active ? <p>尚未读取材料清单。</p> : !current ? <p role="status">正在读取此固定版本的授权材料，未使用旧清单。</p>
      : current.error ? <p role="alert">材料清单未确认：{current.error.message}。问题和原定位已保留，请重新读取。</p>
        : <>
          <p>{current.nextCursor ? "当前为部分清单，每页至多20项；可继续下一页。" : "已到此授权材料清单的最后一页。"}</p>
          {!current.items.length && <p role="status">当前固定版本没有可选择的登记材料；未替换任何输入。</p>}
          <ul>{current.items.map(item => <li key={item.id}><button className="f002-ref" disabled={disabled} aria-pressed={materialId === item.id} onClick={() => {
            onVerified(null); setSelected(null); onChoose(item.id); setRefresh(value => value + 1);
          }}>选择材料：{item.label}<small>{item.id}</small></button></li>)}</ul>
          {current.nextCursor && (query!.history.length >= 100 ? <p role="alert">已到本轮100页只读保护界限；未宣称材料清单完整，可重新读取首页。</p>
            : <button className="button" disabled={disabled} onClick={() => { setPage(null); setQuery({ reference, cursor: current.nextCursor, history: [...query!.history, current.nextCursor!] }); }}>下一页登记材料</button>)}
        </>}
  </section>;
}
