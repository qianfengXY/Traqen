import { createGapId, createMaterialId } from "./identity.js";
import { requireF002 } from "./errors.js";

// Initial analysis and replay must construct their canonical output from the
// same frozen inputs. In particular, F001 limitations are evidence in their
// own right; replay re-reads them through the admitted source rather than
// copying a previously sealed Gap record.
export function canonicalRecords(result) {
  const records = [];
  for (const material of result.materials ?? []) records.push({ kind: "MATERIAL", id: material.materialId, payload: material });
  for (const object of result.objects ?? []) records.push({ kind: "OBJECT", id: object.objectId, payload: object });
  for (const evidence of result.evidence ?? []) records.push({ kind: "EVIDENCE", id: evidence.evidenceId, payload: evidence });
  for (const fact of result.facts ?? []) records.push({ kind: "FACT", id: fact.factId, payload: fact });
  for (const gap of result.gaps ?? []) records.push({ kind: "GAP", id: gap.gapId, payload: gap });
  return records;
}

export async function inheritedGapRecords(admission, actor, workspaceId, run, sourceMaterials) {
  const expectedCount = String(run.sourceInput?.inheritedGapSet?.count ?? "0");
  if (typeof admission?.inheritedGaps !== "function") {
    requireF002(expectedCount === "0", "F002_INHERITED_GAPS_UNAVAILABLE", "已准入来源没有完整继承 Gap 读取能力", { status: 503 });
    return [];
  }
  const materialIds = new Map(sourceMaterials.map((material) => [
    `${material.componentId}\u0000${material.pathBytes}`,
    createMaterialId({ workspaceId, bundleId: run.sourceInput.bundleId, componentId: material.componentId, pathBytes: material.pathBytes }),
  ]));
  const records = [];
  const seenGaps = new Set();
  const seenCursors = new Set();
  let cursor = null;
  do {
    const page = await admission.inheritedGaps(actor, workspaceId, run.id, { limit: 500, cursor });
    requireF002(page && Array.isArray(page.items), "F002_INHERITED_GAPS_INVALID", "继承 Gap 清单无效", { status: 409 });
    for (const inherited of page.items) {
      requireF002(inherited && typeof inherited.gapId === "string" && inherited.gapId.length > 0 && typeof inherited.componentId === "string"
        && typeof inherited.pathBytes === "string" && typeof inherited.reasonCode === "string" && inherited.reasonCode.length > 0,
      "F002_INHERITED_GAPS_INVALID", "继承 Gap 项无效", { status: 409 });
      if (seenGaps.has(inherited.gapId)) continue;
      seenGaps.add(inherited.gapId);
      const materialId = materialIds.get(`${inherited.componentId}\u0000${inherited.pathBytes}`);
      if (!materialId) continue;
      const reason = {
        category: "INHERITED_SOURCE_GAP",
        sourceGapId: inherited.gapId,
        ruleVersion: inherited.ruleVersion ?? null,
        affectedScope: inherited.affectedScope ?? null,
        externalReference: inherited.externalReference ?? null,
        componentId: inherited.componentId,
      };
      const gapId = createGapId({ origin: "F001", materialId, capability: "source", code: inherited.reasonCode, reason });
      records.push({ gapId, origin: "F001", materialId, objectId: null, capability: "source", code: inherited.reasonCode, anchor: null, reason });
    }
    cursor = page.nextCursor ?? null;
    requireF002(!cursor || !seenCursors.has(cursor), "F002_INHERITED_GAPS_INVALID", "继承 Gap 分页循环", { status: 409 });
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return records;
}

export async function assembleCanonicalOutput({ admission, actor, workspaceId, run, sourceMaterials, compiled }) {
  const result = {
    ...compiled,
    gaps: [...(compiled.gaps ?? []), ...await inheritedGapRecords(admission, actor, workspaceId, run, sourceMaterials)],
  };
  return { result, records: canonicalRecords(result) };
}
