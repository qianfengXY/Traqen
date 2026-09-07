export class SourceClientError extends Error {
  code: string;
  status: number;
  requestId: string | null;
  constructor(message: string, code = "SOURCE_NETWORK_UNCONFIRMED", status = 0, requestId: string | null = null) {
    super(message); this.name = "SourceClientError"; this.code = code; this.status = status; this.requestId = requestId;
  }
}

export class SourceTruthClient {
  private base: string;
  private token: string;
  signal?: AbortSignal;
  constructor(apiBase: string, token: string, workspaceId: string, signal?: AbortSignal) {
    this.base = `${apiBase.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(workspaceId)}/source-truth`;
    this.token = token; this.signal = signal;
  }
  beginSession() {
    const controller = new AbortController();
    this.signal = controller.signal;
    return controller;
  }
  async request<T>(route = "", method = "GET", body?: object | Blob): Promise<T> {
    const signal = this.signal;
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(this.base + route, { method, credentials: "omit", cache: "no-store", redirect: "error", signal,
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": body instanceof Blob ? "application/octet-stream" : "application/json" }) },
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
    } catch {
      signal?.throwIfAborted();
      throw new SourceClientError("连接中断，操作结果未确认。请查询原任务后继续；不要重复创建版本。");
    }
    let parsed = true;
    const result = await response.json().catch(() => { parsed = false; return null; });
    signal?.throwIfAborted();
    if (!response.ok) throw new SourceClientError(result?.error?.message ?? "来源服务未返回可用结果", result?.error?.code ?? "SOURCE_HTTP_ERROR", response.status, result?.error?.requestId ?? null);
    if (!parsed || !response.headers.get("content-type")?.includes("application/json")) throw new SourceClientError("响应不是来源服务的 JSON 结果，操作状态未确认");
    return result as T;
  }
}
