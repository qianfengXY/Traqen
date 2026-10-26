"use client";
import {useCallback,useState} from 'react';
import type {BusinessKnowledgeClient} from './client.ts';
import type {OperationKind,OperationResult} from './work-types.ts';
import {useKnowledgeRead} from './use-read.ts';
import {ReadIssue} from './read-issue.tsx';
import {BindingDetails,CommandIssue,useWorkCommand} from './work-common.tsx';
import {openWork} from './work-route.ts';

export function ServerSessions({client,revision,originSessionId,onAccessLost}:{client:BusinessKnowledgeClient;revision?:string;originSessionId?:string;onAccessLost:(e:Error)=>void}){
 const [pages,setPages]=useState<(string|undefined)[]>([undefined]);
 const cursor=pages.at(-1);
 const load=useCallback((bound:BusinessKnowledgeClient)=>bound.work().listSessions({limit:10,cursor,graphRevisionId:revision,originSessionId}),[cursor,revision,originSessionId]);
 const state=useKnowledgeRead(client,`session-index:${revision??'all'}:${originSessionId??'all'}:${cursor??'first'}`,load,onAccessLost);
 return <section className="bk-panel" aria-label="服务端工作会话清单"><h3>{revision?'此发布版本的工作会话':'可读取的工作会话'}</h3>
  <p>从服务端分页读取，不依赖本机收藏；只打开已保存记录，不委派私人调查或调用模型。</p>
  {state.error&&<ReadIssue error={state.error} retry={state.retry}/>}{state.loading&&<p role="status">正在读取会话清单…</p>}
  {state.data&&<><ul>{state.data.sessions.map(s=><li key={s.id}><button className="bk-text-button" onClick={()=>openWork(client.workspaceId,{tab:'sessions',session:s.id})}>{s.title}</button>
   <p><code>{s.id}</code> · {s.createdAt} · {s.graphState==='EXPLICITLY_ADOPTED'?`发布版本 ${s.binding.graphRevisionId}`:'新调查尚未明确采用发布图谱'}</p>
   {s.origin&&<p>由会话 {s.origin.sessionId} 创建的新调查，未覆盖旧成果。</p>}</li>)}</ul>
   {!state.data.sessions.length&&<p>本页没有可读取的会话，不据此推断私人调查或其他页不存在。</p>}
   <button className="button" disabled={pages.length===1} onClick={()=>setPages(v=>v.slice(0,-1))}>上一页会话</button>
   <span>第{pages.length}页</span><button className="button" disabled={!state.data.nextCursor} onClick={()=>setPages(v=>[...v,state.data!.nextCursor!])}>下一页会话</button>
  </>}
  <button className="button" onClick={state.retry}>刷新服务端会话清单</button>
 </section>;
}
const kinds:Record<OperationKind,string>={CREATE_SESSION:'创建会话',QUESTION:'独立问题',FEEDBACK:'纠错或复核登记',CONTINUATION:'新材料重新调查',ADOPT_GRAPH:'明确采用发布图谱'};
export function RecoverOperation({client,onAccessLost}:{client:BusinessKnowledgeClient;onAccessLost:(e:Error)=>void}){
 const [kind,setKind]=useState<OperationKind>('CREATE_SESSION'),[op,setOp]=useState(''),[origin,setOrigin]=useState(''),[revision,setRevision]=useState(''),[digest,setDigest]=useState(''),[value,setValue]=useState<OperationResult|null>(null);
 const command=useWorkCommand(client,`manual-operation:${kind}:${op}:${origin}:${revision}:${digest}`,onAccessLost);
 const change=()=>setValue(null);
 return <details className="bk-panel"><summary>按本人原操作键找回受理</summary>
  <p>本机坐标清除后仍可查询本人服务端记录；不知道操作键时可先从上方服务端清单找回会话。404只表示本次尚未查到，不证明从未受理，绝不自动另建或收费。</p>
  <form onSubmit={e=>{e.preventDefault();setValue(null);void command.execute(()=>client.work().operation(op.trim(),{kind,originSessionId:kind==='CREATE_SESSION'?null:origin.trim(),originGraphRevisionId:revision.trim()||null,...(digest.trim()?{expectedRequestDigest:digest.trim()}: {})}),setValue);}}>
   <label>原操作类型<select value={kind} onChange={e=>{change();setKind(e.target.value as OperationKind);}}>{Object.entries(kinds).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   <label>原操作键<input required maxLength={128} value={op} onChange={e=>{change();setOp(e.target.value);}}/></label>
   {kind!=='CREATE_SESSION'&&<label>原会话 ID<input required maxLength={128} value={origin} onChange={e=>{change();setOrigin(e.target.value);}}/></label>}
   <label>操作发起时的发布版本 ID（未采用时留空）<input maxLength={128} required={kind==='CREATE_SESSION'} value={revision} onChange={e=>{change();setRevision(e.target.value);}}/></label>
   <label>原请求摘要（已知时核对）<input maxLength={64} pattern="[a-f0-9]{64}" value={digest} onChange={e=>{change();setDigest(e.target.value);}}/></label>
   <button className="button" disabled={command.busy}>仅 GET 查找原受理</button>
  </form><CommandIssue error={command.error}/>
  {value&&<section aria-label="已定位原操作"><p>已核对本人原操作：{kinds[value.operation.kind]} · {value.operation.id}</p><p>原来源会话 {value.operation.origin.sessionId??'无'} · 原发布版本 {value.operation.origin.graphRevisionId??'未采用'}</p>
   <p>以下是结果会话的当前显式绑定，不会用它改写原操作来源。</p><BindingDetails binding={value.session.binding}/>
   <button className="button" onClick={()=>openWork(client.workspaceId,{tab:'sessions',session:value.session.id,...(value.operation.kind==='QUESTION'?{question:value.operation.result.questionId}: {})})}>打开已核对的原次结果</button>
  </section>}
 </details>;
}
