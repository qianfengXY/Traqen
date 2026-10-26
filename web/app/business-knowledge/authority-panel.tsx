"use client";
import {useCallback,useState} from "react";
import {BusinessKnowledgeClient,BusinessKnowledgeError} from "./client.ts";
import {useKnowledgeRead} from "./use-read.ts";
import {AuthorityStatus} from "./authority-status.tsx";
import {AuthorityEditor} from "./authority-editor.tsx";
import {ReadIssue} from "./read-issue.tsx";
import type {Investigation} from "./types.ts";

export function AuthorityPanel({client,run,objectKey,canControl,onAccessLost}:{client:BusinessKnowledgeClient;run:Investigation;objectKey:string;canControl:boolean;onAccessLost:(error:Error)=>void}) {
  const [revision,setRevision]=useState(""),[manual,setManual]=useState("");
  const load=useCallback((bound:BusinessKnowledgeClient)=>bound.publishedVersions(),[]);
  const versions=useKnowledgeRead(client,`published-versions:${run.id}:${run.latestGraph?.digest}`,load,onAccessLost);
  const matching=versions.data?.filter(p=>p.investigationId===run.id&&p.graphDigest===run.latestGraph?.digest&&p.binding.sourceInput.sourceBundleSnapshotId===run.sourceInput.sourceBundleSnapshotId&&p.binding.profileId===run.profile.id);
  return <section aria-label="发布版本的决定与执行"><h3>发布版本的决定与执行</h3><p>原分析不因发布、映射或后来的人类决定而改写。请选择与此对象来源一致的精确发布版本，不自动切换当前头。</p>
    {versions.loading&&<p role="status">正在核对已发布版本…</p>}{versions.error&&<ReadIssue error={versions.error} retry={versions.retry}/>}
    <button className="bk-text-button" onClick={versions.retry}>刷新已发布版本清单</button>
    {matching?.map(p=><p key={p.graphRevisionId}><button className="button" aria-pressed={revision===p.graphRevisionId} onClick={()=>setRevision(p.graphRevisionId)}>读取发布版本 r{p.headVersion} 的决定与执行</button> <small>{p.graphRevisionId}</small></p>)}
    {matching?.length===0&&<p className="bk-warning">此分析尚无已核实的发布版本，不能建立权威映射。清单仅含最近1000次发布；更早版本可按精确修订读取。未发布或发布地基不足时不能绕过服务端阻断。</p>}
    <details><summary>按精确 GraphRevision 回查历史</summary><form onSubmit={e=>{e.preventDefault();setRevision(manual.trim());}}><label>发布 GraphRevision ID<input required maxLength={256} value={manual} onChange={e=>setManual(e.target.value)}/></label><button className="button">读取精确发布版本</button></form></details>
    {revision&&<FixedAuthority key={`${run.id}:${run.latestGraph?.digest}:${revision}:${objectKey}`} client={client} run={run} revision={revision} objectKey={objectKey} canControl={canControl} onAccessLost={onAccessLost}/>}
  </section>;
}
function FixedAuthority({client,run,revision,objectKey,canControl,onAccessLost}:{client:BusinessKnowledgeClient;run:Investigation;revision:string;objectKey:string;canControl:boolean;onAccessLost:(error:Error)=>void}) {
  const [history,setHistory]=useState<number|undefined>(),[input,setInput]=useState(1),[refresh,setRefresh]=useState(0);
  const load=useCallback(async(bound:BusinessKnowledgeClient)=>{
    const fixed={graphDigest:run.latestGraph?.digest??"",sourceBundleId:run.sourceInput.sourceBundleSnapshotId,profileId:run.profile.id};
    const version=await bound.publishedVersion(revision,run.id,fixed);
    if(![...version.graph.candidates,...version.graph.relations].some(p=>p.key===objectKey&&p.state!=="QUARANTINED"))throw new BusinessKnowledgeError("此发布版本中没有可映射的选定对象或关系。","F003_RESPONSE_INVALID");
    return bound.authorityBindings(revision,objectKey,fixed,history);
  },[run.id,run.latestGraph?.digest,run.sourceInput.sourceBundleSnapshotId,run.profile.id,revision,objectKey,history]);
  const state=useKnowledgeRead(client,`authority:${revision}:${objectKey}:${history??"current"}:${refresh}`,load,onAccessLost,10000);
  const retry=()=>{setRefresh(v=>v+1);state.retry();};
  return <section className="bk-authority"><p className="bk-caption">固定发布修订 {revision} · 对象／关系 {objectKey}</p>
    <form className="bk-authority-history" onSubmit={e=>{e.preventDefault();setHistory(input);}}><label>历史映射修订<input type="number" required min={1} step={1} value={input} onChange={e=>setInput(Number(e.target.value))}/></label><button className="button">读取历史映射</button><button type="button" className="button" onClick={()=>{setHistory(undefined);retry();}}>读取当前映射</button></form>
    {state.loading&&<p role="status">正在读取当前权威与执行投影…</p>}{state.error&&<ReadIssue error={state.error} retry={retry}/>}
    {state.data&&<><AuthorityStatus value={state.data}/>{canControl&&history===undefined&&<AuthorityEditor key={`${revision}:${objectKey}:${state.data.currentBindingVersion}:${refresh}`} client={client} revision={revision} objectKey={objectKey}
      fixed={{graphDigest:run.latestGraph?.digest??"",sourceBundleId:run.sourceInput.sourceBundleSnapshotId}} value={state.data} onAccessLost={onAccessLost} onRefresh={retry}/>}</>}
    {history!==undefined&&<p>历史映射只读；当前权威和可信执行仍按当前权限重新求值，不复活过期决定或旧通过。</p>}
    <button className="bk-text-button" onClick={retry}>刷新决定与执行投影</button>
  </section>;
}
