"use client";
import {useState} from "react";
import {useCommandContext} from "./use-command.ts";
import type {BusinessKnowledgeClient} from "./client.ts";
import type {AuthorityFixed,AuthorityResponse,AuthorityTarget,ExecutionTarget} from "./authority-types.ts";
const emptyTarget=():AuthorityTarget=>({featureId:"",featureVersion:1,claimId:"",claimVersion:1,scopeId:"",scopeVersion:1,verificationTargets:[]});
const emptyExecution=():ExecutionTarget=>({testSpecId:"",testSpecVersion:1,snapshotManifestId:"",deploymentId:""});
const copyTarget=(t:AuthorityTarget):AuthorityTarget=>({featureId:t.featureId,featureVersion:t.featureVersion,claimId:t.claimId,claimVersion:t.claimVersion,scopeId:t.scopeId,scopeVersion:t.scopeVersion,verificationTargets:t.verificationTargets.map(v=>({...v}))});
function TargetFields({target,index,disabled,onChange,onRemove}:{target:AuthorityTarget;index:number;disabled:boolean;onChange:(value:AuthorityTarget)=>void;onRemove:()=>void}) {
  return <fieldset disabled={disabled}><legend>命题映射 {index+1}</legend><div className="bk-authority-fields">
    {(["feature","claim","scope"] as const).map(kind=><div key={kind}><label>{kind==="feature"?"Feature":kind==="claim"?"Claim":"范围"} ID<input required maxLength={256} value={target[`${kind}Id`]} onChange={e=>onChange({...target,[`${kind}Id`]:e.target.value})}/></label>
      <label>{kind==="feature"?"Feature":kind==="claim"?"Claim":"范围"}版本<input type="number" required min={1} step={1} value={target[`${kind}Version`]} onChange={e=>onChange({...target,[`${kind}Version`]:Number(e.target.value)})}/></label></div>)}
  </div><p>执行目标必须固定测试方案版本、SnapshotManifest 与环境，不使用材料 Bundle 代替。</p>
    {target.verificationTargets.map((v,i)=><fieldset key={i}><legend>执行目标 {i+1}</legend><div className="bk-authority-fields">
      {(["testSpecId","testSpecVersion","snapshotManifestId","deploymentId"] as const).map(field=><label key={field}>{({testSpecId:"测试方案 ID",testSpecVersion:"测试方案版本",snapshotManifestId:"SnapshotManifest ID",deploymentId:"环境 ID"})[field]}
        <input required maxLength={256} type={field==="testSpecVersion"?"number":"text"} min={1} step={1} value={v[field]} onChange={e=>onChange({...target,verificationTargets:target.verificationTargets.map((item,n)=>n===i?{...item,[field]:field==="testSpecVersion"?Number(e.target.value):e.target.value}:item)})}/></label>)}
    </div><button type="button" className="bk-text-button" onClick={()=>onChange({...target,verificationTargets:target.verificationTargets.filter((_,n)=>n!==i)})}>移除此执行目标</button></fieldset>)}
    <button type="button" className="button" disabled={target.verificationTargets.length>=20} onClick={()=>onChange({...target,verificationTargets:[...target.verificationTargets,emptyExecution()]})}>添加执行目标</button>
    <button type="button" className="bk-text-button" onClick={onRemove}>移除此命题映射</button>
  </fieldset>;
}
export function AuthorityEditor({client,revision,objectKey,fixed,value,onAccessLost,onRefresh}:{client:BusinessKnowledgeClient;revision:string;objectKey:string;fixed:AuthorityFixed;value:AuthorityResponse;onAccessLost:(error:Error)=>void;onRefresh:()=>void}) {
  const [targets,setTargets]=useState<AuthorityTarget[]>(()=>value.bindingSet?.targets.length?value.bindingSet.targets.map(copyTarget):[emptyTarget()]);
  const [rationale,setRationale]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const beginCommand=useCommandContext(client,`${revision}:${objectKey}:${value.currentBindingVersion}`);
  const submit=async()=>{
    if(busy||error||!confirmed||!rationale.trim())return;
    const current=beginCommand();setBusy(true);
    try{
      await client.bindAuthority(revision,{operationId:`web-map-${crypto.randomUUID()}`,objectKey,expectedGraphDigest:fixed.graphDigest,expectedVersion:value.currentBindingVersion,rationale,targets},fixed);
      if(current())onRefresh();
    }catch(cause){if(current()){const issue=cause instanceof Error?cause:new Error("映射未确认");setError(issue.message);setConfirmed(false);onAccessLost(issue);}}
    finally{if(!client.signal?.aborted)setBusy(false);}
  };
  return <details className="bk-authority-editor"><summary>显式映射既有权威版本</summary>
    <p>先沿既有 Claim／Decision 治理入口明确创建命题并完成所需审批，再填写其精确版本。本操作仅保存映射，不创建 Claim、不批准决定、不生成执行结果；不提供本地确认或执行开关。</p>
    <form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||!!error}>
      <p>将以完整集合替换映射 v{value.currentBindingVersion}；未列出的旧目标不自动继承。冲突后需重新读取并明确比较。</p>
      {targets.map((target,i)=><TargetFields key={i} target={target} index={i} disabled={busy} onChange={v=>setTargets(old=>old.map((t,n)=>n===i?v:t))} onRemove={()=>setTargets(old=>old.filter((_,n)=>n!==i))}/>)}
      <button className="button" type="button" disabled={targets.length>=50} onClick={()=>setTargets(old=>[...old,emptyTarget()])}>添加命题映射</button>
      {!targets.length&&<p className="bk-warning">提交将显式清空当前映射集合，历史修订仍保留。</p>}
      <label>映射理由<textarea required maxLength={16384} value={rationale} onChange={e=>setRationale(e.target.value)}/></label>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>已比较此发布版本的对象／关系、权威版本及适用范围，确认保存完整映射集合</label>
      <button type="submit" className="button primary" disabled={!confirmed||!rationale.trim()}>保存版本映射</button>
    </fieldset></form>
    {error&&<div className="bk-error" role="alert"><p>{error}。提交结果未在本页确认；不会自动重试或宣称人类已确认。请读取当前映射核对原操作。</p><button className="button" disabled={busy} onClick={onRefresh}>核对服务器映射</button></div>}
  </details>;
}
