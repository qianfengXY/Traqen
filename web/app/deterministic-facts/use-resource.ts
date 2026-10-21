"use client";

import { useCallback, useEffect, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import { SourceClientError } from "../source-truth/client.ts";

type Snapshot<T> = { client: DeterministicFactsClient; key: string; data: T | null; error: Error | null };

export function useEvidenceResource<T>(client: DeterministicFactsClient, key: string,
  load: (bound: DeterministicFactsClient) => Promise<T>, accessLost: (error: Error) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = client.signal ? AbortSignal.any([controller.signal, client.signal]) : controller.signal;
    const bound = client.withSignal(signal);
    void Promise.resolve().then(() => load(bound)).then(data => {
      if (!signal.aborted) setSnapshot({ client, key, data, error: null });
    }).catch(error => {
      if (signal.aborted) return;
      if ((error instanceof FactsClientError || error instanceof SourceClientError) && [401, 403].includes(error.status)) accessLost(error);
      else setSnapshot(previous => ({ client, key, data: previous?.client === client && previous.key === key ? previous.data : null, error: error instanceof Error ? error : new Error("读取未完成") }));
    });
    return () => controller.abort();
  }, [client, key, load, accessLost, revision]);
  // A changed identity/key is loading immediately, before any effect runs;
  // stale bytes never flash under a new material or Workspace label.
  const current = snapshot?.client === client && snapshot.key === key ? snapshot : null;
  const update = useCallback((apply: (data: T) => T) => setSnapshot(previous => previous?.client === client && previous.key === key && previous.data !== null
    ? { ...previous, data: apply(previous.data) } : previous), [client, key]);
  return { data: current?.data ?? null, error: current?.error ?? null, retry: () => setRevision(value => value + 1), update };
}
