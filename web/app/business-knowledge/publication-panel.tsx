"use client";
import {useCallback,useState} from "react";
import {BusinessKnowledgeClient,BusinessKnowledgeError} from "./client.ts";
import {useKnowledgeRead} from "./use-read.ts";
import {useCommandContext} from "./use-command.ts";
import {ReadIssue} from "./trace-panel.tsx";
import type {Investigation,PublicationReadiness} from "./types.ts";

const reasons:Record<string,string>={F003_QUALITY_POLICY_UNCONFIRMED:"业务图谱质量计量策略尚未确认",
 F003_IMPLEMENTATION_UNVERIFIED:"实现身份尚未核验",F003_INDEPENDENT_QUALITY_MISSING:"缺少绑定本图谱的独立质量证据",
 F003_BACKUP_UNAVAILABLE:"未配置受保护的配套备份",F003_BACKUP_NOT_COVERED:"配套备份尚未覆盖本次材料与图谱",
 F003_PAIRED_RECOVERY_MISSING:"缺少可信的原生配套恢复证据",F003_BACKUP_BARRIER:"备份围栏期间暂停发布写入",
 F003_PUBLICATION_ROLE_REQUIRED:"当前成员不能维护发布",F003_SYNTHETIC_PROTECTION_NOT_ACCEPTED:"合成保护环境不能证明生产就绪"};

export function PublicationStatus({readiness,canControl,busy,confirmed,onConfirm,onPublish,onImport}:{
 readiness:PublicationReadiness;canControl:boolean;busy:boolean;confirmed:boolean;
 onConfirm:(value:boolean)=>void;onPublish:()=>void;onImport:()=>void;
}){
 const ready=readiness.canPublish&&readiness.status==="READY"&&readiness.missing.length===0&&readiness.policy!==null;
 return <div className="bk-publication" aria-label="业务发布就绪"><p className={ready?"bk-caption":"bk-warning"}>
   {ready?"服务端已核验发布条件。发布会明确更新当前业务版本，不会修改原分析记录。":"发布条件未满足；已保存分析仍可查询，不等于已发布、人工确认或真实执行。"}</p>
   <details><summary>发布条件与证据</summary><ul>{readiness.missing.map((item,i)=><li key={i}>{reasons[item.code]??"尚有服务端核验缺项"} <code>{item.code}</code></li>)}</ul>
    <p>当前头修订：{readiness.currentHead?.version??"尚无当前版本"}。质量策略：{readiness.policy===null?"未确认":"由服务端固定"}。</p>
    <p>质量／恢复证据：{readiness.evidenceRefs.quality??"无"} ／ {readiness.evidenceRefs.recovery??"无"}。模型核查与作者测试不代替独立验收。</p>
    {canControl&&<button className="button" disabled={busy} onClick={onImport}>导入服务器核验证据</button>}
    <p>导入是明确写操作，只读取服务器配置的可信文件；打开本页不会暗中导入。</p>
   </details>
   {ready&&canControl&&<div><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>onConfirm(event.target.checked)}/>确认发布此精确图谱，并以当前头修订执行冲突检查</label>
    <button className="button primary" disabled={busy||!confirmed} onClick={onPublish}>发布业务版本</button></div>}
 </div>;
}

export function PublicationPanel({client,run,canControl,onAccessLost}:{client:BusinessKnowledgeClient;run:Investigation;canControl:boolean;onAccessLost:(error:Error)=>void}){
 const load=useCallback(async(bound:BusinessKnowledgeClient)=>{
  const [readiness,current]=await Promise.all([bound.publicationReadiness(run.id),bound.currentPublication()]);
  if(readiness.binding.graphDigest!==run.latestGraph?.digest||readiness.binding.sourceInput.sourceBundleSnapshotId!==run.sourceInput.sourceBundleSnapshotId
    ||readiness.binding.profileId!==run.profile.id)throw new BusinessKnowledgeError("发布条件不属于当前已选定的分析图谱。","F003_RESPONSE_INVALID");
  return{readiness,current};
 },[run.id,run.latestGraph?.digest,run.sourceInput.sourceBundleSnapshotId,run.profile.id]);
 const state=useKnowledgeRead(client,`publication:${run.id}:${run.latestGraph?.digest}`,load,onAccessLost);
 const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const beginCommand=useCommandContext(client,`${run.id}:${run.latestGraph?.digest}`);
 const refresh=()=>{setError("");setConfirmed(false);state.retry();};
 const mutate=async(publish:boolean)=>{
  if(busy||error||!canControl||!state.data)return;
  const {readiness,current}=state.data;
  if(publish&&(!confirmed||!readiness.canPublish||readiness.status!=="READY"||readiness.missing.length||readiness.policy===null))return;
  const active=beginCommand();
  setBusy(true);setNotice("");
  try{
   if(publish){const version=readiness.currentHead?.version??0;
    if((current.head?.version??0)!==version)throw Error("读取的当前头已变化，请重新核验后决定。");
    // The operation identity binds the exact graph and expected head. An
    // explicit retry of an ambiguous unchanged request cannot create a new head.
    await client.publish(run.id,{operationId:`web-${readiness.binding.graphDigest}-${version}`,expectedGraphDigest:readiness.binding.graphDigest,expectedHeadVersion:version});
    if(!active())return;setNotice("发布响应已确认；正在读取服务器当前版本。");
   }else{const imported=await client.importPublicationEvidence(run.id);if(!active())return;
    setNotice(`导入响应已确认：${imported.importedEvidenceRefs.length}份证据。就绪结论仍由服务端重新核验。`);}
   setConfirmed(false);state.retry();
  }catch(cause){if(active()){const issue=cause instanceof Error?cause:new Error("发布操作未确认");setError(issue.message);setConfirmed(false);onAccessLost(issue);}}
  finally{if(!client.signal?.aborted)setBusy(false);}
 };
 return <section aria-label="业务版本发布">{state.loading&&<p role="status">正在读取服务端发布条件…</p>}
  {state.error&&<ReadIssue error={state.error} retry={state.retry}/>}
  {error&&<p className="bk-error" role="alert">{error}。未自动重试、未切换到最新版本。请先重新读取服务端发布状态。</p>}
  {notice&&<p role="status">{notice}</p>}
  {state.data&&<>{state.data.current.publication?.graphDigest===run.latestGraph?.digest
   ?<p>此精确分析已是当前发布版本 · r{state.data.current.head?.version}。原分析仍保留为独立记录。</p>
   :<PublicationStatus readiness={state.data.readiness} canControl={canControl} busy={busy||!!error} confirmed={confirmed} onConfirm={setConfirmed} onPublish={()=>void mutate(true)} onImport={()=>void mutate(false)}/>}</>}
  <button className="bk-text-button" onClick={refresh} disabled={busy}>重新读取发布状态</button>
 </section>;
}
