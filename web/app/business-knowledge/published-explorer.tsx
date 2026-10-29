"use client";
import {useCallback,useState} from 'react';
import type {BusinessKnowledgeClient} from './client.ts';
import type {PublishedVersion} from './authority-types.ts';
import type {GraphFilter} from './types.ts';
import {useKnowledgeRead} from './use-read.ts';
import {GraphView,MaterialList,PropositionDetails} from './graph-view.tsx';
import {PublishedProjection} from './published-projection.tsx';
import {PublishedOriginal} from './published-original.tsx';
import {ReadIssue} from './read-issue.tsx';
import {openWork} from './work-route.ts';
import {PublishedSevenQuestions} from './published-seven.tsx';
import {propositionName} from './model.ts';

export function PublishedExplorer({client,version,objectKey,materialId,onAccessLost}:{client:BusinessKnowledgeClient;version:PublishedVersion;objectKey:string;materialId?:string;onAccessLost:(e:Error)=>void}){
  const revision=version.publication.graphRevisionId;
  const [filter,setFilter]=useState<GraphFilter>({view:'BUSINESS',text:'',includeUncertain:false,onlyHumanConfirmed:false}),[draft,setDraft]=useState('');
  const load=useCallback((bound:BusinessKnowledgeClient)=>bound.publishedReads(version).graph(filter),[version,filter]);
  const state=useKnowledgeRead(client,`published-query:${revision}:${JSON.stringify(filter)}`,load,onAccessLost,10000);
  const select=(object:string)=>openWork(client.workspaceId,{tab:'published',revision,object});
  const material=(id:string)=>openWork(client.workspaceId,{tab:'published',revision,object:objectKey||undefined,material:id});
  return <section aria-label="发布图谱查询"><div className="bk-tabs" aria-label="发布图谱视图">{([['BUSINESS','业务关系'],['IMPLEMENTATION','实现与依据'],['COVERAGE','材料覆盖']] as const).map(([view,label])=><button className="button" key={view} aria-pressed={filter.view===view} onClick={()=>setFilter(f=>({...f,view}))}>{label}</button>)}</div>
    <form onSubmit={e=>{e.preventDefault();setFilter(f=>({...f,text:draft}));}}><label>查询发布图谱<input value={draft} maxLength={256} onChange={e=>setDraft(e.target.value)}/></label><button className="button">查询</button></form>
    <label><input type="checkbox" checked={filter.includeUncertain} onChange={e=>setFilter(f=>({...f,includeUncertain:e.target.checked}))}/>包含待查解释</label>
    <label><input type="checkbox" checked={filter.onlyHumanConfirmed} onChange={e=>setFilter(f=>({...f,onlyHumanConfirmed:e.target.checked}))}/>仅显示已有明确人工确认的目标</label>
    {filter.onlyHumanConfirmed&&<p className="bk-warning">只筛选当前有效的明确命题及范围；部分确认仍是部分。为显示关系而保留的端点不代表端点获得认可。</p>}
    {state.loading&&<p role="status">正在读取选定版本…</p>}{state.error&&<ReadIssue error={state.error} retry={state.retry}/>}
    {state.data&&<><GraphView graph={state.data} selectedKey={objectKey} onSelect={select} onMaterial={material}/>
      {state.data.nodes.filter(n=>n.selectionRole==='ENDPOINT_CONTEXT_ONLY').map(n=><p key={n.key} className="bk-caption">{propositionName(n)}：仅为关系端点提供上下文，未作人工确认。</p>)}
    </>}
    {(objectKey||materialId)&&<PublishedTrace key={`${revision}:${objectKey}:${materialId??''}`} client={client} version={version} objectKey={objectKey} materialId={materialId} onAccessLost={onAccessLost} onSelect={select} onMaterial={material}/>}
  </section>;
}
function PublishedTrace({client,version,objectKey,materialId,onAccessLost,onSelect,onMaterial}:{client:BusinessKnowledgeClient;version:PublishedVersion;objectKey:string;materialId?:string;onAccessLost:(e:Error)=>void;onSelect:(key:string)=>void;onMaterial:(id:string)=>void}){
  const revision=version.publication.graphRevisionId;
  const load=useCallback((bound:BusinessKnowledgeClient)=>bound.publishedReads(version).trace(materialId?{materialId}:{key:objectKey}),[version,objectKey,materialId]);
  const state=useKnowledgeRead(client,`published-trace:${revision}:${objectKey}:${materialId??''}`,load,onAccessLost,10000);
  const selected=[...state.data?.nodes??[],...state.data?.edges??[]].find(n=>n.key===objectKey);
  return <section className="bk-panel" aria-label="发布依据追溯"><h3>{materialId?'原文与业务反查':'对象与关系依据'}</h3>
    {state.loading&&<p role="status">正在读取固定版本依据…</p>}{state.error&&<ReadIssue error={state.error} retry={state.retry}/>}
    {state.data&&<>{selected&&<><PropositionDetails record={selected} onMaterial={onMaterial}/><PublishedProjection value={selected}/></>}
      {materialId&&<><h4>关联对象</h4>{state.data.nodes.map(n=><p key={n.key}><button className="bk-text-button" onClick={()=>onSelect(n.key)}>{propositionName(n)}</button></p>)}</>}
      {!!state.data.edges.length&&<><h4>有向关系</h4>{state.data.edges.map(e=><details key={e.key}><summary>{e.predicate} · {e.scope}</summary><PropositionDetails record={e} onMaterial={onMaterial}/><button className="bk-text-button" onClick={()=>onSelect(e.key)}>查看这条关系的七问与当前状态</button></details>)}</>}
      <h4>关联原文</h4><MaterialList materials={state.data.materials} onMaterial={onMaterial}/>
      {objectKey&&!materialId&&<PublishedSevenQuestions client={client} version={version} objectKey={objectKey} onSelect={onSelect} onMaterial={onMaterial} onAccessLost={onAccessLost}/>}
    </>}
    {materialId&&<PublishedOriginal client={client} version={version} id={materialId} onAccessLost={onAccessLost}/>}
  </section>;
}
