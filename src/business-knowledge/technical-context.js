import { structureDigest } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";

const key = r => `${r.versionId}\0${r.kind}\0${r.id}`;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function references(row) {
  const p = row.payload, ref = (kind, id) => ({ versionId: row.versionId, kind, id });
  if (row.kind === "FACT") return [ref("OBJECT", p.subjectId), ...(p.targetId ? [ref("OBJECT", p.targetId)] : []),
    ...(p.evidenceIds ?? []).map(id => ref("EVIDENCE", id)), ...(p.premiseFactIds ?? []).map(id => ref("FACT", id))];
  if (row.kind === "OBJECT") return [ref("MATERIAL", p.materialId), ...(p.parentId ? [ref("OBJECT", p.parentId)] : [])];
  if (row.kind === "EVIDENCE") return [ref("MATERIAL", p.materialId)];
  return [];
}

// Dependency-closed, version-local projection of immutable F002 records. A
// retained Fact always brings its names, anchors, materials and premise DAG.
// A byte/record bound drops the whole packet, not individual dependency ids.
export async function loadTechnicalContext(tx, { workspaceId, bundleId, snapshots, limit = 2000, maxBytes = 256 * 1024, maxRecords = 10000, selection = null }) {
  requireF003(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 512 * 1024
    && Number.isSafeInteger(maxRecords) && maxRecords > 0 && maxRecords <= 10000, "F003_INPUT_INVALID", "技术上下文预算无效", { status: 422 });
  const scopes = new Map(snapshots.map(s => [s.versionId, { facts: new Set(s.allowedFactIds), materials: new Set(s.allowedMaterialIds) }]));
  let roots = snapshots.flatMap(s => s.allowedFactIds.map(id => ({ versionId: s.versionId, kind: "FACT", id })));
  const availableFactCount=roots.length,selectionLimits=[];
  if(selection!==null) {
    requireF003(selection && typeof selection==='object' && !Array.isArray(selection)
      && (selection.factIds==null || (Array.isArray(selection.factIds) && selection.factIds.length<=4000 && selection.factIds.every(id=>typeof id==='string')))
      && (selection.materials==null || (Array.isArray(selection.materials) && selection.materials.length<=2000)),
      'F003_INPUT_INVALID','阶段技术证据选择无效',{status:422});
    if(selection.factIds!=null) {
      const requested=new Set(selection.factIds); roots=roots.filter(r=>requested.has(r.id));
    } else {
      const found=[];
      for(const s of snapshots) {
        const ms=(await tx.query(`SELECT id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='MATERIAL'
          AND id=ANY($3::text[]) ORDER BY id LIMIT 10001`,[workspaceId,s.versionId,s.allowedMaterialIds])).rows;
        if(ms.length>10000)selectionLimits.push('MATERIAL_SELECTION_LIMIT');
        const matched=new Map();
        for(const m of ms.slice(0,10000)) {
          const source={workspaceId,bundleId,componentId:m.payload.componentId,pathBytes:m.payload.pathBytes,contentDigest:m.payload.contentDigest};
          const id=structureDigest('material',source),ranges=(selection.materials??[]).filter(raw=>raw.id===id);
          if(ranges.length)matched.set(m.id,ranges);
        }
        if(!matched.size)continue;
        const ranges=[...matched].flatMap(([materialId,rs])=>rs.map(r=>({materialId,startLine:r.startLine??1,endLine:r.endLine??2147483647})));
        const anchors=(await tx.query(`SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2
          AND kind IN ('OBJECT','EVIDENCE') AND payload->>'materialId'=ANY($3::text[])
          AND EXISTS (SELECT 1 FROM jsonb_array_elements($4::jsonb) AS selected(r) WHERE payload->>'materialId'=selected.r->>'materialId'
            AND ((payload->'anchor'->>'kind') IS DISTINCT FROM 'TEXT' OR
              (COALESCE((payload->'anchor'->>'lineStart')::bigint,0)<=(selected.r->>'endLine')::bigint
              AND COALESCE((payload->'anchor'->>'lineEnd')::bigint,2147483647)>=(selected.r->>'startLine')::bigint)))
          ORDER BY id LIMIT 10001`,[workspaceId,s.versionId,[...matched.keys()],JSON.stringify(ranges)])).rows;
        if(anchors.length>10000)selectionLimits.push('ANCHOR_SELECTION_LIMIT');
        const eligible=anchors.slice(0,10000).filter(r=>(matched.get(r.payload.materialId)??[]).some(raw=>r.payload.anchor?.kind!=='TEXT'
          || ((r.payload.anchor.lineStart??0)<=(raw.endLine??Infinity) && (r.payload.anchor.lineEnd??Infinity)>=(raw.startLine??1))));
        const objects=eligible.filter(r=>r.kind==='OBJECT').map(r=>r.id),evidence=eligible.filter(r=>r.kind==='EVIDENCE').map(r=>r.id);
        const ids=(await tx.query(`SELECT id FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='FACT' AND id=ANY($3::text[])
          AND (payload->>'subjectId'=ANY($4::text[]) OR payload->>'targetId'=ANY($4::text[]) OR EXISTS
            (SELECT 1 FROM jsonb_array_elements_text(payload->'evidenceIds') AS e(value) WHERE e.value=ANY($5::text[])))
          ORDER BY CASE WHEN payload->>'basis'='DERIVED' THEN 0 ELSE 1 END,
            CASE WHEN payload->>'targetId' IS NOT NULL THEN 0 ELSE 1 END,id LIMIT $6`,
          [workspaceId,s.versionId,s.allowedFactIds,objects,evidence,limit+1])).rows;
        found.push(...ids.map(r=>({versionId:s.versionId,kind:'FACT',id:r.id})));
      }
      roots=found;
    }
  }
  const cache = new Map(), emitted = new Map(), unresolved = [], limitations = [];
  let truncated = roots.length > limit||selectionLimits.length>0, omittedFactCount = Math.max(0, roots.length - limit);
  const note = code => { if (!limitations.some(l => l.code === code)) limitations.push({ code, status: "UNKNOWN" }); };
  for(const code of selectionLimits)note(code);
  if (truncated) note("FACT_COUNT_LIMIT");
  // Batch the dependency frontier; do not turn a 2,000-Fact reference page into
  // thousands of lock-holding SQL round trips inside the Workspace fence.
  let pending = roots.slice(0, limit);
  for (let depth = 0; pending.length > 0 && depth <= 32; depth++) {
    const unique = [...new Map(pending.filter(r => !cache.has(key(r))).map(r => [key(r), r])).values()];
    if (!unique.length) break;
    const selected = unique.slice(0, maxRecords - cache.size);
    if (selected.length < unique.length) { truncated = true; note("CONTEXT_RECORD_LIMIT"); }
    if (!selected.length) break;
    const groups = new Map();
    for (const ref of selected) { const group = `${ref.versionId}\0${ref.kind}`; groups.set(group, [...(groups.get(group) ?? []), ref]); }
    pending = [];
    for (const refs of groups.values()) {
      const { versionId, kind } = refs[0], scope = scopes.get(versionId);
      const rows = (await tx.query(`SELECT kind,id,CASE WHEN octet_length(payload::text)<=$4 THEN payload ELSE NULL END AS payload
        FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind=$3 AND id=ANY($5::text[]) ORDER BY id LIMIT $6`,
      [workspaceId, versionId, kind, maxBytes, refs.map(r => r.id), refs.length])).rows;
      const byId = new Map(rows.filter(r => r.kind === kind).map(r => [r.id, r]));
      for (const ref of refs) {
        const row = byId.get(ref.id), p = row?.payload;
        const allowed = p && (kind === "FACT" ? scope.facts.has(ref.id) : kind === "MATERIAL" ? scope.materials.has(ref.id) : scope.materials.has(p.materialId));
        const value = allowed ? { ...row, versionId } : null;
        cache.set(key(ref), value); if (value) pending.push(...references(value));
      }
    }
  }
  const closure = async (ref, packet, stack = new Set()) => {
    const id = key(ref);
    if (stack.has(id)) throw Object.assign(new Error("cyclic context"), { code: "CONTEXT_CYCLE" });
    if (packet.has(id)) return;
    if (stack.size >= 32) throw Object.assign(new Error("context depth"), { code: "CONTEXT_DEPTH_LIMIT" });
    const row = cache.get(id);
    if (!row) throw Object.assign(new Error("missing scoped context"), { code: "CONTEXT_MISSING_OR_OUT_OF_SCOPE" });
    const next = new Set(stack); next.add(id);
    for (const dependency of references(row)) await closure(dependency, packet, next);
    packet.set(id, row);
  };
  const project = rows => {
    const values = [...rows.values()], of = kind => values.filter(r => r.kind === kind);
    return {
      versionIds: snapshots.map(s => s.versionId), sourceBundleId: bundleId,
      ...(selection?{selection:{kind:selection.factIds!=null?'EXPLICIT_FACT_REFS':'ORIGINAL_RANGES',eligibleRootCount:roots.length,availableFactCount}}:{}),
      records: of("FACT").map(r => ({ id: r.id, kind: r.kind, versionId: r.versionId, record: r.payload, contextStatus: "DEPENDENCIES_COMPLETE" })),
      objects: of("OBJECT").map(r => ({ ...r.payload, objectId: r.id, versionId: r.versionId })),
      evidence: of("EVIDENCE").map(r => ({ ...r.payload, evidenceId: r.id, versionId: r.versionId })),
      materials: of("MATERIAL").map(r => {
        const sourceMaterial = { workspaceId, bundleId, componentId: r.payload.componentId, pathBytes: r.payload.pathBytes, contentDigest: r.payload.contentDigest };
        sourceMaterial.id = structureDigest("material", sourceMaterial);
        return { ...r.payload, materialId: r.id, versionId: r.versionId, sourceMaterial };
      }),
      allowedFactIds: [...new Set(of("FACT").map(r => r.id))], unresolved, truncated, omittedFactCount, limitations,
      interpretation: "Bounded static references, not complete program logic or execution proof. Missing context stays unknown; never infer meanings from hashes.",
    };
  };
  for (const ref of roots.slice(0, limit)) {
    const packet = new Map();
    try { await closure(ref, packet); }
    catch (error) {
      omittedFactCount++;
      if (unresolved.length < 20 && bytes(project(emitted)) + 300 < maxBytes) unresolved.push({ versionId: ref.versionId, factId: ref.id, status: "UNKNOWN", reason: error.code ?? "CONTEXT_UNAVAILABLE" });
      note(error.code ?? "CONTEXT_UNAVAILABLE"); continue;
    }
    const combined = new Map([...emitted, ...packet]);
    // Leave headroom for bounded unknown/truncation annotations added later.
    if (bytes(project(combined)) + 512 > maxBytes) {
      omittedFactCount++; truncated = true; note("CONTEXT_BYTE_LIMIT"); continue;
    }
    for (const [id, row] of packet) emitted.set(id, row);
  }
  const result = project(emitted);
  requireF003(bytes(result) <= maxBytes, "F003_TECHNICAL_SCOPE_LIMIT", "技术上下文元数据超过预算，未向模型发送孤立引用");
  return result;
}
