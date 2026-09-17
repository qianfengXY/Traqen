"use client";

import type { T } from "./product-surfaces";
import "./workspace-connection.css";

export type ConnectionIssue = "authentication" | "forbidden" | "unavailable";

export function connectionIssue(error: unknown): ConnectionIssue {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  return status === 401 ? "authentication" : status === 403 ? "forbidden" : "unavailable";
}

export function WorkspaceConnection({ t, checking, issue, apiBase, token, onToken, onConnect, onDiagnostics }: {
  t: T; checking: boolean; issue: ConnectionIssue | null; apiBase: string; token: string;
  onToken: (token: string) => void; onConnect: () => void; onDiagnostics: () => void;
}) {
  return <section className="workspace-connection panel" aria-labelledby="workspace-connection-title" aria-busy={checking}>
    <header><p className="eyebrow">Traqen</p><h1 id="workspace-connection-title">{t("连接工作空间", "Connect to your workspace")}</h1>
      <p>{t("先验证访问身份，再选择或创建 Workspace。连接失败不代表工作空间为空。", "Verify access before selecting or creating a Workspace. A failed connection does not mean it is empty.")}</p></header>
    {checking ? <p role="status">{t("正在验证连接与访问权限（最多 10 秒）…", "Checking connection and access (up to 10 seconds)…")}</p> :
      <div className="connection-notice" role="alert"><strong>{issue === "authentication" ? t("需要访问令牌", "Access token required") : issue === "forbidden" ? t("当前身份无权访问", "Access is not permitted") : t("暂时无法读取 Workspace", "Workspaces are temporarily unavailable")}</strong>
        <p>{issue === "authentication" ? t("服务已响应，但尚未接受你的身份。请输入部署时提供的访问令牌；刷新页面后需要重新连接。", "The service responded but has not authenticated you. Enter the deployment access token; reconnect after refreshing this page.") : issue === "forbidden" ? t("请使用被授权的成员凭据或联系管理员；不会自动放宽权限。", "Use an authorized member credential or contact the administrator; permissions are never widened automatically.") : t("请检查服务和连接地址后重试。已有 Workspace 与来源版本不会因此被删除。", "Check the service and connection address, then retry. Existing Workspaces and source versions are preserved.")}</p></div>
    }
      <form onSubmit={(event) => { event.preventDefault(); if (!checking) onConnect(); }}>
        <label htmlFor="workspace-access-token">{t("访问令牌（仅当前页面内存）", "Access token (page memory only)")}</label>
        <input id="workspace-access-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => onToken(event.target.value)} aria-describedby="workspace-token-help" />
        <small id="workspace-token-help">{t("令牌不会写入 URL、浏览器存储或页面日志。它不会自动授予来源材料权限。", "The token is not stored in the URL, browser storage, or page logs. It does not automatically grant access to source materials.")}</small>
        <div className="connection-actions"><button className="button primary" type="submit" disabled={checking}>{t("验证并连接", "Verify and connect")}</button><button className="button" type="button" onClick={onDiagnostics}>{t("连接设置", "Connection settings")}</button></div>
      </form>
    <p className="connection-target">{t("当前 API", "Current API")}: <code>{apiBase}</code></p>
  </section>;
}
