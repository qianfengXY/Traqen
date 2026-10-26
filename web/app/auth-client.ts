export type Person = {
  id: string;
  login: string;
  displayName: string;
  status: string;
  admin: boolean;
  globalConfig: boolean;
  kind: string;
};
export type AuthSession = {
  restrictedRestore?: boolean;
  account: Person;
  session: { id: string; phase: string; expiresAt: number };
  position: string;
  csrfToken: string;
};
export const API_BASE = process.env.NEXT_PUBLIC_TRAQEN_API_BASE ?? "/api";
let proof = "";
let reviewRole = "";
export const setSessionProof = (value: string) => {
  proof = value;
};
export const setReviewRole = (value: string) => {
  reviewRole = value;
};

// A request is attempted once. Recovery only performs fresh reads: writes, uploads
// and publication cannot safely be replayed after authentication or network loss.
export function notifySessionLoss(error: { code?: unknown } | null | undefined) {
  if (typeof window !== "undefined" && typeof error?.code === "string" && ["AUTH_REQUIRED", "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REVOKED", "AUTH_ACCOUNT_DISABLED"].includes(error.code)) {
    window.dispatchEvent(new CustomEvent("traqen:session-lost", { detail: error }));
  }
}

export async function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}, { inspectUnauthorized = true } = {}) {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("x-traqen-api-token");
  if (proof && !headers.has("x-traqen-csrf")) headers.set("x-traqen-csrf", proof);
  if (reviewRole) headers.set("x-traqen-review-role", reviewRole);
  const response = await fetch(input, {
    ...init,
    headers: Object.fromEntries(headers.entries()),
    credentials: "same-origin",
    cache: "no-store",
  });
  // Bounded callers own the first and only error-body consumer and notify
  // through the same classifier. Existing callers retain their old contract.
  if (inspectUnauthorized && response.status === 401 && !String(input).includes("/v1/auth/session") && typeof window !== "undefined") {
    const result = await response
      .clone()
      .json()
      .catch(() => null);
    notifySessionLoss(result?.error);
  }
  return response;
}
export class IdentityError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export async function authCall<T = Record<string, unknown>>(path: string, method = "GET", input?: unknown): Promise<T> {
  const response = await sessionFetch(`${API_BASE}${path}`, {
    method,
    headers: input === undefined ? {} : { "content-type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok)
    throw new IdentityError(
      result.error?.message ?? "服务暂不可用，请重试",
      result.error?.code ?? "AUTH_NETWORK_ERROR",
      response.status,
    );
  if (result.csrfToken) setSessionProof(result.csrfToken);
  return result as T;
}
export async function prepareLogin() {
  const response = await authCall<{ csrfToken: string }>("/v1/auth/csrf");
  setSessionProof(response.csrfToken);
}
export function openAccess(view: string, workspaceId?: string, applicationId?: string) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set(
    "page",
    ["security", "applications", "spaces", "directory"].includes(view) ? "overview" : "settings",
  );
  url.searchParams.set("view", view);
  if (workspaceId !== undefined) url.searchParams.set("workspace", workspaceId);
  const entry = new URLSearchParams(window.location.search).get("entry");
  if (view === "join" && entry) url.searchParams.set("entry", entry);
  if (applicationId) url.searchParams.set("applicationId", applicationId);
  window.history.pushState(null, "", url.pathname + url.search);
  window.dispatchEvent(new Event("traqen:navigate"));
}
