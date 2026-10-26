"use client";
import {useCallback} from 'react';
import type {BusinessKnowledgeClient} from './client.ts';
import type {PublishedVersion,VerificationProjection} from './authority-types.ts';
import {useKnowledgeRead} from './use-read.ts';
import {MaterialList} from './graph-view.tsx';
import {PublishedProjection} from './published-projection.tsx';
import {ReadIssue} from './read-issue.tsx';
import type {PublishedSeven} from './published-client.ts';
import {UnassociatedCoverage} from './coverage-view.tsx';
const names:Record<string,string>={NOT_RUN:'未运行',UNKNOWN:'可信依据未知',PASS:'通过',FAIL:'失败',ERROR:'执行错误',INCONCLUSIVE:'无法判定',CANCELLED:'已取消',SKIPPED:'已跳过'};
type Execution=VerificationProjection&{objectKey:string;claimId:string;scopeId:string;mappingCurrent?:boolean;authorityApplies?:boolean};
export function PublishedSevenQuestions({client,version,objectKey,onSelect,onMaterial,onAccessLost}:{client:BusinessKnowledgeClient;version:PublishedVersion;objectKey:string;onSelect:(key:string)=>void;onMaterial:(id:string)=>void;onAccessLost:(e:Error)=>void}){
  const revision=version.publication.graphRevisionId;
  const load=useCallback((bound:BusinessKnowledgeClient)=>bound.publishedReads(version).sevenQuestions(objectKey),[version,objectKey]);
  const state=useKnowledgeRead(client,`published-seven:${revision}:${objectKey}`,load,onAccessLost,10000);
  const selected=[...(state.data?.currentProjection.nodes??[]),...(state.data?.currentProjection.edges??[])].find(o=>o.key===objectKey);
  return <section aria-label="发布版本业务七问"><h3>业务七问</h3><p>读取选定发布版本及当前明确映射，不调用模型。原分析与后来的人类决定、可信执行相互独立。</p>
    {state.loading&&<p role="status">正在读取发布版本七问…</p>}{state.error&&<ReadIssue error={state.error} retry={state.retry}/>}
    {selected&&<PublishedProjection value={selected}/>}
    {state.data&&<PublishedSevenAnswers answer={state.data} onSelect={onSelect} onMaterial={onMaterial}/>}
  </section>;
}
export function PublishedSevenAnswers({answer,onSelect,onMaterial}:{answer:Pick<PublishedSeven,'sections'>;onSelect:(key:string)=>void;onMaterial:(id:string)=>void}){
  return <>{answer.sections.map((section,index)=>{
      const extra=section as typeof section&{executionTargets?:Execution[];environments?:unknown[]};
      return <section className="bk-answer" key={index}><h4>{index+1}. {section.question}</h4>
        {section.nodes?.map(n=><p key={n.key}><button className="bk-text-button" onClick={()=>onSelect(n.key)}>{n.name??n.key}</button>：{n.statement}</p>)}
        {section.relations?.map(r=><p key={r.key}><button className="bk-text-button" onClick={()=>onSelect(r.key)}>{r.predicate}</button> · {r.scope}</p>)}
        {(section.materials||section.testAssets)&&<MaterialList materials={section.materials??section.testAssets??[]} onMaterial={onMaterial}/>}
        {section.executionStatus&&<><p>此对象／关系的当前执行：{names[section.executionStatus]??'未知'}。只对应其精确测试方案、版本、快照与环境；邻接对象的通过不替代此处证据。</p>
          {extra.executionTargets?.map((target,i)=><ExecutionTarget key={i} target={target}/>)}</>}
        {section.environmentStatus&&<details><summary>明确记录的执行环境</summary><pre>{JSON.stringify(extra.environments??[],null,2)}</pre><p>原材料和静态测试资产不能证明实际部署或执行通过。</p></details>}
        {section.evidence?.map((c,i)=><blockquote key={i}><p>{c.quote}</p><button className="bk-text-button" onClick={()=>onMaterial(c.materialId)}>回查原文 · 行{c.startLine}–{c.endLine}</button></blockquote>)}
        {section.uncertainties&&<details><summary>前提与不确定性</summary><pre>{JSON.stringify(section.uncertainties,null,2)}</pre></details>}
        {section.unassociatedMaterials&&<UnassociatedCoverage entries={section.unassociatedMaterials}/>}
      </section>;
    })}</>;
}
function ExecutionTarget({target}:{target:Execution}){
  const status=['NOT_RUN','UNKNOWN'].includes(target.status)||target.history?.[0]?.trusted?target.status:'UNKNOWN';
  return <details><summary>{names[status]??'未知'} · 测试方案{target.testSpecId} v{target.testSpecVersion}</summary>
    <p>对象／关系 {target.objectKey} · 命题 {target.claimId} · 范围 {target.scopeId}</p>
    <p>{target.mappingCurrent===true?'映射仍为当前版本':target.mappingCurrent===false?'映射已失效，仍保留于声明目标集合':'映射时效未知'}；{target.authorityApplies?'已有适用人类决定':'未据此建立人类认可'}。</p>
    <p>快照 {target.snapshotManifestId} · 环境 {target.deploymentId}</p>
    <p>{target.ordering==='UNDETERMINED_RECEIPT_ORDER'?'接收顺序不明，不挑选旧通过结果。':'按服务端接收顺序保留后来失败，不回退旧通过。'}</p>
    <ol>{target.history?.map(h=><li key={h.id}>{h.trusted?(names[h.status]??'未知'):'可信依据未知'} · {h.receivedAt} · {h.id}</li>)}</ol>
    {target.truncated&&<p>历史已截断，不视为完整执行清单。</p>}
  </details>;
}
