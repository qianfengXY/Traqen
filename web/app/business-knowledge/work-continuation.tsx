"use client";
import { useCallback, useState } from "react";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { useWorkCommand, CommandIssue, BindingDetails } from "./work-common.tsx";
import { ReadIssue } from "./read-issue.tsx";
import { WorkJournal, journalSnapshot, rememberSession,beginWorkOperation,operationLookup } from "./work-journal.ts";
import { openWork } from "./work-route.ts";
import { bindingEqual } from "./work-types.ts";
import { makeStart, shortId, writeKnowledgePosition } from "./model.ts";
import type { ChangePreview, ContinuationInput, WorkSession } from "./work-types.ts";
import type { FrozenVersion } from "../source-truth/types.ts";

export function ContinuationPanel({
  client,
  session,
  actorId,
  canMaintain,
  onAccessLost,
  onChanged,
}: {
  client: BusinessKnowledgeClient;
  apiBase: string;
  session: WorkSession;
  actorId: string;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
  onChanged: () => void;
}) {
  return (
    <section className="bk-authority" aria-label="新材料与版本接续">
      <h4>新材料与版本接续</h4>
      <p>
        1 查看服务端变更摘要 → 2 明确创建新的会话与调查 → 3
        完成真实发布后，显式采用该新调查的精确图谱。旧问题、答案与决定原样保留，不继承认可。
      </p>
      {session.binding.graphRevisionId ? (
        <NewMaterialForm
          client={client}
          session={session}
          actorId={actorId}
          canMaintain={canMaintain}
          onAccessLost={onAccessLost}
          onChanged={onChanged}
        />
      ) : (
        <p>当前接续尚无采用图谱；不能再次接续或提问。</p>
      )}
      {session.investigationId && (
        <AdoptContinuation
          client={client}
          session={session}
          actorId={actorId}
          canMaintain={canMaintain}
          onAccessLost={onAccessLost}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}
function NewMaterialForm({
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
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]),
    cursor = pages.at(-1),
    [source, setSource] = useState<FrozenVersion | null>(null),
    [components, setComponents] = useState<string[]>([]),
    [technical, setTechnical] = useState("");
  const [preview, setPreview] = useState<{ input: ContinuationInput; value: ChangePreview } | null>(
      null,
    ),
    [question, setQuestion] = useState(""),
    [confirmed, setConfirmed] = useState("");
  const [budget, setBudget] = useState({
    maxReadMiB: 4,
    maxModelCalls: 12,
    durationMinutes: 60,
    supplementMaterials: 100,
    supplementMiB: 4,
    supplementRules: 100000,
    supplementAttempts: 4,
  });
  const command = useWorkCommand(
    client,
    `continuation:${session.id}:${session.binding.graphRevisionId}`,
    onAccessLost,
  );
  const [initialStore] = useState(() => {
      try {
        const journal = new WorkJournal(
          window.localStorage,
          client.workspaceId,
          actorId,
          `continue:${session.id}`,
        );
        journal.read();
        return { journal, error: null };
      } catch (cause) {
        return { journal: null, error: cause as Error };
      }
    }),
    store = journalSnapshot(initialStore),
    pending = store.pending;
  const load = useCallback(
    (bound: BusinessKnowledgeClient) => bound.sourceBundles(cursor),
    [cursor],
  );
  const bundles = useKnowledgeRead(
    client,
    `continuation-bundles:${cursor ?? "first"}`,
    load,
    onAccessLost,
  );
  const prep = useCallback(
    async (bound: BusinessKnowledgeClient) => ({
      profiles: await bound.profiles(),
      versions: await bound.technicalVersions(),
    }),
    [],
  );
  const data = useKnowledgeRead(client, "continuation-profiles-technical", prep, onAccessLost),
    profile = data.data?.profiles[0];
  const reset = () => setPreview(null);
  return (
    <details>
      <summary>步骤1–2：选择新材料并查看变化，再明确接续</summary>
      <CommandIssue error={command.error ?? store.error} />
      {command.notice && <p role="status">{command.notice}</p>}
      {pending && (
        <div className="bk-warning">
          <p>原接续操作 {pending.operationId}；不自动另建调查。</p>
          <button
            className="button"
            disabled={command.busy}
            onClick={() =>
              void command.execute(
                async () => (await client.work().operation(pending.operationId,operationLookup(pending,'CONTINUATION',session.id,session.binding))).session,
                (found) => {
                  store.journal!.resolve(pending.operationId);
                  try{rememberSession(client.workspaceId, actorId, found.id);}catch{/* Optional bookmark only. */}
                  openWork(client.workspaceId, { tab: "sessions", session: found.id });
                },
              )
            }
          >
            只读找回原接续
          </button>
        </div>
      )}
      {bundles.error && <ReadIssue error={bundles.error} retry={bundles.retry} />}{" "}
      {data.error && <ReadIssue error={data.error} retry={data.retry} />}
      <button
        className="button"
        type="button"
        disabled={command.busy}
        onClick={() => {
          setConfirmed("");
          data.retry();
        }}
      >
        重新读取接续团队与技术版本
      </button>
      <fieldset disabled={!canMaintain || command.busy || !!pending}>
        <legend>明确冻结来源与范围</legend>
        <p>来源历史第{pages.length}页；选择不会自动改变旧会话。</p>
        {bundles.data?.items.map((b) => (
          <button
            className="button"
            type="button"
            key={b.id}
            aria-pressed={source?.id === b.id}
            onClick={() => {
              setSource(b);
              setComponents([]);
              setTechnical("");
              reset();
            }}
          >
            {shortId(b.id)} · {b.counts.fileCount}文件 · {b.latestReceipt ? "有收据" : "无收据"}
          </button>
        ))}
        <div>
          <button
            className="button"
            type="button"
            disabled={pages.length === 1}
            onClick={() => setPages((v) => v.slice(0, -1))}
          >
            上一页材料版本
          </button>
          <button
            className="button"
            type="button"
            disabled={!bundles.data?.nextCursor}
            onClick={() => setPages((v) => [...v, bundles.data!.nextCursor!])}
          >
            下一页材料版本
          </button>
        </div>
        {source && (
          <>
            <p>
              选定版本 <code>{source.id}</code>
            </p>
            {source.components.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={components.includes(c.id)}
                  onChange={(e) => {
                    setComponents((v) =>
                      e.target.checked ? [...v, c.id] : v.filter((k) => k !== c.id),
                    );
                    reset();
                  }}
                />
                {c.sourceId} · {c.kind} · {c.fileCount}文件
              </label>
            ))}
          </>
        )}
        <label>
          显式技术依据
          <select
            value={technical}
            onChange={(e) => {
              setTechnical(e.target.value);
              reset();
            }}
          >
            <option value="">明确不采用技术版本（null）</option>
            {data.data?.versions
              .filter((v) => v.bundleId === source?.id)
              .map((v) => (
                <option key={v.graphVersionId} value={v.graphVersionId}>
                  {v.graphVersionId}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button"
          type="button"
          disabled={!source?.latestReceipt || !components.length}
          onClick={() =>
            void command.execute(
              async () => {
                const input: ContinuationInput = {
                  reference: { bundleId: source!.id, receiptId: source!.latestReceipt!.id },
                  scope: { componentIds: components },
                  technicalVersionId: technical || null,
                };
                const value = await client.work().preview(session.id, input);
                if (!bindingEqual(value.from, session.binding))
                  throw Error("变更预览的原会话绑定已变化，请刷新后重新核对。");
                return { input, value };
              },
              (value) => setPreview(value),
            )
          }
        >
          1. 读取服务端完整变更预览
        </button>
      </fieldset>
      {preview && (
        <section className="bk-panel">
          <h5>已查看的服务端变更</h5>
          <BindingDetails binding={preview.value.from} />
          <p>
            新材料 {preview.value.to.reference.bundleId}；新技术依据{" "}
            {preview.value.to.adoptedVersionIds.join("、") || "明确未采用"}
          </p>
          <p>
            changeSetDigest：<code>{preview.value.changeSetDigest}</code> ·{" "}
            {preview.value.changedEntries.length}条文件变化
          </p>
          <p>材料／范围变化不证明业务含义变化，不把范围外条目当删除，也不继承旧人工决定。</p>
          <details>
            <summary>逐来源比较与全部变化条目</summary>
            <pre>
              {JSON.stringify(
                {
                  deltas: preview.value.deltas,
                  changedEntries: preview.value.changedEntries,
                  adoptionChange: preview.value.adoptionChange,
                  limitations: preview.value.limitations,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!store.journal || pending || !source || !profile) return;
              void command.execute(
                async () => {
                  const start = makeStart({
                    ...budget,
                    operationId: "validate-only",
                    question,
                    bundle: source,
                    componentIds: preview.input.scope.componentIds,
                    profileId: profile.id,
                    confirmedProfileId: confirmed,
                    technicalVersionId: technical,
                    versions: data.data!.versions,
                    now: Date.now(),
                  });
                  const input={...preview.input,operationId:crypto.randomUUID(),expectedSessionVersion:session.version,expectedChangeSetDigest:preview.value.changeSetDigest,question:start.question,expectedProfileId:profile.id,budget:start.budget,supplementBudget:start.supplementBudget};
                  const operationId = await beginWorkOperation(store.journal!,'CONTINUATION',session.id,session.binding,input);
                  try {
                    const result = await client.work().continue(session.id,input);
                    store.journal!.accepted(operationId, result.session.id);
                    return result;
                  } catch (cause) {
                    if (
                      cause instanceof BusinessKnowledgeError &&
                      (cause.status === 422 ||
                        [
                          "F003_SESSION_WRITE_BLOCKED",
                          "F003_PROFILE_CONFLICT",
                          "F003_SESSION_CONFLICT",
                          "F003_CHANGESET_CONFLICT",
                        ].includes(cause.code))
                    )
                      store.journal!.resolve(operationId);
                    throw cause;
                  }
                },
                (value) => {
                  store.journal!.resolve(value.session.operationId);
                  try{rememberSession(client.workspaceId, actorId, value.session.id);}catch{/* Optional bookmark only. */}
                  onChanged();
                  openWork(client.workspaceId, { tab: "sessions", session: value.session.id });
                },
              );
            }}
          >
            <fieldset disabled={!canMaintain || command.busy || !!pending}>
              <legend>新调查的问题、固定团队与独立预算</legend>
              <label>
                新调查问题
                <textarea
                  required
                  maxLength={16384}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
              {profile && (
                <>
                  <p>
                    Main {profile.mainAgentSlot.modelProfileId}；Child{" "}
                    {profile.childAgentSlots.map((s) => s.modelProfileId).join("、")}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed === profile.id}
                      onChange={(e) => setConfirmed(e.target.checked ? profile.id : "")}
                    />
                    明确固定当前团队 {profile.id}
                  </label>
                </>
              )}
              <div className="bk-form-grid">
                {(
                  [
                    ["maxReadMiB", "原文预算（MiB）", 1024],
                    ["maxModelCalls", "模型调用预算", 1000],
                    ["durationMinutes", "截止（分钟）", 10080],
                    ["supplementMaterials", "技术补证材料数", 200000],
                    ["supplementMiB", "补证预算（MiB）", 1024],
                    ["supplementRules", "补证规则次数", 100000000],
                    ["supplementAttempts", "补证尝试数", 1000],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      required
                      type="number"
                      min={1}
                      max={max}
                      value={budget[key]}
                      onChange={(e) => setBudget((v) => ({ ...v, [key]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              className="button primary"
              disabled={
                !canMaintain ||
                !profile ||
                confirmed !== profile.id ||
                command.busy ||
                !!pending ||
                !!store.error
              }
            >
              2. 按已查看摘要明确创建新会话／调查
            </button>
          </form>
        </section>
      )}
    </details>
  );
}
function AdoptContinuation({
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
  const [revision, setRevision] = useState(""),
    [manual, setManual] = useState(""),
    command = useWorkCommand(client, `adopt-session:${session.id}`, onAccessLost);
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.publishedVersions(), []),
    versions = useKnowledgeRead(
      client,
      `continuation-publications:${session.id}`,
      load,
      onAccessLost,
      10000,
    );
  const read = useCallback(
    (bound: BusinessKnowledgeClient) => bound.readPublished(revision),
    [revision],
  );
  return (
    <details open={!session.binding.graphRevisionId}>
      <summary>步骤3：显式采用这个新调查的已发布图谱</summary>
      <p>
        新调查ID <code>{session.investigationId}</code>
        。发布前提不足时保留真实阻断，不用工作会话替代发布。
      </p>
      {canMaintain && (
        <button
          className="button"
          onClick={() => writeKnowledgePosition(client.workspaceId, session.investigationId!)}
        >
          读取这个调查的实际进度与发布条件
        </button>
      )}
      {versions.error && <ReadIssue error={versions.error} retry={versions.retry} />}
      <label>
        选择确属新调查的发布修订
        <select value={revision} onChange={(e) => setRevision(e.target.value)}>
          <option value="">不自动选择最新</option>
          {versions.data
            ?.filter(
              (v) =>
                v.investigationId === session.investigationId &&
                v.binding.sourceInput.sourceBundleSnapshotId ===
                  session.binding.sourceInput.sourceBundleSnapshotId &&
                v.binding.sourceInput.receiptId === session.binding.sourceInput.receiptId,
            )
            .map((v) => (
              <option key={v.graphRevisionId} value={v.graphRevisionId}>
                {v.graphRevisionId} · {v.graphDigest}
              </option>
            ))}
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRevision(manual.trim());
        }}
      >
        <label>
          或读取清单外的精确发布修订
          <input
            required
            maxLength={128}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <button className="button">读取指定候选</button>
      </form>
      <CommandIssue error={command.error} />
      {revision && (
        <AdoptChosen
          key={revision}
          client={client}
          session={session}
          revision={revision}
          read={read}
          actorId={actorId}
          canMaintain={canMaintain}
          onAccessLost={onAccessLost}
          onChanged={onChanged}
        />
      )}
    </details>
  );
}
function AdoptChosen({
  client,
  session,
  revision,
  read,
  actorId,
  canMaintain,
  onAccessLost,
  onChanged,
}: {
  client: BusinessKnowledgeClient;
  session: WorkSession;
  revision: string;
  read: (client: BusinessKnowledgeClient) => ReturnType<BusinessKnowledgeClient["readPublished"]>;
  actorId: string;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
  onChanged: () => void;
}) {
  const state = useKnowledgeRead(client, `adopt-chosen:${revision}`, read, onAccessLost),
    command = useWorkCommand(client, `adopt-chosen:${session.id}:${revision}`, onAccessLost);
  const [initialStore] = useState(() => {
      try {
        const journal = new WorkJournal(
          window.localStorage,
          client.workspaceId,
          actorId,
          `adopt:${session.id}`,
        );
        journal.read();
        return { journal, error: null };
      } catch (cause) {
        return { journal: null, error: cause as Error };
      }
    }),
    store = journalSnapshot(initialStore),
    journal = store.journal,
    pending = store.pending;
  const p = state.data?.publication,
    match =
      p &&
      p.investigationId === session.investigationId &&
      p.binding.sourceInput.sourceBundleSnapshotId ===
        session.binding.sourceInput.sourceBundleSnapshotId &&
      p.binding.sourceInput.receiptId === session.binding.sourceInput.receiptId &&
      JSON.stringify(p.binding.adoptedVersionIds) ===
        JSON.stringify(session.binding.adoptedVersionIds);
  return (
    <section>
      <CommandIssue error={command.error ?? store.error} />
      {state.error && <ReadIssue error={state.error} retry={state.retry} />}
      {p && (
        <p>
          {match
            ? "已核对属于本新调查的精确发布结果"
            : "不属于这个新调查／来源／技术采用；不能采用"}{" "}
          · {p.graphRevisionId} · {p.graphDigest}
        </p>
      )}
      {pending && (
        <div className="bk-warning">
          <p>原采用操作 {pending.operationId} 未确认；不自动重写。</p>
          <button
            className="button"
            disabled={command.busy}
            onClick={() =>
              void command.execute(
                async () => {
                  return (await client.work().operation(pending.operationId,operationLookup(pending,'ADOPT_GRAPH',session.id,session.binding))).event!;
                },
                () => {
                  journal!.resolve(pending.operationId);
                  onChanged();
                  command.setNotice("已从持久事件找回原采用操作；当前绑定仍以服务端读取为准。");
                },
              )
            }
          >
            只读找回原采用事件
          </button>
        </div>
      )}
      <button
        className="button primary"
        disabled={!canMaintain || !match || command.busy || !!pending || !journal}
        onClick={() =>
          void command.execute(
            async () => {
              const input={operationId:crypto.randomUUID(),expectedSessionVersion:session.version,graphRevisionId:revision,expectedGraphDigest:p!.graphDigest,adoptedVersionIds:p!.binding.adoptedVersionIds};
              const operationId = await beginWorkOperation(journal!,'ADOPT_GRAPH',session.id,session.binding,input);
              try {
                const result = await client.work().adopt(session.id,input);
                journal!.accepted(operationId, result.event.id);
                return result;
              } catch (cause) {
                if (
                  cause instanceof BusinessKnowledgeError &&
                  (cause.status === 422 ||
                    [
                      "F003_SESSION_WRITE_BLOCKED",
                      "F003_SESSION_CONFLICT",
                      "F003_CONTINUATION_GRAPH_MISMATCH",
                    ].includes(cause.code))
                )
                  journal!.resolve(operationId);
                throw cause;
              }
            },
            () => {
              const op = journal!.read();
              if (op) journal!.resolve(op.operationId);
              onChanged();
            },
          )
        }
      >
        3. 明确采用此新调查的精确已发布图谱
      </button>
    </section>
  );
}
