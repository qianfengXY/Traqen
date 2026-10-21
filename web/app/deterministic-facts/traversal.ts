import { dispositionStates, matchEvidenceRecords } from "./search.ts";
import type { Coverage, FactRecord, LocalGraph } from "./types.ts";

export type RelationFilters = { query: string; predicate: string; source: string; target: string; path: string };
export type GapFilters = { query: string; code: string; origin: string; materialType: string; status: string };
export type GraphViewport = { zoom: number; x: number; y: number };
export const emptyRelationFilters = (): RelationFilters => ({ query: "", predicate: "", source: "", target: "", path: "" });
export const emptyGapFilters = (): GapFilters => ({ query: "", code: "", origin: "", materialType: "", status: "" });
export const emptyGraphViewport = (): GraphViewport => ({ zoom: 1, x: 0, y: 0 });
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const matches = (value: unknown, query: string) => typeof value === "string" && value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function boundedRelationFilters(input: unknown = emptyRelationFilters()): RelationFilters {
  if (!plain(input)) throw new Error("关系筛选元数据无效");
  const { query, predicate, source, target, path } = input;
  if (![query, predicate, source, target, path].every(text)) throw new Error("关系筛选元数据无效或超出边界");
  return { query, predicate, source, target, path } as RelationFilters;
}

export function boundedGapFilters(input: unknown = emptyGapFilters()): GapFilters {
  if (!plain(input)) throw new Error("缺口筛选元数据无效");
  const { query, code, origin, materialType, status } = input;
  if (![query, code, origin, materialType, status].every(text) || !["", "F001", "F002"].includes(origin as string)
    || (materialType !== "" && !/^[A-Z][A-Z0-9_]{0,63}$/.test(materialType as string))
    || (status !== "" && !dispositionStates.some(value => value === status))) throw new Error("缺口来源或筛选元数据无效");
  return { query, code, origin, materialType, status } as GapFilters;
}

export function boundedGraphViewport(input: unknown = emptyGraphViewport()): GraphViewport {
  if (!plain(input)) throw new Error("图视口元数据无效");
  const { zoom, x, y } = input;
  if (![zoom, x, y].every(value => typeof value === "number" && Number.isFinite(value)) || (zoom as number) < .25 || (zoom as number) > 4
    || Math.abs(x as number) > 100_000 || Math.abs(y as number) > 100_000) throw new Error("图视口元数据无效或超出边界");
  return { zoom, x, y } as GraphViewport;
}

export function filterRelationFacts(relations: FactRecord[], input: RelationFilters, contextRecords: FactRecord[]): FactRecord[] {
  const filters = boundedRelationFilters(input);
  const objects = new Map(contextRecords.filter(record => record.kind === "OBJECT").map(record => [record.id, record]));
  const materials = new Map(contextRecords.filter(record => record.kind === "MATERIAL").map(record => [record.id, record]));
  return relations.filter(fact => {
    if (fact.kind !== "FACT" || fact.payload.kind !== "RELATION") return false;
    const subject = objects.get(fact.payload.subjectId ?? ""), target = objects.get(fact.payload.targetId ?? "");
    const paths = [subject, target].map(object => materials.get(object?.payload.materialId ?? "")?.payload.displayPath);
    const endpoint = (object: FactRecord | undefined, objectId: string | undefined, query: string) => !query.trim()
      || matches(objectId, query) || matches(object?.payload.name, query);
    const queryMatch = !filters.query.trim() || matchEvidenceRecords([fact], filters.query).length > 0
      || [subject?.payload.name, target?.payload.name, fact.payload.subjectId, fact.payload.targetId, ...paths].some(value => matches(value, filters.query));
    return queryMatch && (!filters.predicate || fact.payload.predicate === filters.predicate)
      && endpoint(subject, fact.payload.subjectId, filters.source) && endpoint(target, fact.payload.targetId, filters.target)
      && (!filters.path.trim() || paths.some(path => matches(path, filters.path)));
  });
}

export function projectEvidenceGraph(graph: LocalGraph) {
  const records = Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = records.filter(record => record.kind === "OBJECT" || record.kind === "MATERIAL");
  const facts = new Map(records.filter(record => record.kind === "FACT").map(record => [record.id, record]));
  const objects = new Map(nodes.filter(record => record.kind === "OBJECT").map(record => [record.id, record]));
  const edges: { fact: FactRecord; subject: FactRecord; target: FactRecord }[] = [], unavailableFactIds: string[] = [];
  for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
    const fact = facts.get(edge.factId), subject = objects.get(edge.subjectId), target = objects.get(edge.targetId);
    if (!digest(edge.factId) || !fact || fact.payload.kind !== "RELATION" || !subject || !target
      || fact.payload.subjectId !== edge.subjectId || fact.payload.targetId !== edge.targetId || fact.payload.predicate !== edge.predicate) {
      if (digest(edge.factId)) unavailableFactIds.push(edge.factId);
      continue;
    }
    edges.push({ fact, subject, target });
  }
  return { nodes, edges, unavailableFactIds: [...new Set(unavailableFactIds)] };
}

export function filterEvidenceGaps(gaps: FactRecord[], input: GapFilters, materials: FactRecord[], coverage: Coverage | null): FactRecord[] {
  const filters = boundedGapFilters(input);
  const materialById = new Map(materials.filter(record => record.kind === "MATERIAL").map(record => [record.id, record]));
  return gaps.filter(gap => gap.kind === "GAP" && (!filters.code || gap.payload.code === filters.code)
    && (!filters.origin || gap.payload.origin === filters.origin)
    && (!filters.materialType || materialById.get(gap.payload.materialId ?? "")?.payload.kind === filters.materialType)
    && (!filters.query.trim() || matchEvidenceRecords([gap], filters.query).length > 0
      || matches(materialById.get(gap.payload.materialId ?? "")?.payload.displayPath, filters.query))
    && (!filters.status || (coverage?.items ?? []).some(item => item.materialId === gap.payload.materialId && item.status === filters.status
      && (item.capabilityId === gap.payload.capability || (item.gapIds?.includes(gap.id) && !["inventory", "evidence", "gaps", "policy"].includes(item.capabilityId))))));
}
