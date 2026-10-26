import {canonicalEncode} from '../source-truth/identity.js';
import {requireF003} from './errors.js';
import {technicalSnapshot} from './technical-evidence.js';
import {readCheckpointDocument} from './checkpoint-storage.js';
import {intactBusinessGraph} from './semantic-graph.js';
import {SourceSnapshotReader} from '../source-truth/admission-service.js';
import {dependencyDigest,dependencyContractVersion,inventoryMaterial} from './dependency-review.js';

export async function readAnalysisGraph(tx,row) {
  const ref=row.payload.latestGraph;
  requireF003(row.state==='COMPLETED'&&ref&&row.payload.purpose!=='GRAPH_QUESTION',
    'F003_CONTINUATION_SOURCE_INCOMPLETE','增量依据必须是明确已完成的分析，不续失败检查点');
  const root=(await tx.query(`SELECT payload FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2
    AND generation=$3 AND checkpoint_key='graph'`,[row.workspace_id,row.id,ref.generation])).rows[0];
  requireF003(root,'F003_CONTINUATION_SOURCE_MISMATCH','缺少A图谱');
  const graph=await readCheckpointDocument(tx,row,{generation:ref.generation,key:'graph',payload:root.payload});
  requireF003(intactBusinessGraph(graph)&&graph.digest===ref.digest
    &&graph.workspaceId===row.workspace_id&&graph.investigationId===row.id
    &&graph.sourceBundleId===row.source_input.sourceBundleSnapshotId,'F003_CONTINUATION_SOURCE_MISMATCH','A检查点身份不符');
  return graph;
}

export async function analysisInventory(tx,workspaceId,sourceInput,scope) {
  const rows=(await tx.query(`SELECT c.id component_id,c.source_id,e.entry,e.disposition FROM source_truth_bundle_component b
    JOIN source_truth_component c ON c.workspace_id=b.workspace_id AND c.id=b.component_id
    JOIN source_truth_entry e ON e.workspace_id=c.workspace_id AND e.run_id=c.run_id AND e.source_id=c.source_id
    WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND c.id=ANY($3::text[]) ORDER BY c.id,e.path_bytes LIMIT 10001`,
  [workspaceId,sourceInput.sourceBundleSnapshotId,scope.componentIds])).rows;
  requireF003(rows.length<=10000,'F003_INVENTORY_LIMIT','增量清单不能截断；请明确有界调查范围');
  return rows.map(r=>{const component=sourceInput.components.find(c=>c.componentSnapshotId===r.component_id);
    return {...inventoryMaterial(workspaceId,sourceInput.sourceBundleSnapshotId,r),
      sourceContract:{kind:component.kind,declaredScope:component.declaredScope}};});
}

export async function technicalBinding(tx,workspaceId,versions) {
  const result=[];
  for(const versionId of versions) {
    const p=(await tx.query(`SELECT f.profile_id,f.record_digest,p.payload FROM f002_fact_set f JOIN f002_profile p ON p.id=f.profile_id
      WHERE f.workspace_id=$1 AND f.graph_version_id=$2`,[workspaceId,versionId])).rows[0];
    requireF003(p,'F003_TECHNICAL_VERSION_MISMATCH','缺少已采用技术规则/记录绑定');
    result.push({versionId,profileId:p.profile_id,recordDigest:p.record_digest,profileDigest:dependencyDigest(p.payload)});
  }
  return result;
}

