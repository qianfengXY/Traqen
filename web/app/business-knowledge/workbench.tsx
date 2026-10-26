"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { subscribeProductRoute } from "../product-navigation.ts";
import { BusinessKnowledgeClient } from "./client.ts";
import { KnowledgeTransport } from "./read-session.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { knowledgePosition, shortId, writeKnowledgePosition } from "./model.ts";
import { investigationKind } from './investigation-kind.ts';
import { StartPanel } from "./start-panel.tsx";
import { ReadIssue } from "./trace-panel.tsx";
import { InvestigationDetail } from "./investigation-detail.tsx";
import type { Investigation } from "./types.ts";
import {workPosition,openWork} from './work-route.ts';
import {PublishedLibrary} from './published-library.tsx';
import {WorkSessions} from './work-sessions.tsx';
import {ReviewRoleContext,type ReviewRoleSelection} from './review-role.tsx';
import "./workbench.css";

const search = () => window.location.search, serverSearch = () => "";
export function BusinessKnowledgeWorkbench({ apiBase, workspaceId, workspaceName, actorId, reviewRoles }: {
  apiBase: string; workspaceId: string; workspaceName: string; actorId: string;
  reviewRoles?:ReviewRoleSelection;
}) {
  const [attempt, setAttempt] = useState(0);
  return <ReviewRoleContext.Provider value={reviewRoles??{roles:[],selected:'',choose:()=>{}}}><KnowledgeSession key={`${workspaceId}:${actorId}:${attempt}`} apiBase={apiBase} workspaceId={workspaceId}
    workspaceName={workspaceName} actorId={actorId} onRetry={() => setAttempt(value => value + 1)} /></ReviewRoleContext.Provider>;
}

function KnowledgeSession({ apiBase, workspaceId, workspaceName, actorId, onRetry }: {
  apiBase: string; workspaceId: string; workspaceName: string; actorId: string; onRetry: () => void;
}) {
  const [transport] = useState(() => new KnowledgeTransport(apiBase, workspaceId));
  const connection = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getServerSnapshot);
  const route=useSyncExternalStore(subscribeProductRoute,search,serverSearch),position=workPosition(route,workspaceId);
  return <div className="bk-workbench" data-testid="business-knowledge-workbench"><header className="bk-page-heading">
    <div><p className="bk-caption">{workspaceName}</p><h1>业务图谱</h1><p>围绕业务问题调查固定材料，浏览对象、关系与可回查的依据。</p></div>
  </header>
    <nav className="bk-tabs" aria-label="知识入口">{([['published','已发布知识'],['sessions','工作会话与问答'],['investigations','我的调查']] as const).map(([tab,label])=><button className="button" aria-pressed={position.tab===tab} key={tab} onClick={()=>{openWork(workspaceId,{tab});if(connection.error)onRetry();}}>{label}</button>)}</nav>
    {connection.error ? <ReadIssue error={connection.error} retry={onRetry} /> : connection.client
      ? <KnowledgeBoard client={connection.client} apiBase={apiBase} actorId={actorId} onAccessLost={transport.refuse} />
      : <section className="bk-panel" role="status">正在建立当前成员的调查读取上下文…</section>}
  </div>;
}

function KnowledgeBoard({ client, apiBase, actorId, onAccessLost }: {
  client: BusinessKnowledgeClient; apiBase: string; actorId: string; onAccessLost: (error: Error) => void;
}) {
  const route=useSyncExternalStore(subscribeProductRoute,search,serverSearch),position=workPosition(route,client.workspaceId);
  if(position.error)return <div className="bk-error" role="alert">{position.error}</div>;
  if(position.tab==='published')return <PublishedLibrary key={`published:${position.revision??''}`} client={client} apiBase={apiBase} actorId={actorId} revision={position.revision} objectKey={position.object} materialId={position.material} onAccessLost={onAccessLost}/>;
  if(position.tab==='sessions')return <WorkSessions key={`sessions:${position.session??''}`} client={client} apiBase={apiBase} actorId={actorId} id={position.session} question={position.question} onAccessLost={onAccessLost}/>;
  return <PrivateInvestigations client={client} apiBase={apiBase} actorId={actorId} onAccessLost={onAccessLost}/>;
}
function PrivateInvestigations({client,apiBase,actorId,onAccessLost}:{client:BusinessKnowledgeClient;apiBase:string;actorId:string;onAccessLost:(error:Error)=>void}){
  const route = useSyncExternalStore(subscribeProductRoute, search, serverSearch);
  const position = knowledgePosition(route, client.workspaceId);
  const [creating, setCreating] = useState(false);
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.list(), []);
  const list = useKnowledgeRead(client, "investigations", load, onAccessLost, 5000);
  const select = useCallback((run: Investigation) => {
    setCreating(false); writeKnowledgePosition(client.workspaceId, run.id); list.retry();
  }, [client.workspaceId, list]);
  const open = (run: Investigation) => { setCreating(false); const type=investigationKind(run);
    if(type.position)openWork(client.workspaceId,type.position);else writeKnowledgePosition(client.workspaceId,run.id); };
  if(position.error)return <div className="bk-error" role="alert"><p>{position.error}</p><button className="button" onClick={()=>writeKnowledgePosition(client.workspaceId,"")}>返回调查清单</button></div>;
  return <><div className="bk-toolbar"><p>保存的分析可在模型离线时继续查询；打开图谱不会重新发起模型调用。</p>
    <button className="button primary" onClick={() => setCreating(value => !value)}>{creating ? "返回调查" : "新建业务调查"}</button></div>
    <div className="bk-layout"><aside className="bk-panel bk-history" aria-label="业务调查清单"><div className="bk-heading"><h2>调查</h2><button className="bk-text-button" onClick={list.retry}>刷新清单</button></div>
      {list.loading && <p role="status">正在复验调查清单…</p>}{list.error && <ReadIssue error={list.error} retry={list.retry} />}
      {list.data && <>{!list.data.length && <p>尚无获授权的调查。可以选择冻结材料开始新调查；不会把无权读取当作空清单。</p>}
        <ul>{list.data.map(run => <li key={run.id}><button aria-current={!creating && position.id === run.id ? "true" : undefined} onClick={() => open(run)}>
          <b>{run.question}</b><small>{investigationKind(run).label}</small><span>{investigationKind(run).state}</span><small>{shortId(run.id)}</small></button></li>)}</ul>
        {list.data.length === 1000 && <p>达到本次查询上限；更早调查仍可通过其固定地址读取。</p>}</>}
    </aside><div className="bk-main">
      {creating || (!position.id && list.data?.length === 0) ? <StartPanel client={client} apiBase={apiBase} actorId={actorId} onCreated={select} onAccessLost={onAccessLost} />
        : position.id ? <InvestigationDetail key={position.id} client={client} apiBase={apiBase} id={position.id} view={position.view} objectKey={position.key} onAccessLost={onAccessLost} onChanged={list.retry} />
          : <section className="bk-panel bk-empty"><h2>选择一个调查查看业务关联</h2><p>可继续已有调查，或用已冻结材料发起新调查。不会自动切到最新图谱，也不会在浏览时启动分析。</p><button className="button primary" onClick={() => setCreating(true)}>新建业务调查</button></section>}
    </div></div></>;
}
