import type { GraphRevision, CurrentUnderstandingGraph } from "./understanding-graph-client.ts";
export function workPosition(search: string) {
  const params = new URLSearchParams(search);
  return { revision: params.get("revision"), objectId: params.get("objectId"),
    bundleId: params.get("bundleId"), receiptId: params.get("receiptId"), runId: params.get("runId") };
}
export function writeWorkPosition(changes: Partial<ReturnType<typeof workPosition>>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(key); else if (value !== undefined) url.searchParams.set(key, value);
  }
  if (url.search === window.location.search) return;
  window.history.replaceState(null, "", url.pathname + url.search);
  window.dispatchEvent(new Event("traqen:navigate"));
}
export async function graphAtPosition(search: string, current: CurrentUnderstandingGraph | null,
  read: (revision: string) => Promise<{ graphArtifact: CurrentUnderstandingGraph["graphArtifact"]; revision: GraphRevision }>) {
  const position = workPosition(search);
  let selected: Pick<CurrentUnderstandingGraph, "graphArtifact" | "revision"> | null = current;
  if (position.revision && position.revision !== "current" && position.revision !== current?.revision.id) {
    try { selected = await read(position.revision); }
    catch { throw new Error("指定图谱版本无法读取，请核对原链接与当前权限；不会改用最新版本。"); }
  }
  if (position.objectId && !selected?.graphArtifact.nodes.some(node => node.id === position.objectId)) {
    throw new Error("指定图谱对象无法读取，请核对原对象与版本；不会选择其他对象。");
  }
  return { selected, historical: !!selected && selected.revision.id !== current?.revision.id,
    focusedId: position.objectId ?? selected?.graphArtifact.nodes[0]?.id ?? "" };
}
