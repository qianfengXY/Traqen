"use client";
import { useCallback, useState, useRef, useLayoutEffect } from "react";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { useCommandContext } from "./use-command.ts";
import type { WorkBinding } from "./work-types.ts";

export function BindingDetails({ binding }: { binding: WorkBinding }) {
  return (
    <details>
      <summary>固定来源与版本（不会自动换成最新）</summary>
      <dl className="bk-identities">
        <dt>GraphRevision</dt>
        <dd>{binding.graphRevisionId ?? "尚未显式采用已发布图谱"}</dd>
        <dt>图谱摘要</dt>
        <dd>{binding.graphDigest ?? "待采用"}</dd>
        <dt>原材料版本</dt>
        <dd>{binding.sourceInput.sourceBundleSnapshotId}</dd>
        <dt>准入收据</dt>
        <dd>{binding.sourceInput.receiptId}</dd>
        <dt>采用的技术版本</dt>
        <dd>{binding.adoptedVersionIds.join("、") || "明确未采用技术版本"}</dd>
      </dl>
    </details>
  );
}
export function CommandIssue({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className="bk-warning" role="alert">
      <p>{error.message}</p>
      {error instanceof BusinessKnowledgeError && (
        <>
          <code>{error.code}</code>
          {error.missing.length > 0 && (
            <>
              <p>服务端报告的真实缺项：</p>
              <ul>
                {error.missing.map((code, i) => (
                  <li key={`${code}:${i}`}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p>不会自动重试写入、重发未知模型调用或用本地状态解除阻断。</p>
    </div>
  );
}
export function useWorkCommand(
  client: BusinessKnowledgeClient,
  identity: string,
  onAccessLost: (error: Error) => void,
) {
  const begin = useCommandContext(client, identity),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState("");
  const owner = useRef<{ mounted: boolean; operation: symbol | null }>({
    mounted: false,
    operation: null,
  });
  useLayoutEffect(() => {
    const current = owner.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
    };
  }, []);
  const execute = async <T,>(action: () => Promise<T>, accept: (value: T) => void) => {
    if (owner.current.operation || client.signal?.aborted) return;
    const operation = Symbol("work-command");
    owner.current.operation = operation;
    const current = begin();
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const value = await action();
      if (current()) accept(value);
    } catch (cause) {
      if (current()) {
        const e = cause instanceof Error ? cause : new Error("操作结果未确认");
        setError(e);
        onAccessLost(e);
      }
    } finally {
      // Route permission controls results, not completion of this command.
      // Only its owning mounted hook may release its own operation; a stale
      // completion cannot release a later command or revive an unmounted view.
      if (owner.current.operation === operation) {
        owner.current.operation = null;
        if (owner.current.mounted) setBusy(false);
      }
    }
  };
  return { busy, error, notice, setNotice, execute };
}
export function useWorkspaceRole(
  client: BusinessKnowledgeClient,
  apiBase: string,
  onAccessLost: (error: Error) => void,
) {
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.currentWorkspaceRole(), []);
  return useKnowledgeRead(client, "work-current-role", load, onAccessLost, 10000);
}
