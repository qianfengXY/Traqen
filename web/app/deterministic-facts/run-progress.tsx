"use client";
import { useCallback, useEffect, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import type { Scope } from "./types.ts";

type Unit = { phase: string; completed: number; total: number | null; path?: string; updatedAt: string; generation: number };
type Progress = { scope: Scope; latest: Unit | null; events: Unit[]; workItems: { total: number; completed: number; pending: number } };
const phases: Record<string, string> = { LOADING: "载入冻结材料", NORMALIZE: "核对材料身份与格式", MATERIALS: "处理材料、解析支持格式",
 DOCUMENT_LINKS: "建立文档链接", JAVASCRIPT_MODULES: "解析模块导入与调用", JAVA_BINDINGS: "建立 Java 绑定", TEST_REFERENCES: "关联测试与声明",
 ENDPOINT_CONTRACTS: "关联接口合同", SORT_OBJECTS: "整理对象", SORT_EVIDENCE: "整理原文证据", SORT_FACTS: "整理事实", SORT_GAPS: "整理缺口",
 RESULT: "解析器已返回成果", ASSEMBLE: "组合材料与来源缺口", VERIFY: "校验成果闭包并保存", READY: "成果已就绪，等待检查与封存" };
export function RunProgress({ client, runId, scope, accessLost }: { client: DeterministicFactsClient; runId: string; scope: Scope; accessLost: (error: Error) => void }) {
 const [snapshot,setSnapshot]=useState<Progress|null>(null),[error,setError]=useState<Error|null>(null),[now,setNow]=useState(0);
 const load=useCallback(async(signal:AbortSignal)=>{
  try { const data=await client.withSignal(signal).request<{progress:Progress}>(`/runs/${runId}/scopes/${scope.scopeId}/progress`);
   if(!signal.aborted){setSnapshot(data.progress);setError(null);setNow(Date.now());}
  }catch(e){if(!signal.aborted){if(e instanceof FactsClientError&&[401,403].includes(e.status))accessLost(e);else setError(e as Error);}}
 },[client,runId,scope.scopeId,accessLost]);
 useEffect(()=>{const controller=new AbortController(),signal=client.signal?AbortSignal.any([client.signal,controller.signal]):controller.signal;let reading=false;
  const observe=async()=>{if(reading||signal.aborted)return;reading=true;try{await load(signal);}finally{reading=false;}};
  void observe();const timer=window.setInterval(()=>{setNow(Date.now());if(["QUEUED","RUNNING"].includes(scope.status))void observe();},1000);
  return()=>{clearInterval(timer);controller.abort();};},[client,load,scope.status]);
 const latest=snapshot?.latest,material=snapshot?.events.find(e=>e.phase==="MATERIALS");
 const lastPath=latest?.path??snapshot?.events.findLast(unit=>unit.path)?.path;
 const stale=latest&&now-Date.parse(latest.updatedAt)>15000&&["QUEUED","RUNNING"].includes(scope.status);
 return <section className="f002-progress" aria-label="真实解析进度" aria-live="polite">
  <h4>{scope.status==="QUEUED"?"等待执行":scope.status==="FAILED_RETRYABLE"?"分析失败":scope.status==="CANCELLED"?"已取消":scope.status==="BLOCKED"?"处理受阻":scope.status==="SEALED"?"成果已封存":latest?phases[latest.phase]??latest.phase:"正在读取实际处理状态"}</h4>
  {error&&<p role="alert">进度读取未完成：{error.message}。未推断任务已停止。<button className="button" onClick={()=>{const c=new AbortController();void load(client.signal??c.signal);}}>重新读取进度</button></p>}
  {latest&&<><p>{latest.phase==="LOADING"?`已核对 ${latest.completed} 个材料条目${latest.total===null?"，范围总数尚在核对":` / 共 ${latest.total} 项`}`:material?`已处理材料条目 ${material.completed} / ${material.total}（含目录及不可解析项）`:"材料总数尚在核对"}</p>
   {latest.phase==="MATERIALS"&&latest.total!==null&&latest.total>0&&<progress aria-label="已处理材料条目" value={latest.completed} max={latest.total}/>}
   {lastPath&&<p className="f002-current-file">最近实际处理：<code>{lastPath}</code></p>}
   <p>最新进度：<time dateTime={latest.updatedAt}>{new Date(latest.updatedAt).toLocaleTimeString()}</time> · 已完成工作项 {snapshot?.workItems.completed} / {snapshot?.workItems.total}</p>
   {stale&&<p role="status">超过 15 秒未收到新的处理状态，仍在核查此运行；可以重读状态或取消，不会另建任务。</p>}
   <details><summary>本次实际处理阶段记录</summary><ol>{snapshot?.events.map(unit=><li key={unit.phase}>{phases[unit.phase]??unit.phase} · {unit.phase==="MATERIALS"||unit.phase==="LOADING"?`${unit.completed}${unit.total===null?"":` / ${unit.total}`} 个材料条目`:`已处理 ${unit.completed} 个材料条目，非此阶段百分比`} · <time>{new Date(unit.updatedAt).toLocaleTimeString()}</time></li>)}</ol></details>
  </>}
  {!latest&&<p>{scope.status==="QUEUED"?"任务已持久保存，等待 worker 取得执行权。":"尚未取得可核实的进度记录；不推算百分比或剩余时间。"}</p>}
 </section>;
}
