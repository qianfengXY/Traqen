"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeProductRoute } from "../product-navigation.ts";
import { SourceClientError } from "../source-truth/client.ts";
import type { SourceOverview } from "../source-truth/types.ts";
import { FactsClientError } from "./client.ts";
import { evidenceHref, evidenceReturnHref, evidenceResultKey, readEvidenceLocation, type EvidenceLocation } from "./model.ts";
import { RecordBrowser, CoverageView } from "./record-browser.tsx";
import { DeliveryPanel } from "./delivery-panel.tsx";
import { useEvidenceResource } from "./use-resource.ts";
import { RequestPanel } from "./request-panel.tsx";
import type { FactsOverview, Manifest, Run, Scope } from "./types.ts";
import { EvidenceTransport } from "./transport.ts";
import "./workbench.css";

const steps = [
 { title: "选择材料", input: "F001 已冻结的来源与组件", output: "固定的分析范围" },
 { title: "技术分析", input: "固定材料与程序规则", output: "实际处理进度与技术成果" },
 { title: "查看事实与关联", input: "同次分析产生的对象与事实", output: "可回查的关系、原文与规则依据" },
 { title: "检查覆盖与缺口", input: "材料 × 能力的真实处置", output: "限制分类、未知与影响范围" },
 { title: "封存与交付", input: "已完成并检查过的成果", output: "不可变版本、导出与历史" },
];
const clearRecord = { kind: undefined, recordId: undefined, line: undefined, lineEnd: undefined, windowLine: undefined, graphRootId: undefined, relationReturn: undefined };

