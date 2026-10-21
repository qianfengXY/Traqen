import { boundedEvidenceFilters, type EvidenceFilters } from "./search.ts";
import { boundedDirectoryExpansion } from "./directory.ts";
import { boundedTextRange } from "./text-window.ts";
import { boundedRelationFilters, boundedGapFilters, boundedGraphViewport, emptyRelationFilters, emptyGapFilters, emptyGraphViewport,
  type RelationFilters, type GapFilters, type GraphViewport } from "./traversal.ts";

type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
export type ViewIdentity = { workspaceId: string; actorId: string; graphVersionId: string; authorized: boolean; recordId?: string; recordKind?: string; graphRootId?: string };
export type EvidenceView = EvidenceFilters & { materialPathQuery: string; directoryScrollTop: number; readingLine: number; readingLineEnd: number; readingWindowLine: number; inspectorOpen: boolean; inspectorScrollTop: number;
  relationFilters: RelationFilters; relationScrollTop: number; graphRootId: string | null; graphViewport: GraphViewport; gapFilters: GapFilters; gapScrollTop: number; expandedDirectory: string[] };
type OptionalFields = "materialPathQuery" | "materialType" | "processingStatus" | "readingLineEnd" | "readingWindowLine" | "inspectorOpen" | "inspectorScrollTop" | "relationFilters" | "relationScrollTop" | "graphRootId" | "graphViewport" | "gapFilters" | "gapScrollTop" | "expandedDirectory";
type ViewInput = Omit<EvidenceView, OptionalFields> & Partial<Pick<EvidenceView, OptionalFields>>;
export const emptyEvidenceView = (): EvidenceView => ({ query: "", materialPathQuery: "", materialType: "", processingStatus: "", directoryScrollTop: 0, readingLine: 1, readingLineEnd: 1, readingWindowLine: 1, inspectorOpen: true, inspectorScrollTop: 0,
  relationFilters: emptyRelationFilters(), relationScrollTop: 0, graphRootId: null, graphViewport: emptyGraphViewport(), gapFilters: emptyGapFilters(), gapScrollTop: 0, expandedDirectory: [] });

function storageKey(context: ViewIdentity) {
  if (!context.authorized || ![context.workspaceId, context.actorId].every(value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value))
    || !/^[a-f0-9]{64}$/.test(context.graphVersionId) || (context.recordId !== undefined && !/^[a-f0-9]{64}$/.test(context.recordId))) throw new Error("当前成员和固定版本尚未获得读取授权");
  if (context.recordKind !== undefined && (!context.recordId || !/^[A-Z_]{1,64}$/.test(context.recordKind))) throw new Error("记录类型或完整定位无效");
  if (context.graphRootId !== undefined && !/^[a-f0-9]{64}$/.test(context.graphRootId)) throw new Error("图根节点定位无效");
  return `traqen:f002:view:1:${JSON.stringify([context.workspaceId, context.actorId, context.graphVersionId])}`;
}

function bounded(metadata: ViewInput): EvidenceView {
  const filters = boundedEvidenceFilters(metadata);
  const materialPathQuery = metadata.materialPathQuery === undefined ? "" : metadata.materialPathQuery;
  if (typeof materialPathQuery !== "string" || materialPathQuery.length > 512 || /[\u0000-\u001f\u007f]/.test(materialPathQuery)) throw new Error("材料路径查询无效或超出边界");
  const { readingLineEnd = metadata.readingLine, readingWindowLine = metadata.readingLine } = metadata;
  boundedTextRange(metadata.readingLine, readingLineEnd); boundedTextRange(readingWindowLine);
  const { inspectorOpen = true, inspectorScrollTop = 0 } = metadata;
  const { relationScrollTop = 0, gapScrollTop = 0, graphRootId = null } = metadata;
  if (![relationScrollTop, gapScrollTop].every(value => Number.isFinite(value) && value >= 0 && value <= 10_000_000)
    || (graphRootId !== null && !/^[a-f0-9]{64}$/.test(graphRootId))) throw new Error("图或列表恢复元数据无效或超出边界");
  if (typeof inspectorOpen !== "boolean" || !Number.isFinite(inspectorScrollTop) || inspectorScrollTop < 0 || inspectorScrollTop > 10_000_000) throw new Error("面板恢复元数据无效或超出边界");
  if (!Number.isFinite(metadata.directoryScrollTop) || metadata.directoryScrollTop < 0 || metadata.directoryScrollTop > 10_000_000
    || !Number.isInteger(metadata.readingLine) || metadata.readingLine < 1 || metadata.readingLine > 10_000_000) throw new Error("阅读恢复元数据无效或超出边界");
  return { ...filters, materialPathQuery, directoryScrollTop: metadata.directoryScrollTop, readingLine: metadata.readingLine, readingLineEnd, readingWindowLine, inspectorOpen, inspectorScrollTop,
    relationFilters: boundedRelationFilters(metadata.relationFilters), relationScrollTop, graphRootId, graphViewport: boundedGraphViewport(metadata.graphViewport),
    gapFilters: boundedGapFilters(metadata.gapFilters), gapScrollTop, expandedDirectory: boundedDirectoryExpansion(metadata.expandedDirectory) };
}

export function rememberEvidenceView(storage: Storage, context: ViewIdentity, metadata: ViewInput) {
  const key = storageKey(context), safe = bounded(metadata);
  // These are editable navigation preferences only. Never serialize a record,
  // response, token or displayed source bytes into this persistent store.
  const encoded = JSON.stringify({ schemaVersion: 1, ...safe, recordId: context.recordId ?? null, recordKind: context.recordKind ?? null });
  if (encoded.length > 16_384) throw new Error("导航恢复记录超出边界");
  storage.setItem(key, encoded);
}

export function restoreEvidenceView(storage: Storage, context: ViewIdentity): EvidenceView {
  if (!context.authorized) return emptyEvidenceView(); // Do not even read another identity's metadata before authorization.
  const raw = storage.getItem(storageKey(context));
  if (!raw) return emptyEvidenceView();
  if (raw.length > 16_384) throw new Error("阅读恢复记录超出边界");
  const saved = JSON.parse(raw);
  if (!saved || saved.schemaVersion !== 1) throw new Error("阅读恢复记录版本无效");
  const safe = bounded(saved); // Missing filters in a legacy schema-1 record default to no filter; invalid values never do.
  const sameRecord = saved.recordId === (context.recordId ?? null) && (saved.recordKind ?? null) === (context.recordKind ?? null);
  const sameRoot = context.graphRootId === undefined || context.graphRootId === safe.graphRootId;
  return { ...safe, readingLine: sameRecord ? safe.readingLine : 1, readingLineEnd: sameRecord ? safe.readingLineEnd : 1, readingWindowLine: sameRecord ? safe.readingWindowLine : 1, inspectorScrollTop: sameRecord ? safe.inspectorScrollTop : 0,
    graphRootId: context.graphRootId ?? safe.graphRootId, graphViewport: sameRoot ? safe.graphViewport : emptyGraphViewport() };
}