export async function analysisDependencyRows(tx,workspaceId,sourceInput,scope,adoptedVersionIds,
  {factIds=[],factSelectors=[],localProofMaterialIds=[],inventory=[]}={}) {
  const rows=[],profiles=[],impactEdges=[];let status='AVAILABLE',bytes=2;
  const unavailable=()=>({rows:[],profiles,impactEdges:[],status:'INCOMPLETE'});
  if(factIds.length+factSelectors.length>50000)return unavailable();
  for(const versionId of adoptedVersionIds) {
    const s=await technicalSnapshot(tx,workspaceId,versionId,sourceInput.sourceBundleSnapshotId,scope.componentIds);
    const profile=(await tx.query(`SELECT p.id,p.payload FROM f002_fact_set f JOIN f002_profile p ON p.id=f.profile_id
      WHERE f.workspace_id=$1 AND f.graph_version_id=$2`,[workspaceId,versionId])).rows[0];
    requireF003(profile,'F003_TECHNICAL_VERSION_MISMATCH','缺少确切F002规则合同');
    profiles.push({id:profile.id,payloadDigest:dependencyDigest(profile.payload)});
    const materials=(await tx.query(`SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2
      AND kind='MATERIAL' AND id=ANY($3::text[]) ORDER BY id`,[workspaceId,versionId,s.allowedMaterialIds])).rows;
    const rawFor=m=>inventory.find(r=>r.componentId===m.payload.componentId&&r.pathBytes===m.payload.pathBytes);
    const selectors=factSelectors.flatMap(sel=>materials.filter(m=>{
      const raw=rawFor(m);return raw?.sourceId===sel.sourceId&&raw.pathBytes===sel.pathBytes;
    }).map(m=>({materialId:m.id,predicate:sel.predicate,kind:sel.kind,name:sel.name,anchor:sel.anchor})));
    const locals=materials.filter(m=>localProofMaterialIds.includes(rawFor(m)?.materialId)).map(m=>m.id);
    // Narrow roots by actual current refs or server-recorded A selectors, then
    // read their COMPLETE premise/parent/evidence closure. Do not copy every
    // unrelated lexical Fact into every investigation, or raise the50k/16MiB cap.
    const seeds=(await tx.query(`SELECT f.kind,f.id,f.payload FROM f002_record f JOIN f002_record o
      ON o.workspace_id=f.workspace_id AND o.graph_version_id=f.graph_version_id AND o.kind='OBJECT' AND o.id=f.payload->>'subjectId'
      WHERE f.workspace_id=$1 AND f.graph_version_id=$2 AND f.kind='FACT' AND f.id=ANY($3::text[]) AND
      (f.id=ANY($4::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) q WHERE
        f.payload->>'predicate'=q->>'predicate' AND o.payload->>'materialId'=q->>'materialId'
        AND COALESCE(o.payload->>'kind','')=COALESCE(q->>'kind','') AND COALESCE(o.payload->>'name','')=COALESCE(q->>'name','')
        AND COALESCE(o.payload->'anchor','null'::jsonb)=q->'anchor')
        OR (f.payload->>'predicate'='name' AND o.payload->>'kind'='FUNCTION' AND o.payload->>'materialId'=ANY($6::text[])))
      ORDER BY f.id LIMIT 50001`,[workspaceId,versionId,s.allowedFactIds,factIds,JSON.stringify(selectors),locals])).rows;
    const seen=new Set(),pending=new Map();
    const queue=(kind,id)=>{if(!id){status='INCOMPLETE';return;}const k=kind+'\0'+id;if(!seen.has(k))pending.set(k,{kind,id});};
    const add=r=>{
      const k=r.kind+'\0'+r.id;if(seen.has(k))return;seen.add(k);pending.delete(k);
      const bound={...r,versionId};bytes+=Buffer.byteLength(JSON.stringify(bound))+1;rows.push(bound);
      if(r.kind==='FACT'){
        queue('OBJECT',r.payload.subjectId);if(r.payload.targetId)queue('OBJECT',r.payload.targetId);
        for(const id of r.payload.evidenceIds??[])queue('EVIDENCE',id);
        for(const id of r.payload.premiseFactIds??[])queue('FACT',id);
      }else if(r.kind==='OBJECT'||r.kind==='EVIDENCE'){
        queue('MATERIAL',r.payload.materialId);if(r.kind==='OBJECT'&&r.payload.parentId)queue('OBJECT',r.payload.parentId);
      }
    };
    for(const r of [...materials,...seeds])add(r);
    for(let depth=0;pending.size;depth++) {
      if(depth>=128||rows.length>50000||bytes>16*1024*1024)return unavailable();
      const request=[...pending.values()];pending.clear();
      const selected=(await tx.query(`SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2
        AND ((kind='FACT' AND id=ANY($3::text[])) OR (kind='OBJECT' AND id=ANY($4::text[]))
        OR (kind='EVIDENCE' AND id=ANY($5::text[])) OR (kind='MATERIAL' AND id=ANY($6::text[]))) ORDER BY kind,id LIMIT 50001`,
      [workspaceId,versionId,...['FACT','OBJECT','EVIDENCE','MATERIAL'].map(kind=>request.filter(r=>r.kind===kind).map(r=>r.id))])).rows;
      if(selected.length!==request.length)status='INCOMPLETE';
      for(const r of selected)add(r);
    }
    // Direct cross-material edges summarize ALL durable scoped Facts, not only
    // selected roots. Their transitive material closure conservatively routes
    // unchanged callers when a callee/evidence/premise changes. Final DISTINCT
    // deduplicates direct DAG edges; it does not recursively enumerate paths.
    // Explicit bounded point probes keep the full primary key in each lookup
    // even before autovacuum statistics exist. A pulled-up LEFT JOIN can choose
    // repeated whole-kind scans when a freshly published set is estimated1row.
    const edges=(await tx.query(`SELECT DISTINCT a.material from_id,t.material to_id FROM f002_record f
      CROSS JOIN LATERAL (SELECT o.payload->>'materialId' material FROM f002_record o
        WHERE o.workspace_id=$1 AND o.graph_version_id=$2 AND o.kind='OBJECT' AND o.id=f.payload->>'subjectId' LIMIT 1) a
      CROSS JOIN LATERAL (
        SELECT b.payload->>'materialId' material FROM (SELECT payload FROM f002_record b WHERE b.workspace_id=$1
          AND b.graph_version_id=$2 AND b.kind='OBJECT' AND b.id=f.payload->>'targetId' LIMIT 1) b
        UNION ALL
        SELECT o.material FROM jsonb_array_elements_text(COALESCE(f.payload->'premiseFactIds','[]'::jsonb)) ids(id)
          CROSS JOIN LATERAL (SELECT p.payload->>'subjectId' subject FROM f002_record p WHERE p.workspace_id=$1
            AND p.graph_version_id=$2 AND p.kind='FACT' AND p.id=ids.id LIMIT 1) p
          CROSS JOIN LATERAL (SELECT o.payload->>'materialId' material FROM f002_record o WHERE o.workspace_id=$1
            AND o.graph_version_id=$2 AND o.kind='OBJECT' AND o.id=p.subject LIMIT 1) o
        UNION ALL
        SELECT e.material FROM jsonb_array_elements_text(COALESCE(f.payload->'evidenceIds','[]'::jsonb)) ids(id)
          CROSS JOIN LATERAL (SELECT e.payload->>'materialId' material FROM f002_record e WHERE e.workspace_id=$1
            AND e.graph_version_id=$2 AND e.kind='EVIDENCE' AND e.id=ids.id LIMIT 1) e
      ) t WHERE f.workspace_id=$1 AND f.graph_version_id=$2 AND f.kind='FACT'
      AND a.material=ANY($3::text[]) AND a.material<>t.material
      LIMIT 50001`,[workspaceId,versionId,s.allowedMaterialIds])).rows;
    for(const e of edges){
      const from=materials.find(m=>m.id===e.from_id),to=materials.find(m=>m.id===e.to_id);
      if(!from||!to||!rawFor(from)?.materialId||!rawFor(to)?.materialId){status='INCOMPLETE';continue;}
      impactEdges.push({from:rawFor(from).materialId,to:[rawFor(to).materialId]});
    }
    bytes+=Buffer.byteLength(JSON.stringify(impactEdges));
    if(rows.length+edges.length>50000||bytes>16*1024*1024)return unavailable();
  }
  const order=(a,b)=>a.id.localeCompare(b.id);
  if(!adoptedVersionIds.length||rows.length+impactEdges.length>50000||bytes>16*1024*1024)return unavailable();
  return {rows,profiles:profiles.sort(order),impactEdges,status};
}

