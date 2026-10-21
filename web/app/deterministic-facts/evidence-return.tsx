"use client";

import { useEffect, useMemo, useState } from "react";
import { getGraphRevision } from "../understanding-graph-client.ts";
import { readEvidenceReturnLocation, type ReturnContext } from "./model.ts";

type Revision = Awaited<ReturnType<typeof getGraphRevision>>;

export function useEvidenceReturn(search: string, workspaceId: string, authorized: boolean, apiBase: string, apiToken: string) {
  const parsed = useMemo(() => {
    try { return { context: readEvidenceReturnLocation(search, workspaceId), error: "" }; }
    catch (error) { return { context: null, error: (error as Error).message }; }
  }, [search, workspaceId]);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data: Revision | null; error: string } | null>(null);
  const key = JSON.stringify([workspaceId, apiBase, apiToken, search, retry]); // Memory-only identity fence; never rendered or persisted.
  const context = parsed.context;
  useEffect(() => {
    if (!context || !authorized) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (context.page === "overview" && (context.objectId || context.section || context.graphRevisionId)) throw new Error("原回答／会话入口尚未接通；保留其定位，不替换为工作区概览或新版本。");
      if (context.page !== "graph") return null;
      if (!context.graphRevisionId) throw new Error("原业务图缺少精确 Revision；没有改读当前 Published Head。");
      const result = await getGraphRevision(apiBase, apiToken, workspaceId, context.graphRevisionId);
      if (result.revision.id !== context.graphRevisionId || result.revision.projectId !== workspaceId) throw new Error("返回的业务图版本或工作区不匹配。");
      if (context.objectId && !result.graphArtifact.nodes.some(node => node.id === context.objectId)) throw new Error("原条目在该固定业务图版本中不可用；没有选择其它条目。");
      return result;
    }).then(data => { if (active) setSnapshot({ key, data, error: "" }); })
      .catch(error => { if (active) setSnapshot({ key, data: null, error: (error as Error).message }); });
    return () => { active = false; };
  }, [context, authorized, apiBase, apiToken, workspaceId, key]);
  const current = authorized && snapshot?.key === key ? snapshot : null;
  return { active: Boolean(context || parsed.error), context, key, data: current?.data ?? null,
    ready: Boolean(current && !current.error), error: parsed.error || current?.error || "", retry: () => setRetry(value => value + 1) };
}

export function EvidenceReturnPosition({ context }: { context: ReturnContext }) {
  const [message, setMessage] = useState("正在查找原焦点与阅读位置；尚未确认恢复。");
  useEffect(() => {
    const content = document.getElementById("product-content"), main = content?.parentElement;
    if (!content || !main) return;
    let done = false;
    const restore = () => {
      if (done) return;
      const focusId = context.focusId ?? context.objectId;
      const focus = focusId ? Array.from(content.querySelectorAll<HTMLElement>("[data-evidence-return-focus]"))
        .find(element => element.dataset.evidenceReturnFocus === focusId && element.getClientRects().length) : null;
      if (focusId && !focus) return;
      const section = context.section ? Array.from(content.querySelectorAll<HTMLElement>("[data-evidence-return-section]"))
        .find(element => element.dataset.evidenceReturnSection === context.section) : null;
      if (context.section && !section) return;
      const scroller = getComputedStyle(main).overflowY === "visible" ? document.scrollingElement : main;
      if (!scroller || (context.scrollTop !== undefined && context.scrollTop > scroller.scrollHeight - scroller.clientHeight)) return;
      focus?.focus({ preventScroll: true });
      if (focus && document.activeElement !== focus) return;
      if (context.scrollTop !== undefined) scroller.scrollTop = context.scrollTop;
      else section?.scrollIntoView({ block: "start" });
      if (context.scrollTop !== undefined && Math.abs(scroller.scrollTop - context.scrollTop) > 1) return;
      done = true;
      setMessage("已返回可验证的原入口和位置；业务采用状态未被更改。");
    };
    const observer = new MutationObserver(restore);
    observer.observe(content, { subtree: true, childList: true });
    const frame = requestAnimationFrame(restore);
    const timer = window.setTimeout(() => {
      if (!done) setMessage("固定版本已保留，但原章节、焦点或阅读位置尚不可用；没有定位到其它条目。可继续核查原引用。");
      observer.disconnect();
    }, 5000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); observer.disconnect(); };
  }, [context]);
  return <p className="connection-notice" role="status">{message}</p>;
}
