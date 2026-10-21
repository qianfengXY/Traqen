import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import type { InvestigationContext, RequestPage } from "./types.ts";

export type CatalogBinding = { workspaceId: string; investigationId: string; baseVersionId: string; cursor: string | null };
export type CatalogSnapshot = { investigation: InvestigationContext | null; investigationError: Error | null; page: RequestPage };
const mismatch = () => new FactsClientError("调查清单与原工作区、调查、基准或范围不匹配；未替换当前内容。", "F002_REQUEST_REFERENCE_MISMATCH");
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const refs = (values: string[]) => Array.isArray(values) && values.length <= 200 && values.every(value => /^[a-f0-9]{64}$/.test(value));

function validInvestigation(value: InvestigationContext, binding: CatalogBinding) {
  if (!value || value.workspaceId !== binding.workspaceId || value.investigationId !== binding.investigationId || value.baseVersionId !== binding.baseVersionId
    || value.state !== "RUNNING" || !value.budget || !value.usage || ![value.budget.maxMaterials, value.budget.maxBytes, value.budget.maxRuleApplications,
      value.budget.maximumAttempts, value.usage.materials, value.usage.bytes, value.usage.ruleApplications, value.usage.attempts].every(count)
    || value.budget.maximumAttempts < 1 || !Number.isFinite(Date.parse(value.budget.deadline))
    || !Array.isArray(value.allowedCapabilities) || !value.allowedCapabilities.every(capability => typeof capability === "string")) throw mismatch();
  return value;
}

function validPage(page: RequestPage & { workspaceId: string }, binding: CatalogBinding, revisions: Map<string, number>) {
  if (!page || page.workspaceId !== binding.workspaceId || !Array.isArray(page.items) || page.items.length > 20) throw mismatch();
  const ids = new Set<string>();
  for (const item of page.items) {
    if (!item || !/^[A-Za-z0-9-]{1,128}$/.test(item.id) || ids.has(item.id) || item.investigationId !== binding.investigationId || item.baseVersionId !== binding.baseVersionId
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision < (revisions.get(item.id) ?? 0)
      || !["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(item.status)
      || !(item.questionSummary === null || (typeof item.questionSummary === "string" && Array.from(item.questionSummary).length <= 240))
      || !(item.scope === null || (item.scope && refs(item.scope.factRefs) && refs(item.scope.materialRefs)))
      || !Number.isFinite(Date.parse(item.updatedAt))) throw mismatch();
    ids.add(item.id);
  }
  if (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor !== page.items.at(-1)?.id)) throw mismatch();
  for (const item of page.items) revisions.set(item.id, item.revision);
  return page;
}

// Lists and new-request allowances have distinct authority: a stopped
// investigation can still grant READ for its historical request receipts.
export function observeRequestCatalog(client: DeterministicFactsClient, binding: CatalogBinding,
  onValue: (value: CatalogSnapshot) => void, onError: (error: Error) => void, focusTarget: EventTarget = window) {
  const controller = new AbortController(), revisions = new Map<string, number>();
  const signal = client.signal ? AbortSignal.any([controller.signal, client.signal]) : controller.signal;
  const bound = client.withSignal(signal);
  const query = new URLSearchParams({ investigationId: binding.investigationId, baseVersionId: binding.baseVersionId, limit: "20" });
  if (binding.cursor) query.set("cursor", binding.cursor);
  let reading = false, timer: ReturnType<typeof setInterval> | null = null;
  const close = () => {
    controller.abort(); if (timer !== null) { clearInterval(timer); timer = null; }
    focusTarget.removeEventListener("focus", focus); client.signal?.removeEventListener("abort", close);
  };
  const observe = async () => {
    if (signal.aborted || reading) return;
    reading = true;
    try {
      const [context, listing] = await Promise.allSettled([
        bound.request<{ investigation: InvestigationContext }>(`/investigations/${encodeURIComponent(binding.investigationId)}?baseVersionId=${binding.baseVersionId}`)
          .then(result => validInvestigation(result.investigation, binding)),
        bound.request<RequestPage & { workspaceId: string }>(`/requests?${query}`).then(page => validPage(page, binding, revisions)),
      ]);
      if (signal.aborted) return;
      if (listing.status === "rejected") throw listing.reason;
      if (context.status === "rejected" && context.reason instanceof FactsClientError && context.reason.status === 401) throw context.reason;
      onValue({ investigation: context.status === "fulfilled" ? context.value : null,
        investigationError: context.status === "rejected" ? context.reason instanceof Error ? context.reason : new Error("调查预算未确认") : null, page: listing.value });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) close();
      onError(error instanceof Error ? error : new Error("调查清单未确认"));
    } finally { reading = false; }
  };
  const focus = () => void observe();
  if (!signal.aborted) {
    client.signal?.addEventListener("abort", close, { once: true }); focusTarget.addEventListener("focus", focus);
    timer = setInterval(focus, 5000); void observe();
  }
  return { close };
}
