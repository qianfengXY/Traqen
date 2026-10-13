"use client";
import { useEffect, useState } from "react";
import { SourceClientError, SourceTruthClient } from "./client.ts";
import { safeSourceReturn, sourceContextError, type SourceEntryContext } from "./context.ts";
import type { FrozenVersion, Receipt } from "./types.ts";
import { SourceVersionView } from "./version-view.tsx";
import { observeSourceReads } from "./observe.ts";

export function SourceEntryBanner({ context }: { context: SourceEntryContext }) {
  const back = safeSourceReturn(context);
  return <section className="st-callout" aria-label="原工作上下文"><strong>{context.mode === "REFERENCE" ? "固定来源引用 · 只读" : "为原工作补充新材料"}</strong>
    {context.mode === "REFERENCE" && <p>Bundle：{context.bundleId || "未提供"} · Receipt：{context.receiptId || "未提供"}</p>}
    <p>来源、事实集、图谱和工作会话是独立身份。材料保存或关联不代表分析已生效，不授予新的访问权限。</p>
    {back ? <a className="st-link" href={back}>返回原工作</a> : <p className="st-muted">没有可核验的返回地址；仍可独立查看来源，不创建替代工作会话。</p>}
  </section>;
}

export function FixedSourceReference({ client, context, workspaceId }: { client: SourceTruthClient; context: SourceEntryContext; workspaceId: string }) {
  const [version, setVersion] = useState<FrozenVersion | null>(null), [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const invalid = sourceContextError(context, workspaceId);
  useEffect(() => {
    if (invalid) return;
    const controller = client.beginSession();
    const read = async () => {
      const receipt = await client.request<Receipt>(`/bundles/${encodeURIComponent(context.bundleId!)}/receipt?receiptId=${encodeURIComponent(context.receiptId!)}`);
      const value = await client.request<FrozenVersion>(`/bundles/${encodeURIComponent(context.bundleId!)}`);
      if (controller.signal.aborted) return;
      if (receipt.id !== context.receiptId || receipt.bundleId !== context.bundleId || value.id !== context.bundleId)
        throw new Error("固定包与 Receipt 的精确绑定不一致；不会改用最新凭据。");
      if (context.componentId && !value.components.some(component => component.id === context.componentId))
        throw new Error("固定组件不属于此来源包；不会改用其他组件。");
      setVersion(value); setError(null);
    };
    const stop = observeSourceReads(read, { signal: controller.signal, intervalMs: 2500, onError: error => {
      if (controller.signal.aborted) return;
      setVersion(null); setError(error.message);
      // Revocation clears the parent as well as the material table. Abort old
      // children; only the explicit retry below creates a fresh read session.
      if (error instanceof SourceClientError && [401, 403].includes(error.status)) controller.abort();
    } });
    return () => { stop(); controller.abort(); };
  }, [client, context.bundleId, context.receiptId, context.componentId, invalid, revision]);
  return <><header className="st-heading"><div><h1>来源快照</h1><p>只核对原工作固定的材料，不自动切换最新版本。</p></div></header><SourceEntryBanner context={context} />
    {invalid || error ? <div className="st-callout danger" role="alert"><p>{invalid ?? error} · 原引用保留，未改用其他版本。</p>{!invalid && <button className="button" onClick={() => { setError(null); setRevision(value => value + 1); }}>重新核对原引用</button>}</div>
      : !version ? <p role="status">正在核对固定来源的访问权限与身份…</p>
        : <SourceVersionView key={`${version.id}:${context.receiptId}:${context.componentId ?? ""}:${context.pathBytes ?? ""}:${context.tab ?? ""}`} client={client} version={version} versions={[version]} writable={false} fixedReceiptId={context.receiptId} fixedComponentId={context.componentId} entryContext={context} onChanged={async () => {}} />}
  </>;
}