export function DeterministicFactsWorkbench({ apiBase, apiToken, workspaceId, workspaceName }: {
 apiBase: string; apiToken: string; workspaceId: string; workspaceName: string;
}) {
 return <section className="f002-workbench" aria-label="技术证据工作台"><EvidenceSession key={workspaceId} apiBase={apiBase} token={apiToken} workspaceId={workspaceId} workspaceName={workspaceName} /></section>;
}
function EvidenceSession({ apiBase, token, workspaceId, workspaceName }: { apiBase: string; token: string; workspaceId: string; workspaceName: string }) {
 const search=useSyncExternalStore(subscribeProductRoute,()=>window.location.search,()=>"");
 const parsed=useMemo(()=>{try{const context=search?readEvidenceLocation(search):{workspaceId,tab:"objects" as const};if(context.workspaceId!==workspaceId)throw Error("引用属于另一工作区，不能在当前身份上下文读取。");return {context,error:null};}catch(error){return {context:null,error:error as Error};}},[search,workspaceId]);
 const context=parsed.context;
 const transport=useMemo(()=>new EvidenceTransport(apiBase,token,workspaceId),[apiBase,token,workspaceId]);
 const clients=useSyncExternalStore(transport.subscribe,transport.getSnapshot,transport.getServerSnapshot);
 const [overview,setOverview]=useState<FactsOverview|null>(null),[access,setAccess]=useState<SourceOverview|null>(null),[trackedRun,setTrackedRun]=useState<Run|null>(null);
 const [error,setError]=useState<Error|null>(null),[lost,setLost]=useState(false),[refreshKey,setRefreshKey]=useState(0),sequence=useRef(0);
 const navigate=useCallback((next:EvidenceLocation,replace=false)=>{const href=evidenceHref(next);if(`${location.pathname}${location.search}`===href)return;window.history[replace?"replaceState":"pushState"](null,"",href);window.dispatchEvent(new Event("traqen:navigate"));},[]);
 const accessLost=useCallback((error:Error)=>{sequence.current++;transport.close();setOverview(null);setAccess(null);setTrackedRun(null);setError(error);setLost(true);},[transport]);
 const refresh=useCallback(async()=>{if(!clients||clients.facts.signal?.aborted||lost)return;const read=++sequence.current;
  try{const result=await clients.facts.request<FactsOverview>();if(clients.facts.signal?.aborted||read!==sequence.current)return;setOverview(result);setError(null);
   const currentAccess=await clients.sources.request<SourceOverview>();if(!clients.facts.signal?.aborted&&read===sequence.current)setAccess(currentAccess);
  }catch(error){if(clients.facts.signal?.aborted||read!==sequence.current)return;if((error instanceof FactsClientError||error instanceof SourceClientError)&&[401,403].includes(error.status))accessLost(error);else setError(error as Error);}
 },[clients,lost,accessLost]);
 useEffect(()=>{let reading=false,active=true;const observe=async()=>{if(!active||reading)return;reading=true;try{await refresh();}finally{reading=false;}};void observe();const timer=window.setInterval(()=>void observe(),5000);window.addEventListener("focus",observe);return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",observe);};},[refresh,refreshKey]);
 const previewClient=useMemo(()=>clients&&context?.preview?clients.facts.withPreview(context.preview):clients?.facts,[clients,context?.preview?.runId,context?.preview?.scopeId,context?.preview?.revision]);
 const runChanged=useCallback((run:Run)=>setTrackedRun(run),[]);
 if(parsed.error||!context)return <section className="f002-panel"><h1>技术证据</h1><p role="alert">固定引用无效：{parsed.error?.message}。没有替换为其他材料或版本。</p></section>;
 const step=context.step??(context.graphVersionId||context.preview?(context.tab==="coverage"?4:context.tab==="delivery"?5:3):1);
 const current=overview?.versions.find(version=>version.graphVersionId===context.graphVersionId),latest=overview?.versions.at(-1);
 const chooseVersion=(graphVersionId:string,run?:Run)=>navigate({...context,...clearRecord,graphVersionId,runId:run?.id??overview?.versions.find(v=>v.graphVersionId===graphVersionId)?.runId??context.runId,preview:undefined,step:3,tab:"objects",sourceVersionId:run?.sourceInput.bundleId??overview?.versions.find(v=>v.graphVersionId===graphVersionId)?.bundleId});
 const openPreview=(run:Run,scope:Scope,targetStep=3)=>navigate({...context,...clearRecord,graphVersionId:undefined,runId:run.id,preview:{runId:run.id,scopeId:scope.scopeId,revision:scope.revision},sourceVersionId:run.sourceInput.bundleId,step:targetStep,tab:targetStep===4?"coverage":"objects"});
 const ready=trackedRun?.scopes.find(s=>s.status==="READY_TO_SEAL");
 const openStep=(next:number)=>{
  const base={...context,step:next,tab:next===4?"coverage" as const:next===3?"objects" as const:"delivery" as const};
  if([3,4].includes(next)&&!context.graphVersionId&&!context.preview&&trackedRun&&ready)navigate({...base,...clearRecord,preview:{runId:trackedRun.id,scopeId:ready.scopeId,revision:ready.revision},runId:trackedRun.id,sourceVersionId:trackedRun.sourceInput.bundleId});
  else navigate(base);
 };
 const sourceMismatch=Boolean(current&&context.sourceVersionId&&context.sourceVersionId!==current.bundleId);
 const resultKey=evidenceResultKey(context),returnHref=evidenceReturnHref(context);
 const hasResults=Boolean(resultKey||trackedRun?.scopes.some(scope=>["READY_TO_SEAL","SEALED"].includes(scope.status)));
 const runStatus=trackedRun?.scopes.map(s=>({QUEUED:"等待执行",RUNNING:"分析中",READY_TO_SEAL:"结果待检查",SEALED:"已封存",FAILED_RETRYABLE:"分析失败",BLOCKED:"受阻",CANCELLED:"已取消"} as Record<string,string>)[s.status]??"状态待核实").join("、");
 return <>
  <header className="f002-heading"><div><p className="eyebrow">TECHNICAL EVIDENCE · {workspaceName}</p><h1>技术证据</h1><p>选择冻结材料，查看程序提取的事实、关联和原文，检查限制后明确封存。</p></div><div className="f002-actions">{returnHref&&<a className="button" href={returnHref}>返回原回答／会话入口</a>}<button className="button" disabled={lost} onClick={()=>setRefreshKey(v=>v+1)}>复验权限并刷新</button></div></header>
  <nav className="f002-journey" aria-label="技术分析五步旅程">{steps.map((s,i)=><button key={s.title} aria-current={step===i+1?"step":undefined} onClick={()=>openStep(i+1)}><b>{i+1}</b><span>{s.title}<small>{i===1?runStatus??"尚未开始":i===4?context.graphVersionId?"已封存":"待封存":i===2?hasResults?"可查看成果":trackedRun?"尚无可读成果":"等待分析":i===3?hasResults?"可检查范围":trackedRun?"尚无可读成果":"等待成果":context.sourceVersionId||trackedRun?"已选冻结材料":"待选择"}</small></span></button>)}</nav>
  <section className="f002-stage-summary" aria-label="当前步骤"><h2>{steps[step-1].title}</h2><p>输入：{steps[step-1].input}　·　产出：{steps[step-1].output}</p><p>{step===1?"完成条件：选定一个已冻结来源及材料范围。":step===2?"完成条件：实际材料和能力工作项处理结束；失败、未知与取消均保留真实状态。":step===3?"完成条件：核对事实、关联方向及其原文和规则前提。":step===4?"完成条件：查看已处理范围、未知与不支持情况，判断其影响。":"完成条件：分析完成、封存检查通过，并由你点击封存。"}</p></section>
  <details className="f002-context"><summary>固定来源、规则与历史版本</summary><div><b>F001 来源版本</b><code>{context.sourceVersionId??trackedRun?.sourceInput.bundleId??"选定材料后绑定"}</code></div><div><label>已封存历史<select aria-label="选择固定事实集" value={context.graphVersionId??""} disabled={!overview||lost} onChange={e=>{if(e.target.value)chooseVersion(e.target.value);}}><option value="">选择已封存结果</option>{context.graphVersionId&&!current&&<option value={context.graphVersionId}>{context.graphVersionId} · 原固定引用</option>}{overview?.versions.map(v=><option key={v.graphVersionId} value={v.graphVersionId}>{new Date(v.publishedAt).toLocaleString()} · {v.graphVersionId.slice(0,12)}…</option>)}</select></label></div>{context.businessGraphRevisionId&&<div>F003 来路：{context.businessGraphRevisionId}</div>}</details>
  {context.preview&&<aside className="f002-result-banner" aria-label="未封存成果"><b>结果待检查 · 尚未封存</b><p>正在读取本次分析的实际成果，尚无正式事实集版本。封存后原记录内容保留，产生固定版本。</p><details><summary>成果精确定位</summary><p>运行 {context.preview.runId} · 范围 {context.preview.scopeId} · 修订 {context.preview.revision} · 来源 {context.sourceVersionId}</p></details></aside>}
  {context.graphVersionId&&<p className="f002-result-banner">已封存 · 正在读取固定版本。{latest&&current&&latest.graphVersionId!==current.graphVersionId&&<button className="button" onClick={()=>chooseVersion(latest.graphVersionId)}>明确查看新版本</button>}</p>}
  {lost?<section className="f002-panel" role="alert"><h2>访问已停止</h2><p>账号权限变化或登录失效，已停止读取并清除原展示；请重新登录或确认当前工作区授权。</p><p>{error?.message}</p></section>
   :!overview||!clients?<section className="f002-panel"><h2>技术证据访问尚未就绪</h2>{error?<p role="alert">{error.message}。不可用不是空结果；未创建任务。</p>:<p role="status">正在验证成员、工作区和持久化服务…</p>}</section>
   :<>
    {error&&<p role="alert">最新状态读取未完成：{error.message}。保留上次阅读定位，不据此授予新写权限。</p>}
    {access&&<DeliveryPanel key={`${workspaceId}:${access.actor.actorId}`} client={clients.facts} sourceClient={clients.sources} actorId={access.actor.actorId} workspaceId={workspaceId} writable={access.role==="MAINTAIN"&&!error} profiles={overview.profiles} versions={overview.versions} runs={overview.activeRuns} versionId={context.graphVersionId} onVersion={chooseVersion} refresh={refresh} onAccessLost={accessLost} step={step} initialRunId={context.runId} onRunChange={runChanged}
     onRunSelected={run=>navigate({...context,...clearRecord,runId:run.id,sourceVersionId:run.sourceInput.bundleId,graphVersionId:undefined,preview:undefined,step:2,tab:"delivery"})} onPreview={openPreview} onStep={openStep}/>}
    {[3,4].includes(step)&&(sourceMismatch?<section className="f002-panel" role="alert"><h2>固定来源与事实集不匹配</h2><p>保留原引用，不用另一来源补齐；请核对需要读取的版本。</p></section>:!resultKey?<section className="f002-panel"><h2>尚无可检查成果</h2><p>先选择材料并完成分析。正在运行的任务保留，可返回查看真实进度。</p><button className="button primary" onClick={()=>openStep(trackedRun?2:1)}>{trackedRun?"查看分析进度":"选择材料"}</button></section>:!access||!previewClient?<p role="status">正在复验当前成员…</p>:<>
     <PreviewGuard client={clients.facts} context={context} accessLost={accessLost} onTask={()=>openStep(2)}><nav className="f002-tabs" aria-label="成果浏览">{step===3?<><button aria-current={context.tab!=="relations"?"page":undefined} onClick={()=>navigate({...context,tab:"objects"})}>对象与事实</button><button aria-current={context.tab==="relations"?"page":undefined} onClick={()=>navigate({...context,tab:"relations"})}>关系</button></>:null}</nav>
     {step===4?<CoverageView key={`${access.actor.actorId}:${resultKey}`} actorId={access.actor.actorId} client={previewClient} context={context} navigate={navigate} accessLost={accessLost}/>:<RecordBrowser key={`${access.actor.actorId}:${resultKey}`} actorId={access.actor.actorId} client={previewClient} context={context} navigate={navigate} accessLost={accessLost}/>}
     <div className="f002-actions f002-next"><button className="button primary" onClick={()=>openStep(step===3?4:5)}>{step===3?"继续检查覆盖与缺口":"继续封存与交付"}</button></div></PreviewGuard>
    </>)}
    {context.graphVersionId&&access&&!sourceMismatch&&step===5&&<RequestPanel key={`${access.actor.actorId}:${context.graphVersionId}`} client={clients.facts} context={context} actorId={access.actor.actorId} configured={overview.consumer.configured} writable={access.role==="MAINTAIN"&&!error} profiles={overview.profiles} navigate={navigate} onAccessLost={accessLost}/>}
   </>}
 </>;
}

function PreviewGuard({ client, context, accessLost, onTask, children }: { client: import("./client.ts").DeterministicFactsClient; context: EvidenceLocation; accessLost:(error:Error)=>void; onTask:()=>void; children:React.ReactNode }) {
 const preview=context.preview;
 const route=preview?`/runs/${preview.runId}/scopes/${preview.scopeId}/preview/${preview.revision}/manifest`:"";
 const load=useCallback(async(bound:typeof client)=>route?(await bound.request<{manifest:Manifest}>(route)).manifest:null,[route]);
 const metadata=useEvidenceResource(client,route,load,accessLost);
 if(!preview)return children;
 if(metadata.error)return <section className="f002-panel" role="alert">成果暂不可读：{metadata.error.message}<button className="button" onClick={metadata.retry}>复验成果</button><button className="button" onClick={onTask}>返回真实任务</button></section>;
 if(!metadata.data)return <p role="status">正在核对未封存成果的运行、修订和来源…</p>;
 if(metadata.data.preview?.source.bundleId!==context.sourceVersionId)return <section className="f002-panel" role="alert">成果来源与固定引用不匹配；没有读取另一来源的内容。<button className="button" onClick={onTask}>返回真实任务</button></section>;
 return children;
}
