import { requireF003 } from "./errors.js";

// The authority is the persisted F002 publication and its original F001
// binding, never a caller's description of a technical evidence set.
export async function technicalSnapshot(tx, workspaceId, versionId, bundleId, componentIds) {
  requireF003(typeof versionId === "string" && /^[a-f0-9]{64}$/.test(versionId), "F003_INPUT_INVALID", "技术证据版本引用无效", { status: 422 });
  const row = (await tx.query(`SELECT r.source_input FROM f002_fact_set f
    JOIN f002_run r ON r.workspace_id=f.workspace_id AND r.id=f.run_id
    WHERE f.workspace_id=$1 AND f.graph_version_id=$2`, [workspaceId, versionId])).rows[0];
  requireF003(row && row.source_input.sourceBundleSnapshotId === bundleId, "F003_TECHNICAL_VERSION_MISMATCH", "技术证据不属于选定的冻结原材料");
  const records = (await tx.query(`SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2
    AND kind IN ('MATERIAL','FACT','OBJECT') ORDER BY kind,id LIMIT 200001`, [workspaceId, versionId])).rows;
  requireF003(records.length <= 200000, "F003_TECHNICAL_SCOPE_LIMIT", "当前调查技术范围超过读取上限，请明确缩小范围");
  const materials = records.filter(r => r.kind === "MATERIAL" && componentIds.includes(r.payload.componentId));
  const materialIds = new Set(materials.map(r => r.id));
  const objectIds = new Set(records.filter(r => r.kind === "OBJECT" && materialIds.has(r.payload.materialId)).map(r => r.id));
  const profiles = (await tx.query("SELECT payload FROM f002_profile WHERE startable=true ORDER BY id")).rows;
  const allowedCapabilities = [...new Set(profiles.flatMap(p => p.payload.capabilityIds))].sort();
  requireF003(allowedCapabilities.length <= 512, "F003_TECHNICAL_SCOPE_LIMIT", "技术能力清单超过范围上限");
  return { versionId, allowedMaterialIds: [...materialIds],
    allowedCapabilities,
    allowedFactIds: records.filter(r => r.kind === "FACT" && objectIds.has(r.payload.subjectId)
      && (!r.payload.targetId || objectIds.has(r.payload.targetId))).map(r => r.id) };
}
