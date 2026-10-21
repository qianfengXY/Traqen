import type { Coverage, FactRecord } from "./types.ts";

export const dispositionStates = ["DONE", "NOT_APPLICABLE", "UNSUPPORTED", "PARSE_FAILED", "PENDING", "RUNNING"] as const;
export type EvidenceFilters = { query: string; materialType: string; processingStatus: string };
export type MatchField = "path" | "name" | "id" | "predicate" | "type" | "basis" | "code";
export type EvidenceMatch = { record: FactRecord; fields: MatchField[] };

const matchFieldLabels: Record<MatchField, string> = { path: "路径", name: "名称／符号", id: "完整编号", predicate: "谓词", type: "登记类型", basis: "依据类别", code: "限制原因" };
export const evidenceMatchDescription = (fields: readonly MatchField[]) => fields.length ? `命中：${fields.map(field => matchFieldLabels[field]).join("、")}` : "";

export const evidenceRecordTitle = (record: FactRecord) => record.payload.displayPath ?? record.payload.name ?? record.payload.predicate ?? record.payload.code ?? `${record.id.slice(0, 12)}…`;

export function boundedEvidenceFilters(value: { query: unknown; materialType?: unknown; processingStatus?: unknown }): EvidenceFilters {
  const { query } = value;
  const materialType = value.materialType === undefined ? "" : value.materialType;
  const processingStatus = value.processingStatus === undefined ? "" : value.processingStatus;
  if (typeof query !== "string" || query.length > 512 || typeof materialType !== "string"
    || (materialType !== "" && !/^[A-Z][A-Z0-9_]{0,63}$/.test(materialType)) || typeof processingStatus !== "string"
    || (processingStatus !== "" && !dispositionStates.some(status => status === processingStatus))) throw new Error("筛选元数据无效或超出边界");
  return { query, materialType, processingStatus };
}

export function matchEvidenceRecords(records: FactRecord[], query: string): EvidenceMatch[] {
  const needle = boundedEvidenceFilters({ query }).query.trim().toLocaleLowerCase();
  return records.flatMap(record => {
    if (!needle) return [{ record, fields: [] }];
    // Only public identity/label metadata from the authorized collection is
    // searchable. Never traverse values, source bytes or an arbitrary payload.
    const candidates: [MatchField, unknown][] = [["path", record.payload.displayPath], ["name", record.payload.name],
      ["id", record.id], ["predicate", record.payload.predicate], ["type", record.payload.kind],
      ["basis", record.payload.basis], ["code", record.payload.code]];
    const fields = candidates.filter(([, text]) => typeof text === "string" && text.toLocaleLowerCase().includes(needle)).map(([field]) => field);
    return fields.length ? [{ record, fields }] : [];
  });
}

export function filterEvidenceMaterials(materials: FactRecord[], input: EvidenceFilters, coverage: Coverage | null): EvidenceMatch[] {
  const filters = boundedEvidenceFilters(input);
  const matchingDispositions = new Set(coverage?.items.filter(item => item.status === filters.processingStatus).map(item => item.materialId));
  return matchEvidenceRecords(materials, filters.query).filter(({ record }) => record.kind === "MATERIAL"
    && (!filters.materialType || record.payload.kind === filters.materialType)
    && (!filters.processingStatus || matchingDispositions.has(record.id)));
}