export async function deriveContinuationBasis(tx,{actor,workspaceId,source,request,sourceInput,profile,implementationVersion,sources,sourceAdmission}) {
  const row=(await tx.query('SELECT * FROM f003_investigation WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,source.investigationId])).rows[0];
  requireF003(row,'F003_CONTINUATION_SOURCE_MISMATCH','A调查不属于当前空间');
  if(source.kind==='PRIVATE_ANALYSIS')requireF003(row.actor_id===actor.actorId||row.payload.delegateActorIds?.includes(actor.actorId),
    'F003_INVESTIGATION_FORBIDDEN','无权读取他人的私有分析',{status:403});
  else requireF003(source.kind==='PUBLISHED_WORK_SESSION'&&source.graphRevisionId,
    'F003_CONTINUATION_SOURCE_MISMATCH','工作接续必须绑定确切发布图谱');
  if(source.kind==='PUBLISHED_WORK_SESSION') {
    const p=(await tx.query('SELECT payload FROM f003_publication WHERE workspace_id=$1 AND graph_revision_id=$2',
      [workspaceId,source.graphRevisionId])).rows[0]?.payload;
    requireF003(p?.investigationId===row.id&&p.graphDigest===source.graphDigest,
      'F003_CONTINUATION_SOURCE_MISMATCH','发布A记录未绑定该分析');
  }
  const graph=await readAnalysisGraph(tx,row);
  requireF003(graph.digest===source.graphDigest,'F003_CONTINUATION_SOURCE_MISMATCH','精确A图谱已不匹配');
  // Current MAINTAIN/restore/backup authorization is owned by start(). Raw A
  // remains an exact readable source, never a newly qualified or relabelled run.
  await sources.authorize(actor,workspaceId,true,tx);
  await new SourceSnapshotReader(sources,sourceAdmission.candidates).records(actor,workspaceId,
    {bundleId:row.source_input.sourceBundleSnapshotId,receiptId:row.source_input.receiptId},tx);
  const inventoryA=await analysisInventory(tx,workspaceId,row.source_input,row.payload.scope);
  const inventoryB=await analysisInventory(tx,workspaceId,sourceInput,request.scope);
  const a={investigationId:row.id,graphDigest:graph.digest,graphRevisionId:source.graphRevisionId??null,
    sourceInput:row.source_input,scope:row.payload.scope,adoptedVersionIds:row.payload.adoptedVersionIds,
    analysisContractVersion:row.payload.analysisContractVersion??null,implementationVersion:row.payload.implementationVersion??null,
    profile:row.profile,question:row.payload.question,inventoryDigest:dependencyDigest(inventoryA),
    technicalBinding:await technicalBinding(tx,workspaceId,row.payload.adoptedVersionIds),
    dependencyReviewDigest:graph.dependencyReview?.digest??null};
  const b={sourceInput,scope:request.scope,adoptedVersionIds:request.technicalVersionId?[request.technicalVersionId]:[],
    profile,question:request.question,implementationVersion,inventoryDigest:dependencyDigest(inventoryB),
    technicalBinding:await technicalBinding(tx,workspaceId,request.technicalVersionId?[request.technicalVersionId]:[]),
    budget:request.budget,supplementBudget:request.supplementBudget};
  const body={version:dependencyContractVersion,purpose:source.kind==='PRIVATE_ANALYSIS'?'PREPUBLICATION_INCREMENTAL_ANALYSIS':'PUBLISHED_WORK_CONTINUATION',
    workspaceId,actorId:actor.actorId,operationId:request.operationId,a,b,source:structuredClone(source)};
  return {...body,digest:dependencyDigest(body)};
}

export function intactContinuationBasis(basis) {
  try {const {digest,...body}=basis;return basis.version===dependencyContractVersion&&dependencyDigest(body)===digest
    &&canonicalEncode(basis.b.adoptedVersionIds)===canonicalEncode(basis.b.adoptedVersionIds.filter(v=>typeof v==='string'));}
  catch{return false;}
}
