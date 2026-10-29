import { decodePathBytes } from "../source-truth/identity.js";
import { F002Error, requireF002 } from "./errors.js";

function selectedByScope(selections, componentId, pathBytes) {
  const path = decodePathBytes(pathBytes);
  return selections.some((selection) => {
    if (selection.componentId !== componentId) return false;
    if (selection.kind === "COMPONENT") return true;
    const selected = decodePathBytes(selection.pathBytes);
    if (selection.kind === "ENTRY") return selected.equals(path);
    return path.equals(selected) || (path.length > selected.length && path.subarray(0, selected.length).equals(selected) && path[selected.length] === 47);
  });
}

function maximumBytes(profile) {
  const value = profile?.extractionLimits?.maxBytes;
  return Number.isSafeInteger(value) && value > 0 ? value : 8 * 1024 * 1024;
}

function maximumMaterials(profile) {
  const value = profile?.extractionLimits?.maxMaterials;
  return Number.isSafeInteger(value) && value > 0 ? value : 200_000;
}

// F001 remains the only source-byte owner. Both initial processing and replay
// use this one loader so their selector, digest, byte and availability rules
// cannot drift apart.
export async function loadFrozenMaterials(admission, actor, workspaceId, run, scope, profile, { signal, onProgress = null } = {}) {
  const materials = [];
  const seen = new Set();
  let cursor = null;
  const maxBytes = maximumBytes(profile);
  const maxMaterials = maximumMaterials(profile);
  do {
    signal?.throwIfAborted();
    const page = await admission.inventory(actor, workspaceId, run.id, { limit: 1000, cursor });
    for (const item of page.items) {
      signal?.throwIfAborted();
      if (!selectedByScope(scope.selections, item.componentId, item.entry.pathBytes)) continue;
      const key = `${item.componentId}\u0000${item.entry.pathBytes}`;
      requireF002(!seen.has(key), "F002_INVENTORY_DUPLICATE", "冻结材料清单包含重复条目", { status: 409 });
      seen.add(key);
      requireF002(materials.length < maxMaterials, "F002_SCOPE_MATERIAL_LIMIT", "范围材料数量超过固定解析上限", { status: 409 });
      await onProgress?.({ phase: "LOADING", completed: materials.length, total: null, path: decodePathBytes(item.entry.pathBytes).toString("utf8") });
      const disposition = item.disposition ?? {};
      const common = { componentId: item.componentId, pathBytes: item.entry.pathBytes, mediaType: "application/octet-stream", contentDigest: disposition.digest ?? null };
      const declaredBytes = /^\d+$/.test(item.entry?.sizeBytes ?? "") ? BigInt(item.entry.sizeBytes) : null;
      if (disposition.disposition !== "VERIFIED" || !/^[a-f0-9]{64}$/.test(disposition.digest ?? "")) {
        materials.push({ ...common, bytes: Buffer.alloc(0), contentAvailable: false, unavailableCode: disposition.reasonCode ?? "SOURCE_CONTENT_UNAVAILABLE" });
        continue;
      }
      if (declaredBytes === null || declaredBytes > BigInt(maxBytes)) {
        materials.push({ ...common, bytes: Buffer.alloc(0), contentAvailable: false, unavailableCode: "FILE_SIZE_LIMIT" });
        continue;
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of admission.readFile(actor, workspaceId, run.id, { componentId: item.componentId, pathBytes: item.entry.pathBytes })) {
        signal?.throwIfAborted();
        total += chunk.length;
        requireF002(total <= maxBytes, "F002_SOURCE_READ_LIMIT", "来源字节超出固定解析上限", { status: 409 });
        chunks.push(Buffer.from(chunk));
      }
      materials.push({ ...common, bytes: Buffer.concat(chunks) });
    }
    cursor = page.nextCursor;
  } while (cursor);
  await onProgress?.({ phase: "LOADING", completed: materials.length, total: materials.length });
  return materials;
}
