import { filterEvidenceMaterials, matchEvidenceRecords, type EvidenceFilters, type MatchField } from "./search.ts";
import type { Coverage, FactRecord } from "./types.ts";

export type DirectoryNode = { record: FactRecord; fields: MatchField[]; children: DirectoryNode[]; reason: string | null };
export type DirectoryGroup = { material: FactRecord; fields: MatchField[]; objects: DirectoryNode[] };

export function boundedDirectoryExpansion(value: unknown = []): string[] {
  if (!Array.isArray(value) || value.length > 64 || new Set(value).size !== value.length
    || !value.every(key => typeof key === "string" && /^(?:MATERIAL|OBJECT):[a-f0-9]{64}$/.test(key))) throw new Error("目录展开元数据无效或超出边界");
  return [...value].sort();
}

// Presentation only: material membership and parent IDs come from the admitted
// records. A path/name/anchor similarity never manufactures a containment Fact.
export function projectEvidenceDirectory(materials: FactRecord[], objects: FactRecord[], filters: EvidenceFilters, coverage: Coverage | null): DirectoryGroup[] {
  const eligible = filterEvidenceMaterials(materials, { ...filters, query: "" }, coverage);
  const byId = new Map(objects.filter(record => record.kind === "OBJECT").map(record => [record.id, record]));
  const materialHits = new Map(matchEvidenceRecords(eligible.map(match => match.record), filters.query).map(match => [match.record.id, match.fields]));
  const objectHits = new Map(matchEvidenceRecords([...byId.values()], filters.query).map(match => [match.record.id, match.fields]));
  const compare = (a: DirectoryNode, b: DirectoryNode) => (a.record.payload.anchor?.lineStart ?? Number.MAX_SAFE_INTEGER) - (b.record.payload.anchor?.lineStart ?? Number.MAX_SAFE_INTEGER)
    || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0);
  return eligible.flatMap(({ record: material }) => {
    const members = [...byId.values()].filter(record => record.payload.materialId === material.id && record.payload.kind !== "MATERIAL");
    const nodes = new Map(members.map(record => [record.id, { record, fields: objectHits.get(record.id) ?? [], children: [], reason: null } as DirectoryNode]));
    const parents = new Map<string, string>();
    for (const node of nodes.values()) {
      let current = node.record;
      const seen = new Set([current.id]);
      for (let depth = 0; current.payload.parentId !== undefined; depth += 1) {
        const parentId = current.payload.parentId;
        if (typeof parentId !== "string" || !/^[a-f0-9]{64}$/.test(parentId)) { node.reason = "PARENT_INVALID"; break; }
        const parent = byId.get(parentId);
        if (!parent) { node.reason = "PARENT_NOT_LOADED"; break; }
        if (parent.payload.materialId !== material.id) { node.reason = "PARENT_OUTSIDE_MATERIAL"; break; }
        if (seen.has(parent.id)) { node.reason = "PARENT_CYCLE"; break; }
        if (depth >= 31) { node.reason = "PARENT_DEPTH_LIMIT"; break; }
        seen.add(parent.id); current = parent;
      }
      if (!node.reason && typeof node.record.payload.parentId === "string" && nodes.has(node.record.payload.parentId)) parents.set(node.record.id, node.record.payload.parentId);
    }
    const visible = new Set<string>();
    for (const node of nodes.values()) {
      if (!materialHits.has(material.id) && !objectHits.has(node.record.id)) continue;
      let key: string | undefined = node.record.id;
      while (key && !visible.has(key)) { visible.add(key); key = parents.get(key); }
    }
    if (!materialHits.has(material.id) && !visible.size) return [];
    const roots: DirectoryNode[] = [];
    for (const node of nodes.values()) {
      if (!visible.has(node.record.id)) continue;
      const parentId = parents.get(node.record.id);
      if (parentId && visible.has(parentId)) nodes.get(parentId)!.children.push(node); else roots.push(node);
    }
    for (const node of nodes.values()) node.children.sort(compare);
    return [{ material, fields: materialHits.get(material.id) ?? [], objects: roots.sort(compare) }];
  });
}
