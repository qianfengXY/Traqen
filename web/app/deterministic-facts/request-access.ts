import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import type { EvidenceRequest } from "./types.ts";

// Workspace access is not investigation READ access. Revalidate the exact
// displayed binding, never a latest request or an automatic write.
export function observeRequestAccess(client: DeterministicFactsClient, binding: EvidenceRequest,
  onValue: (value: EvidenceRequest) => void, onError: (error: Error) => void, focusTarget: EventTarget = window) {
  const controller = new AbortController();
  const signal = client.signal ? AbortSignal.any([controller.signal, client.signal]) : controller.signal;
  const bound = client.withSignal(signal);
  let reading = false, revision = binding.revision;
  let timer: ReturnType<typeof setInterval> | null = null;
  const close = () => {
    controller.abort();
    if (timer !== null) { clearInterval(timer); timer = null; }
    focusTarget.removeEventListener("focus", focus);
    client.signal?.removeEventListener("abort", close);
  };
  const observe = async () => {
    if (signal.aborted || reading) return;
    reading = true;
    try {
      const result = await bound.request<{ request: EvidenceRequest }>(`/requests/${binding.id}`);
      if (signal.aborted) return;
      const value = result.request;
      if (!value || value.id !== binding.id || value.investigationId !== binding.investigationId || value.baseVersionId !== binding.baseVersionId
        || !Number.isSafeInteger(value.revision) || value.revision < revision) {
        throw new FactsClientError("请求回读与原调查、基准或修订不匹配；未替换原回执。", "F002_REQUEST_REFERENCE_MISMATCH");
      }
      revision = value.revision;
      onValue(value);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) close();
      onError(error instanceof Error ? error : new Error("请求状态读取未完成"));
    } finally { reading = false; }
  };
  const focus = () => void observe();
  if (!signal.aborted) {
    client.signal?.addEventListener("abort", close, { once: true });
    focusTarget.addEventListener("focus", focus);
    timer = setInterval(focus, 5000);
    void observe();
  }
  return { close };
}
