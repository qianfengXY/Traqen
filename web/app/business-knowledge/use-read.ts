"use client";
import { useEffect, useState } from "react";
import type { BusinessKnowledgeClient } from "./client.ts";

export function useKnowledgeRead<T>(client: BusinessKnowledgeClient, key: string,
  load: (client: BusinessKnowledgeClient) => Promise<T>, onAccessLost: (error: Error) => void, pollMs = 0) {
  const [snapshot, setSnapshot] = useState<{ client: BusinessKnowledgeClient; key: string; data: T | null; error: Error | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(), bound = client.withSignal(controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const data = await load(bound);
        if (!bound.signal?.aborted) setSnapshot({ client, key, data, error: null });
      } catch (cause) {
        if (bound.signal?.aborted) return;
        const error = cause instanceof Error ? cause : new Error("读取未完成");
        // Never leave old authorized data visible under a refusal or a failed
        // refresh. A later retry performs only a read.
        setSnapshot({ client, key, data: null, error }); onAccessLost(error);
      } finally { if (!bound.signal?.aborted && pollMs) timer = setTimeout(() => void read(), pollMs); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, key, load, onAccessLost, pollMs, refresh]);
  const current = snapshot?.client === client && snapshot.key === key ? snapshot : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current,
    retry: () => setRefresh(value => value + 1) };
}
