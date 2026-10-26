import { workId } from "./work-types.ts";
export type WorkPosition = {
  tab: "investigations" | "published" | "sessions";
  revision?: string;
  session?: string;
  question?: string;
  object?: string;
  material?: string;
};
const names = ["knowledge", "publishedRevision", "sessionId", "questionId", "publishedObject", "publishedMaterial"];
export function workPosition(search: string, workspace: string): WorkPosition & { error: string } {
  const p = new URLSearchParams(search),
    tab = p.get("knowledge") ?? "investigations";
  const value = {
    tab,
    revision: p.get("publishedRevision") ?? undefined,
    session: p.get("sessionId") ?? undefined,
    question: p.get("questionId") ?? undefined,
    object: p.get("publishedObject") ?? undefined,
    material: p.get("publishedMaterial") ?? undefined,
  };
  const used = names.some((k) => p.has(k));
  const bad =
    used &&
    (p.getAll("workspace").length !== 1 ||
      p.get("workspace") !== workspace ||
      names.some((k) => p.getAll(k).length > 1) ||
      !["investigations", "published", "sessions"].includes(tab) ||
      p.has("runId") ||
      p.has("revision") ||
      p.has("objectId") ||
      p.has("view") ||
      (value.revision !== undefined && !workId(value.revision)) ||
      (value.session !== undefined && !workId(value.session)) ||
      (value.question !== undefined && !workId(value.question)) ||
      (tab !== "published" && (value.revision !== undefined || value.object !== undefined || value.material !== undefined)) ||
      (value.material !== undefined && (!value.revision || !workId(value.material))) ||
      (tab !== "sessions" && (value.session !== undefined || value.question !== undefined)) ||
      (value.question !== undefined && !value.session) ||
      (value.object !== undefined &&
        (!value.revision || value.object.length > 512 || /[\u0000-\u001f]/.test(value.object))));
  return {
    ...value,
    tab: tab as WorkPosition["tab"],
    error: bad ? "知识地址包含重复或不相容的版本、会话定位；未切换到最新结果。" : "",
  };
}
export function workAddress(href: string, workspace: string, position: WorkPosition) {
  const u = new URL(href);
  if (u.searchParams.get("workspace") !== workspace) return null;
  for (const k of [...names, "runId", "view", "objectId", "revision"]) u.searchParams.delete(k);
  if (position.tab !== "investigations") u.searchParams.set("knowledge", position.tab);
  if (position.revision) u.searchParams.set("publishedRevision", position.revision);
  if (position.session) u.searchParams.set("sessionId", position.session);
  if (position.question) u.searchParams.set("questionId", position.question);
  if (position.object) u.searchParams.set("publishedObject", position.object);
  if (position.material) u.searchParams.set("publishedMaterial", position.material);
  return u.href;
}
export function openWork(workspace: string, position: WorkPosition) {
  const href = workAddress(window.location.href, workspace, position);
  if (!href) return;
  const u = new URL(href);
  window.history.pushState(null, "", u.pathname + u.search);
  window.dispatchEvent(new Event("traqen:navigate"));
}
