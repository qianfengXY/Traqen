"use client";
import { useCallback, useState, type FormEvent } from "react";
import { SourceTruthClient } from "../source-truth/client.ts";
import { DeterministicFactsClient } from "../deterministic-facts/client.ts";
import type { FrozenVersion, Page, SourceOverview } from "../source-truth/types.ts";
import type { FactsOverview } from "../deterministic-facts/types.ts";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { useCommandContext } from "./use-command.ts";
import { StartReceipt } from "./read-session.ts";
import { makeStart, shortId } from "./model.ts";
import type { Investigation } from "./types.ts";

export function StartPanel({ client, apiBase, actorId, onCreated, onAccessLost }: {
  client: BusinessKnowledgeClient; apiBase: string; actorId: string;
  onCreated: (run: Investigation) => void; onAccessLost: (error: Error) => void;
}) {
  const [bundleId, setBundleId] = useState(""), [components, setComponents] = useState<string[]>([]), [question, setQuestion] = useState("");
  const [confirmedProfileId, setConfirmedProfileId] = useState(""), [technical, setTechnical] = useState("");
  const [budget, setBudget] = useState({ maxReadMiB: 4, maxModelCalls: 12, durationMinutes: 60, supplementMaterials: 100, supplementMiB: 4, supplementRules: 100000, supplementAttempts: 4 });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const beginCommand = useCommandContext(client, "start");
  const [receipt] = useState(() => {
    try { return { journal: new StartReceipt(window.localStorage, client.workspaceId, actorId), error: "" }; }
    catch { return { journal: null, error: "提交坐标存储不可用，未发送新调查。" }; }
  });
  const [pending, setPending] = useState<string | null>(() => {
    try { return receipt.journal?.read() ?? null; } catch { return "UNREADABLE"; }
  });
  const load = useCallback(async (bound: BusinessKnowledgeClient) => {
    const sources = new SourceTruthClient(apiBase, "", client.workspaceId, bound.signal);
    const facts = new DeterministicFactsClient(apiBase, "", client.workspaceId, bound.signal);
    const [overview, bundles, profiles, versions] = await Promise.all([
      sources.request<SourceOverview>(), sources.request<Page<FrozenVersion>>("/history/bundles?limit=50"), bound.profiles(),
      facts.request<FactsOverview>().then(value => ({ versions: value.versions, error: "" })).catch(error => {
        if (bound.signal?.aborted) throw error;
        return { versions: [], error: error instanceof Error ? error.message : "技术结果暂不可读" };
      }),
    ]);
    return { overview, bundles, profiles, ...versions };
  }, [apiBase, client.workspaceId]);
  // Preparation errors block new work, not historical graph browsing.
  const prepare = useKnowledgeRead(client, "prepare", load, ignorePreparationFailure);
  const data = prepare.data, source = data?.bundles.items.find(item => item.id === bundleId), profile = data?.profiles[0];
  const allowed = data?.overview.role === "MAINTAIN" && !busy && !pending && !!receipt.journal;
  const report = (cause: unknown) => {
    if (client.signal?.aborted) return;
    const issue = cause instanceof Error ? cause : new Error("调查提交未确认");
    setError(issue.message); onAccessLost(issue);
  };
  const reconcile = async () => {
    if (!pending || pending === "UNREADABLE" || busy) return;
    const current = beginCommand();
    setBusy(true); setError("");
    try {
      const runs = await client.list(), found = runs.find(run => run.operationId === pending);
      if (!current()) return;
      if (!found) throw Error("当前授权清单内尚未找到原操作；不能据此认定未受理，也不会创建重复调查。请稍后再次查询原次提交。");
      receipt.journal?.resolve(pending); setPending(null); onCreated(found);
    } catch (cause) { if (current()) report(cause); }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  const handleStart = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allowed || !source || !profile) return;
    const current = beginCommand();
    setBusy(true); setError(""); let operationId: string | null = null;
    try {
      const input = makeStart({ ...budget, operationId: crypto.randomUUID(), question, bundle: source, componentIds: components,
        profileId: profile.id, confirmedProfileId, technicalVersionId: technical, versions: data?.versions ?? [],
        // Deadline begins at the submit event, not at a component render.
        now: event.timeStamp > 1e12 ? event.timeStamp : performance.timeOrigin + event.timeStamp });
      receipt.journal!.begin(input.operationId); operationId = input.operationId; setPending(operationId);
      const run = await client.start(input);
      if (!current()) return;
      receipt.journal!.resolve(operationId); setPending(null); onCreated(run);
    } catch (cause) {
      // A typed form rejection happens before admission. Ambiguous responses,
      // access loss and operation conflicts retain the original coordinate.
      if (operationId && cause instanceof BusinessKnowledgeError && cause.status === 422) {
        receipt.journal?.resolve(operationId); if (current()) setPending(null);
      }
      if (current()) report(cause);
    } finally { if (!client.signal?.aborted) setBusy(false); }
  };
  return <section className="bk-panel" aria-label="新建业务调查">
    <h2>新建调查</h2><p>从固定材料中调查一个具体业务问题。原始材料与技术依据分别绑定，调查完成不会自动发布为业务基线。</p>
    {(error || receipt.error) && <p role="alert">{error || receipt.error}</p>}
    {pending && <div className="bk-warning"><b>上次提交尚未核对</b><p>操作键：{pending}。只查询同次提交，不自动重试写入。</p><button className="button" disabled={busy || pending === "UNREADABLE"} onClick={() => void reconcile()}>查询原次提交</button></div>}
    {prepare.error && <div role="alert"><p>分析准备不可用：{prepare.error.message}。这不是没有材料或配置。</p><button className="button" onClick={prepare.retry}>重新读取分析准备</button></div>}
    {prepare.loading && <p role="status">正在读取当前权限、冻结材料和生效模型配置…</p>}
    {data && <form onSubmit={handleStart}>
      <fieldset disabled={busy || !!pending}><legend>调查输入</legend>
        <label>材料版本<select aria-label="材料版本" value={bundleId} required onChange={event => { setBundleId(event.target.value); setComponents([]); setTechnical(""); }}><option value="">选择精确冻结版本</option>{data.bundles.items.map(bundle => <option value={bundle.id} key={bundle.id}>{shortId(bundle.id)} · {bundle.counts.fileCount}份文件 · {bundle.latestReceipt ? "有准入收据" : "无准入收据"}</option>)}</select></label>
        {data.bundles.nextCursor && <p>仅列出当前授权的前50个版本。需要更早版本时请先在来源快照中核对；不会用最新版本替换旧引用。</p>}
        {source && <div className="bk-components"><span>材料范围</span>{source.components.map(component => <label key={component.id}><input type="checkbox" checked={components.includes(component.id)} onChange={event => setComponents(event.target.checked ? [...components, component.id] : components.filter(id => id !== component.id))} />{component.sourceId} · {component.kind} · {component.fileCount}份文件</label>)}</div>}
        <label>业务问题<textarea required maxLength={16384} rows={3} value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：订单在什么条件下可以取消，涉及哪些角色、状态和实现？" /></label>
        <label>技术参考<select aria-label="技术参考" value={technical} onChange={event => setTechnical(event.target.value)}><option value="">不采用技术结果，仅调查原始材料</option>{data.versions.filter(version => version.bundleId === bundleId).map(version => <option value={version.graphVersionId} key={version.graphVersionId}>{shortId(version.graphVersionId)} · {version.publishedAt}</option>)}</select></label>
        {data.error && <p role="status">技术依据清单未确认：{data.error}。仍可明确选择只读原始材料；未推断技术结果为空。</p>}
      </fieldset>
      <fieldset disabled={busy || !!pending}><legend>生效模型配置</legend>
        {profile ? <><p>Main：{profile.mainAgentSlot.modelProfileId}；Child：{profile.childAgentSlots.map(slot => slot.modelProfileId).join("、") || "尚未配置"}</p>
          <details><summary>查看固定配置与模型版本</summary><p>配置：<code>{profile.id}</code></p><p>Main：<code>{profile.mainAgentSlot.modelProfileRevisionId}</code></p>{profile.childAgentSlots.map(slot => <p key={slot.id}>Child {slot.id}：<code>{slot.modelProfileRevisionId}</code></p>)}</details>
          <label><input type="checkbox" checked={confirmedProfileId === profile.id} onChange={event => setConfirmedProfileId(event.target.checked ? profile.id : "")} />确认使用此 Main / Child 配置启动；服务端将复验模型与账号的当前可用性</label></>
          : <p>尚无生效配置。请到设置中心完成模型验证与工作区配置；本页不代替配置生效。</p>}
      </fieldset>
      <details><summary>调查预算与停止条件</summary><p>预算持续累计，暂停、恢复和技术版本采用不会清零。到达截止或上限即停止新增工作。</p><div className="bk-form-grid">{([
        ["maxReadMiB", "原文读取上限（MiB）", 1024], ["maxModelCalls", "模型调用上限", 1000], ["durationMinutes", "截止时长（分钟）", 10080],
        ["supplementMaterials", "技术补证材料上限", 200000], ["supplementMiB", "技术补证字节上限（MiB）", 1024], ["supplementRules", "技术规则应用上限", 100000000], ["supplementAttempts", "技术补证尝试上限", 1000],
      ] as const).map(([key, label, max]) => <label key={key}>{label}<input type="number" min={1} max={max} required value={budget[key]} disabled={busy || !!pending} onChange={event => setBudget(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></details>
      {data.overview.role !== "MAINTAIN" && <p role="status">当前成员只读，可浏览已获授权的调查；不能发起或控制运行。</p>}
      <button className="button primary" type="submit" disabled={!allowed || !source?.latestReceipt || !components.length || !question.trim() || !profile || confirmedProfileId !== profile.id}>{busy ? "正在提交…" : "开始业务调查"}</button>
    </form>}
  </section>;
}
const ignorePreparationFailure = () => {};
