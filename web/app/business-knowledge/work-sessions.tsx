"use client";
import { useCallback, useEffect, useState } from "react";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { ReadIssue } from "./read-issue.tsx";
import { BindingDetails, CommandIssue, useWorkCommand, useWorkspaceRole } from "./work-common.tsx";
import { WorkJournal, journalSnapshot, rememberSession, visitedSessions,beginWorkOperation,operationLookup } from "./work-journal.ts";
import {ServerSessions,RecoverOperation} from './work-discovery.tsx';
import { openWork } from "./work-route.ts";
import type { KnowledgeAnswer, QuestionResult, WorkSession } from "./work-types.ts";
import { citationValid } from "./work-types.ts";
import { ContinuationPanel } from "./work-continuation.tsx";
import {AnswerContext} from './answer-context.tsx';

export function WorkSessions({
  client,
  apiBase,
  actorId,
  id,
  question,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  apiBase: string;
  actorId: string;
  id?: string;
  question?: string;
  onAccessLost: (error: Error) => void;
}) {
  const [manual, setManual] = useState(""),
    [visits] = useState(() => {
      try {
        return { ids: visitedSessions(client.workspaceId, actorId), error: "" };
      } catch (cause) {
        return { ids: [], error: (cause as Error).message };
      }
    });
  return (
    <section className="bk-panel" aria-label="图谱工作会话">
      <h2>图谱工作会话</h2>
      <p>
        问题与派生答案由服务端持久保存。重开只做读取，不重发模型请求或重置预算。浏览器仅保存访问坐标，不缓存答案或权限。
      </p>
      <ServerSessions client={client} onAccessLost={onAccessLost}/>
      <RecoverOperation client={client} onAccessLost={onAccessLost}/>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          openWork(client.workspaceId, { tab: "sessions", session: manual.trim() });
        }}
      >
        <label>
          会话 ID
          <input
            required
            maxLength={128}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <button className="button">读取精确会话</button>
      </form>
      <details>
        <summary>本账号访问过的会话坐标 · {visits.ids.length}</summary>
        {visits.error && <p role="alert">{visits.error}</p>}
        <ul>
          {visits.ids.map((s) => (
            <li key={s}>
              <button
                className="bk-text-button"
                onClick={() => openWork(client.workspaceId, { tab: "sessions", session: s })}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
        <p>不是服务端完整会话清单；可粘贴其他会话精确地址，仍须复验当前权限。</p>
      </details>
      {!id && <p>从“已发布知识”打开一个精确版本，再显式创建工作会话。不会从 latest 猜测来源。</p>}
      {id && (
        <SessionDetail
          key={id}
          client={client}
          apiBase={apiBase}
          actorId={actorId}
          id={id}
          question={question}
          onAccessLost={onAccessLost}
        />
      )}
    </section>
  );
}
function SessionDetail({
  client,
  apiBase,
  actorId,
  id,
  question,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  apiBase: string;
  actorId: string;
  id: string;
  question?: string;
  onAccessLost: (error: Error) => void;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]),
    [manual, setManual] = useState(""),
    cursor = cursors.at(-1);
  const load = useCallback(
    (bound: BusinessKnowledgeClient) => bound.work().session(id, cursor),
    [id, cursor],
  );
  const state = useKnowledgeRead(
      client,
      `work-session:${id}:${cursor ?? "first"}`,
      load,
      onAccessLost,
      5000,
    ),
    role = useWorkspaceRole(client, apiBase, onAccessLost);
  useEffect(() => {
    if (state.data)
      try {
        rememberSession(client.workspaceId, actorId, id);
      } catch {
        /* Read access remains available without bookmark storage. */
      }
  }, [state.data, client.workspaceId, actorId, id]);
  if (state.error) return <ReadIssue error={state.error} retry={state.retry} />;
  if (!state.data) return <p role="status">正在复验工作会话…</p>;
  const s = state.data.session,
    maintain = role.data?.role === "MAINTAIN";
  return (
    <section aria-label="当前工作会话">
      <h3>{s.title}</h3>
      <p>
        会话 <code>{s.id}</code> · CAS版本 {s.version}
      </p>
      <BindingDetails binding={s.binding} />
      {s.origin && (
        <p>
          由旧会话{" "}
          <button
            className="bk-text-button"
            onClick={() =>
              openWork(client.workspaceId, { tab: "sessions", session: s.origin!.sessionId })
            }
          >
            {s.origin.sessionId}
          </button>{" "}
          显式接续；旧记录、原决定与旧答案未继承或覆盖。
        </p>
      )}
      <section>
        <h4>持久问题与反馈 · 第{cursors.length}页</h4>
        <ul>
          {state.data.records.map((r) => (
            <li key={r.id}>
              {r.type === "KNOWLEDGE_QUESTION" ? (
                <button
                  className="bk-text-button"
                  onClick={() =>
                    openWork(client.workspaceId, { tab: "sessions", session: id, question: r.id })
                  }
                >
                  {r.question ?? r.id}
                </button>
              ) : (
                <span>复核登记：{r.message}</span>
              )}{" "}
              <small>
                {r.createdAt} · {r.operationId}
              </small>
            </li>
          ))}
        </ul>
        {!state.data.records.length && <p>本页没有问题或反馈记录；不代表其他分页为空。</p>}
        <button
          className="button"
          disabled={cursors.length === 1}
          onClick={() => setCursors((v) => v.slice(0, -1))}
        >
          上一页记录
        </button>
        <button
          className="button"
          disabled={!state.data.nextCursor}
          onClick={() => setCursors((v) => [...v, state.data!.nextCursor!])}
        >
          下一页记录
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            openWork(client.workspaceId, { tab: "sessions", session: id, question: manual.trim() });
          }}
        >
          <label>
            精确问题 ID
            <input
              required
              maxLength={128}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
          </label>
          <button className="button">离线回读已保存的问题</button>
        </form>
      </section>
      <SessionEvents client={client} id={id} onAccessLost={onAccessLost} />
      {question && (
        <QuestionDetail
          key={`${id}:${question}`}
          client={client}
          session={s}
          id={question}
          canMaintain={maintain}
          actorId={actorId}
          onAccessLost={onAccessLost}
          onChanged={state.retry}
        />
      )}
      {s.binding.graphRevisionId ? (
        <QuestionForm
          key={`ask:${id}:${s.binding.graphRevisionId}:${s.binding.graphDigest}`}
          client={client}
          session={s}
          actorId={actorId}
          canMaintain={maintain}
          onAccessLost={onAccessLost}
          onChanged={state.retry}
        />
      ) : (
        <p className="bk-warning">
          新调查尚未显式采用它的已发布图谱，不能提问。请先查看调查、按真实发布条件发布，再在下方明确采用。
        </p>
      )}
      <ContinuationPanel
        key={`continue:${id}:${s.binding.graphRevisionId}:${s.binding.graphDigest}`}
        client={client}
        apiBase={apiBase}
        session={s}
        actorId={actorId}
        canMaintain={maintain}
        onAccessLost={onAccessLost}
        onChanged={state.retry}
      />
    </section>
  );
}
function SessionEvents({
  client,
  id,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  id: string;
  onAccessLost: (error: Error) => void;
}) {
  const [pages, setPages] = useState([0]),
    after = pages.at(-1)!;
  const load = useCallback(
    (bound: BusinessKnowledgeClient) => bound.work().events(id, after),
    [id, after],
  );
  const state = useKnowledgeRead(client, `session-events:${id}:${after}`, load, onAccessLost, 5000);
  return (
    <details>
      <summary>完整会话事件分页（不隐藏旧版本）</summary>
      {state.error && <ReadIssue error={state.error} retry={state.retry} />}
      {state.data && (
        <>
          <p>服务端当前版本 {state.data.currentVersion}</p>
          <ol>
            {state.data.events.map((e) => (
              <li key={e.id}>
                v{e.version} · {e.type} · {e.createdAt}
                {e.questionId && (
                  <button
                    className="bk-text-button"
                    onClick={() =>
                      openWork(client.workspaceId, {
                        tab: "sessions",
                        session: id,
                        question: e.questionId,
                      })
                    }
                  >
                    读取问题
                  </button>
                )}
                {e.newSessionId && (
                  <button
                    className="bk-text-button"
                    onClick={() =>
                      openWork(client.workspaceId, { tab: "sessions", session: e.newSessionId })
                    }
                  >
                    读取新会话
                  </button>
                )}
              </li>
            ))}
          </ol>
          <button
            className="button"
            disabled={pages.length === 1}
            onClick={() => setPages((v) => v.slice(0, -1))}
          >
            上一页事件
          </button>
          <button
            className="button"
            disabled={state.data.nextAfterVersion === null}
            onClick={() => setPages((v) => [...v, state.data!.nextAfterVersion!])}
          >
            下一页事件
          </button>
        </>
      )}
    </details>
  );
}
function useJournal(client: BusinessKnowledgeClient, actorId: string, scope: string) {
  const [value] = useState(() => {
    try {
      const journal = new WorkJournal(window.localStorage, client.workspaceId, actorId, scope);
      journal.read();
      return { journal, error: null };
    } catch (cause) {
      return { journal: null, error: cause as Error };
    }
  });
  return journalSnapshot(value);
}
function QuestionForm({
  client,
  session,
  actorId,
  canMaintain,
  onAccessLost,
  onChanged,
}: {
  client: BusinessKnowledgeClient;
  session: WorkSession;
  actorId: string;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [all, setAll] = useState(false),
    [confirmed, setConfirmed] = useState("");
  const [budget, setBudget] = useState({ readKiB: 256, calls: 8, minutes: 30 }),
    [, render] = useState(0);
  const command = useWorkCommand(
      client,
      `ask:${session.id}:${session.binding.graphRevisionId}`,
      onAccessLost,
    ),
    store = useJournal(client, actorId, `ask:${session.id}`),
    pending = store.pending;
  const load = useCallback(
    async (bound: BusinessKnowledgeClient) => ({
      version: await bound.readPublished(session.binding.graphRevisionId!),
      profiles: await bound.profiles(),
    }),
    [session.binding.graphRevisionId],
  );
  const preparation = useKnowledgeRead(
      client,
      `question-prepare:${session.id}:${session.binding.graphRevisionId}`,
      load,
      onAccessLost,
    ),
    profile = preparation.data?.profiles[0];
  const recover = () =>
    void command.execute(
      async () => {
        if (!pending) throw Error("没有原次坐标");
        return (await client.work().operation(pending.operationId,operationLookup(pending,'QUESTION',session.id,session.binding))).question!.request;
      },
      (found) => {
        store.journal!.resolve(pending!.operationId);
        openWork(client.workspaceId, { tab: "sessions", session: session.id, question: found.id });
      },
    );
  return (
    <section className="bk-panel" aria-label="新增独立问题">
      <h4>提出一个独立问题</h4>
      <p>
        调用固定当前团队，明确对象范围与本次预算。暂停、恢复和离线重开均不清零。SUPPORTED只是派生分析，不是人工确认或执行PASS。
      </p>
      <CommandIssue error={command.error ?? store.error} />
      {command.notice && <p role="status">{command.notice}</p>}
      {pending && (
        <div className="bk-warning">
          <p>原问题操作键：{pending.operationId}。仅查询已保存受理，不自动重发或收费。</p>
          <button className="button" disabled={command.busy} onClick={recover}>
            查询原问题受理
          </button>
        </div>
      )}
      {preparation.error && <ReadIssue error={preparation.error} retry={preparation.retry} />}
      <button
        className="button"
        disabled={command.busy}
        onClick={() => {
          setConfirmed("");
          preparation.retry();
        }}
      >
        重新读取当前生效团队
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!store.journal || pending || !profile) return;
          void command.execute(
            async () => {
              if (confirmed !== profile.id) throw Error("请确认当前 Main / Child 团队。");
              if (!all && !selected.length) throw Error("请明确选择对象范围。");
              const input={operationId:crypto.randomUUID(),expectedSessionVersion:session.version,expectedProfileId:profile.id,question,objectKeys:all?null:selected,
                budget:{maxReadBytes:budget.readKiB*1024,maxModelCalls:budget.calls,deadline:new Date(Date.now()+budget.minutes*60000).toISOString()}};
              const operationId = await beginWorkOperation(store.journal!,'QUESTION',session.id,session.binding,input);
              render((v) => v + 1);
              try {
                const value = await client.work().ask(
                  session.id,
                  input,
                  session.binding,
                );
                store.journal!.accepted(operationId, value.request.id);
                return value;
              } catch (cause) {
                if (
                  cause instanceof BusinessKnowledgeError &&
                  (cause.status === 422 ||
                    cause.code === "F003_SESSION_WRITE_BLOCKED" ||
                    cause.code === "F003_PROFILE_CONFLICT" ||
                    cause.code === "F003_SESSION_CONFLICT")
                )
                  store.journal!.resolve(operationId);
                throw cause;
              }
            },
            (value) => {
              store.journal!.resolve(value.request.operationId);
              onChanged();
              openWork(client.workspaceId, {
                tab: "sessions",
                session: session.id,
                question: value.request.id,
              });
            },
          );
        }}
      >
        <fieldset disabled={!canMaintain || command.busy || !!pending}>
          <legend>问题、范围与固定团队</legend>
          <label>
            独立问题
            <textarea
              required
              rows={3}
              maxLength={16384}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            明确使用此发布图谱的全部可用对象与关系（不代表全部认可）
          </label>
          {!all && (
            <div className="bk-components">
              {preparation.data &&
                [
                  ...preparation.data.version.graph.candidates,
                  ...preparation.data.version.graph.relations,
                ]
                  .filter((x) => x.state !== "QUARANTINED")
                  .map((p) => (
                    <label key={p.key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.key)}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked ? [...v, p.key] : v.filter((k) => k !== p.key),
                          )
                        }
                      />
                      {p.name ?? p.predicate ?? p.key}
                    </label>
                  ))}
            </div>
          )}
          {profile ? (
            <>
              <p>
                Main：{profile.mainAgentSlot.modelProfileId}；Child：
                {profile.childAgentSlots.map((s) => s.modelProfileId).join("、")}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed === profile.id}
                  onChange={(e) => setConfirmed(e.target.checked ? profile.id : "")}
                />
                确认固定生效团队 {profile.id}
              </label>
            </>
          ) : (
            <p>没有可核实的生效团队，不能发起问题。</p>
          )}
          <div className="bk-form-grid">
            <label>
              读取上限（KiB）
              <input
                type="number"
                min={1}
                max={512}
                required
                value={budget.readKiB}
                onChange={(e) => setBudget((v) => ({ ...v, readKiB: Number(e.target.value) }))}
              />
            </label>
            <label>
              模型调用上限
              <input
                type="number"
                min={3}
                max={32}
                required
                value={budget.calls}
                onChange={(e) => setBudget((v) => ({ ...v, calls: Number(e.target.value) }))}
              />
            </label>
            <label>
              截止（分钟）
              <input
                type="number"
                min={1}
                max={10080}
                required
                value={budget.minutes}
                onChange={(e) => setBudget((v) => ({ ...v, minutes: Number(e.target.value) }))}
              />
            </label>
          </div>
        </fieldset>
        <button
          className="button primary"
          disabled={
            !canMaintain ||
            !profile ||
            confirmed !== profile.id ||
            !!pending ||
            !!store.error ||
            command.busy
          }
        >
          提交一个新问题
        </button>
      </form>
      {!canMaintain && <p>当前成员只读，可离线回读答案；不能新增或控制问题。</p>}
    </section>
  );
}
function QuestionDetail({
  client,
  session,
  id,
  canMaintain,
  actorId,
  onAccessLost,
  onChanged,
}: {
  client: BusinessKnowledgeClient;
  session: WorkSession;
  id: string;
  canMaintain: boolean;
  actorId: string;
  onAccessLost: (error: Error) => void;
  onChanged: () => void;
}) {
  const load = useCallback(
    (bound: BusinessKnowledgeClient) => bound.work().question(session.id, id),
    [session.id, id],
  );
  const state = useKnowledgeRead(client, `question:${session.id}:${id}`, load, onAccessLost, 2000),
    command = useWorkCommand(client, `control:${session.id}:${id}`, onAccessLost);
  if (state.error) return <ReadIssue error={state.error} retry={state.retry} />;
  if (!state.data) return <p role="status">正在读取问题运行与已保存答案…</p>;
  const v = state.data,
    r = v.run,
    labels = {
      QUEUED: "等待问答",
      RUNNING: "问答运行中",
      PAUSED: "已暂停",
      COMPLETED: "派生答案已保存",
      FAILED: "问答失败",
      CANCELLED: "已取消",
    };
  return (
    <section className="bk-panel" aria-label="持久问题详情">
      <h4>{v.request.question}</h4>
      <p>
        {labels[r.state]} · 世代 {r.generation} · 运行修订 {r.revision}
      </p>
      <p>
        问题ID <code>{id}</code> · 操作键 <code>{v.request.operationId}</code>
      </p>
      <BindingDetails binding={v.request.binding} />
      <p>
        固定团队：{r.profile.id}；已调用 {String(r.usage.modelCalls ?? "未知")} /{" "}
        {r.budget.maxModelCalls}；原文已读 {String(r.usage.readBytes ?? "未知")} /{" "}
        {r.budget.maxReadBytes} 字节；截止 {r.budget.deadline}
      </p>
      {r.lastFailure && (
        <p className="bk-warning">
          服务端安全原因：{r.lastFailure.code} · {r.lastFailure.phase ?? "阶段未知"} ·{" "}
          {r.lastFailure.taskKey ?? "任务未知"} · {r.lastFailure.slotId ?? "槽位未知"}
          。已开始但结果未知时不自动重发。
        </p>
      )}
      {r.lastFailure?.code === "F003_QA_CONTRACT_CHANGED" && (
        <p>
          原检查点核查合同已不兼容；旧记录与预算保留，不能通过恢复按钮自动重跑。需要时在下方明确创建一个独立新问题。
        </p>
      )}
      {r.lastFailure?.code === "F003_QA_CALL_OUTCOME_UNKNOWN" && (
        <p>
          原模型调用已经开始，但没有可确认的结果；本次累计收费与预算仍保留。只读刷新不会重发，新的调用必须由你明确提出新问题。
        </p>
      )}
      <CommandIssue error={command.error} />
      {(["pause", "resume", "cancel"] as const)
        .filter((action) =>
          action === "pause"
            ? ["QUEUED", "RUNNING"].includes(r.state)
            : action === "resume"
              ? r.state === "PAUSED"
              : !["COMPLETED", "FAILED", "CANCELLED"].includes(r.state),
        )
        .map((action) => (
          <button
            className="button"
            key={action}
            disabled={!canMaintain || command.busy}
            onClick={() =>
              void command.execute(
                () => client.work().control(session.id, id, action, r.revision),
                () => {
                  state.retry();
                  onChanged();
                },
              )
            }
          >
            {{ pause: "暂停此问题", resume: "恢复此问题", cancel: "取消此问题" }[action]}
          </button>
        ))}
      <button className="bk-text-button" onClick={state.retry}>
        只读刷新运行与答案
      </button>
      {v.answer ? (
        <AnswerView value={v} />
      ) : (
        <p>尚无已保存答案；不会把部分输出、运行中或失败视为答案完成。</p>
      )}
      {v.answer && (
        <FeedbackForm
          client={client}
          session={session}
          value={v}
          actorId={actorId}
          canMaintain={canMaintain}
          onAccessLost={onAccessLost}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}
export function AnswerView({ value }: { value: QuestionResult }) {
  const a = value.answer as KnowledgeAnswer;
  const workspace=value.request?.workspaceId??a.workspaceId;
  return (
    <section aria-label="派生答案">
      <h4>派生答案 · 非业务权威</h4>
      <p>COMPLETED仅代表答案已保存。分析SUPPORTED不等于人工确认、审批通过或可信执行PASS。</p>
      <p>
        来源图谱 {a.binding.graphRevisionId} · {a.binding.graphDigest} · 问题来源 {a.requestDigest}
      </p>
      <p>
        答案核查合同：{a.questionContractVersion ?? "旧记录未提供，未知"}
        。不补写旧答案、不自动重跑或收费。
      </p>
      {workspace&&a.binding.graphRevisionId&&<button className="button" onClick={()=>openWork(workspace,{tab:'published',revision:a.binding.graphRevisionId!})}>打开此答案的来源发布版本</button>}
      <AnswerContext answer={a}/>
      {a.segments.map((s) => (
        <article key={s.key} className="bk-edge">
          <h5>{s.stance === "SUPPORTED" ? "有依据的派生分析" : "UNKNOWN · 保留未知"}</h5>
          <p>{s.text}</p>
          <p>
            图谱引用{s.stance === "UNKNOWN" ? "（未核实，不作为有效证据跳转）" : ""}：
            {s.graphRefs.join("、") || "无"}；技术引用（仅固定采用版本）：
            {s.technicalRefs.join("、") || "无"}
          </p>
          {workspace&&a.binding.graphRevisionId&&s.stance==='SUPPORTED'&&s.graphRefs.map(ref=><button className="bk-text-button" key={ref} onClick={()=>openWork(workspace,{tab:'published',revision:a.binding.graphRevisionId!,object:ref})}>查看引用对象：{ref}</button>)}
          {s.evidence.map((c, i) =>
            citationValid(c) ? (
              <blockquote key={i}>
                <p>{c.quote}</p>
                <footer>
                  {c.materialId} · 行{c.startLine}–{c.endLine} ·
                  {workspace&&a.binding.graphRevisionId?<button className="bk-text-button" onClick={()=>openWork(workspace,{tab:'published',revision:a.binding.graphRevisionId!,material:c.materialId})}>回查此版本原文{s.stance==='UNKNOWN'?'（引用仍未核实）':''}</button>:'缺少明确来源坐标，未猜测其他版本原文'}
                </footer>
              </blockquote>
            ) : (
              <details key={i}>
                <summary>UNKNOWN中的无效引用（不是有效原文依据）</summary>
                <pre>{JSON.stringify(c, null, 2)}</pre>
              </details>
            ),
          )}
          {s.uncertainties.length > 0 && (
            <ul>
              {s.uncertainties.map((u, i) => (
                <li key={i}>不确定：{u}</li>
              ))}
            </ul>
          )}
          {s.guardReasons.length > 0 && (
            <ul>
              {s.guardReasons.map((u, i) => (
                <li key={i}>校验原因：{u}</li>
              ))}
            </ul>
          )}
          <details>
            <summary>该段核查与前提</summary>
            <pre>{JSON.stringify(s.verification, null, 2)}</pre>
          </details>
        </article>
      ))}
      <h5>未知与冲突（原样保留，不折叠成通过）</h5>
      <ul>
        {a.unknowns.map((u, i) => (
          <li key={i}>{u}</li>
        ))}
      </ul>
      <details open={a.conflicts.length > 0 || a.unresolvedConflicts.length > 0}>
        <summary>冲突、未读缺口与过程</summary>
        <pre>
          {JSON.stringify(
            {
              conflicts: a.conflicts,
              unresolvedConflicts: a.unresolvedConflicts,
              readGaps: a.readGaps,
              process: a.process,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
function FeedbackForm({
  client,
  session,
  value,
  actorId,
  canMaintain,
  onAccessLost,
  onChanged,
}: {
  client: BusinessKnowledgeClient;
  session: WorkSession;
  value: QuestionResult;
  actorId: string;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
  onChanged: () => void;
}) {
  const [object, setObject] = useState(""),
    [kind, setKind] = useState<"CORRECTION" | "REVIEW_REQUEST">("CORRECTION"),
    [message, setMessage] = useState("");
  const store = useJournal(client, actorId, `feedback:${session.id}:${value.answer!.id}`),
    command = useWorkCommand(client, `feedback:${session.id}:${value.answer!.id}`, onAccessLost),
    pending = store.pending;
  return (
    <section>
      <h5>针对该答案登记纠错／复核请求</h5>
      <p>只登记反馈，不批准Claim、不改写旧答案或决定。</p>
      <CommandIssue error={command.error ?? store.error} />
      {command.notice && <p role="status">{command.notice}</p>}
      {pending && (
        <div className="bk-warning">
          <p>原反馈操作键 {pending.operationId}</p>
          <button
            className="button"
            disabled={command.busy}
            onClick={() =>
              void command.execute(
                async () => {
                  return (await client.work().operation(pending.operationId,operationLookup(pending,'FEEDBACK',session.id,value.request.binding))).feedback!;
                },
                () => {
                  store.journal!.resolve(pending.operationId);
                  command.setNotice("原反馈已持久登记；不是批准。");
                  onChanged();
                },
              )
            }
          >
            查询原反馈受理
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!store.journal || pending) return;
          void command.execute(
            async () => {
              const input={operationId:crypto.randomUUID(),expectedSessionVersion:session.version,graphDigest:value.request.binding.graphDigest!,objectKey:object||null,answerId:value.answer!.id,kind,message};
              const operationId = await beginWorkOperation(store.journal!,'FEEDBACK',session.id,value.request.binding,input);
              try {
                const v = await client.work().feedback(session.id, input);
                store.journal!.accepted(operationId, v.feedback.id);
                return v;
              } catch (cause) {
                if (
                  cause instanceof BusinessKnowledgeError &&
                  (cause.status === 422 ||
                    cause.code === "F003_SESSION_WRITE_BLOCKED" ||
                    cause.code === "F003_SESSION_CONFLICT")
                )
                  store.journal!.resolve(operationId);
                throw cause;
              }
            },
            (v) => {
              store.journal!.resolve(v.feedback.operationId);
              command.setNotice("反馈已登记，未产生人工确认或可信执行。");
              onChanged();
            },
          );
        }}
      >
        <fieldset disabled={!canMaintain || command.busy || !!pending}>
          <legend>精确答案 {value.answer!.id}</legend>
          <label>
            明确对象／关系（可仅针对答案）
            <select value={object} onChange={(e) => setObject(e.target.value)}>
              <option value="">仅针对这条答案</option>
              {value.request.binding.objectKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            反馈类型
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="CORRECTION">纠错 CORRECTION</option>
              <option value="REVIEW_REQUEST">请求复核 REVIEW_REQUEST</option>
            </select>
          </label>
          <label>
            说明
            <textarea
              required
              maxLength={16384}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        </fieldset>
        <button
          className="button"
          disabled={!canMaintain || command.busy || !!pending || !!store.error}
        >
          登记反馈，不批准
        </button>
      </form>
    </section>
  );
}
