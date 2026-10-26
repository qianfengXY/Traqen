import {readStatus} from "./read-session.ts";
export function ReadIssue({ error, retry }: { error: Error; retry: () => void }) {
  const status = readStatus(error);
  return <div className="bk-error" role="alert"><b>{status === 401 ? "登录状态已失效" : status === 403 ? "当前无权读取" : status === 404 ? "指定结果不可读" : "读取未完成"}</b><p>{error.message}</p><p>未使用旧响应或最新版本替代；重试仅重新读取。</p><button className="button" onClick={retry}>重新读取</button></div>;
}
