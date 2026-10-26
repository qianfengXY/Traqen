"use client";
import { useCallback, useState } from "react";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { ReadIssue } from "./read-issue.tsx";
import { PublishedExplorer } from "./published-explorer.tsx";
import { openWork } from "./work-route.ts";
import { BindingDetails, CommandIssue, useWorkCommand, useWorkspaceRole } from "./work-common.tsx";
import { WorkJournal, rememberSession, beginWorkOperation, operationLookup } from "./work-journal.ts";
import {ServerSessions} from './work-discovery.tsx';
import { AuthorityStatus } from "./authority-status.tsx";
import { AuthorityEditor } from "./authority-editor.tsx";
import type { PublishedVersion } from "./authority-types.ts";
import { HumanReview } from "./human-review.tsx";

export function PublishedLibrary({
  client,
  apiBase,
  actorId,
  revision,
  objectKey,
  materialId,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  apiBase: string;
  actorId: string;
  revision?: string;
  objectKey?: string;
  materialId?: string;
  onAccessLost: (error: Error) => void;
}) {
  const [manual, setManual] = useState("");
  const load = useCallback(
    async (bound: BusinessKnowledgeClient) => ({
      current: await bound.currentPublication(),
      versions: await bound.publishedVersions(),
    }),
    [],
  );
  const list = useKnowledgeRead(client, "publications-library", load, onAccessLost, 10000);
  return (
    <section className="bk-panel" aria-label="已发布知识">
      <h2>已发布知识</h2>
      <p>
        此入口独立于私人调查，不需要自动加入或委派调查。当前发布头与历史版本分别读取；打开版本不发起模型调用。
      </p>
      {list.loading && <p role="status">正在读取当前发布头与历史…</p>}
      {list.error && <ReadIssue error={list.error} retry={list.retry} />}
      {list.data && (
        <>
          <h3>当前发布头</h3>
          {list.data.current.head ? (
            <p>
              r{list.data.current.head.version}{" "}
              <button
                className="button"
                onClick={() =>
                  openWork(client.workspaceId, {
                    tab: "published",
                    revision: list.data!.current.head!.graphRevisionId,
                  })
                }
              >
                打开当前头的精确发布版本
              </button>
            </p>
          ) : (
            <p>尚无当前发布版本。不是没有私人调查，也不会自动创建调查。</p>
          )}
          <details>
            <summary>已发布历史 · {list.data.versions.length}</summary>
            <ul>
              {list.data.versions.map((p) => (
                <li key={p.graphRevisionId}>
                  <button
                    className="bk-text-button"
                    onClick={() =>
                      openWork(client.workspaceId, {
                        tab: "published",
                        revision: p.graphRevisionId,
                      })
                    }
                  >
                    r{p.headVersion} · {p.publishedAt} · {p.graphRevisionId}
                  </button>
                </li>
              ))}
            </ul>
            {list.data.versions.length === 1000 && (
              <p>达到服务端清单上限；更早版本仍可通过精确修订地址读取，不把截断当作完整历史。</p>
            )}
          </details>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          openWork(client.workspaceId, { tab: "published", revision: manual.trim() });
        }}
      >
        <label>
          精确 GraphRevision 地址
          <input
            required
            maxLength={128}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <button className="button">读取指定发布版本</button>
      </form>
      {revision && (
        <PublishedDetail
          key={revision}
          client={client}
          apiBase={apiBase}
          actorId={actorId}
          revision={revision}
          objectKey={objectKey ?? ""}
          materialId={materialId}
          onAccessLost={onAccessLost}
        />
      )}
    </section>
  );
}
function PublishedDetail({
  client,
  apiBase,
  actorId,
  revision,
  objectKey,
  materialId,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  apiBase: string;
  actorId: string;
  revision: string;
  objectKey: string;
  materialId?: string;
  onAccessLost: (error: Error) => void;
}) {
  const load = useCallback(
    (bound: BusinessKnowledgeClient) => bound.readPublished(revision),
    [revision],
  );
  const state = useKnowledgeRead(client, `public-revision:${revision}`, load, onAccessLost, 10000);
  const role = useWorkspaceRole(client, apiBase, onAccessLost);
  if (state.error) return <ReadIssue error={state.error} retry={state.retry} />;
  if (!state.data) return <p role="status">正在读取精确已发布图谱…</p>;
  const value = state.data,
    p = value.publication,
    raw = value.graph,
    record = [...raw.candidates, ...raw.relations].find((x) => x.key === objectKey);
  return (
    <section aria-label="精确已发布图谱">
      <h3>发布版本 r{p.headVersion}</h3>
      <p>
        <code>{revision}</code> · {p.publishedAt}
      </p>
      <p>
        发布是受控版本身份，不把分析收录提升为人工确认或可信执行通过。当前头变化不会替换此深链。
      </p>
      <PublishedExplorer client={client} version={value} objectKey={objectKey} materialId={materialId} onAccessLost={onAccessLost}/>
      {objectKey && !record && (
        <p role="alert">此精确版本不存在选定对象／关系；未替换为同名对象。</p>
      )}
      {record && (
        <section className="bk-panel">
          <div className="bk-heading">
            <h3>{record.name ?? record.predicate ?? record.key}</h3>
            <button
              className="button"
              onClick={() => openWork(client.workspaceId, { tab: "published", revision })}
            >
              关闭详情
            </button>
          </div>
          <PublishedAuthority
            key={`${revision}:${record.key}`}
            client={client}
            version={value}
            objectKey={record.key}
            canMaintain={role.data?.role === "MAINTAIN"}
            onAccessLost={onAccessLost}
          />
          <HumanReview
            client={client}
            actorId={actorId}
            version={value}
            record={record}
            canMaintain={role.data?.role === "MAINTAIN"}
            onAccessLost={onAccessLost}
          />
        </section>
      )}
      <SessionCreate
        key={revision}
        client={client}
        actorId={actorId}
        version={value}
        canMaintain={role.data?.role === "MAINTAIN"}
        onAccessLost={onAccessLost}
      />
      <ServerSessions key={`sessions:${revision}`} client={client} revision={revision} onAccessLost={onAccessLost}/>
    </section>
  );
}
function PublishedAuthority({
  client,
  version,
  objectKey,
  canMaintain,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  version: PublishedVersion;
  objectKey: string;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
}) {
  const [history, setHistory] = useState<number | undefined>(),
    [number, setNumber] = useState(1),
    p = version.publication;
  const fixed = { graphDigest: p.graphDigest, sourceBundleId: version.graph.sourceBundleId };
  const load = useCallback(
    (bound: BusinessKnowledgeClient) =>
      bound.authorityBindings(
        p.graphRevisionId,
        objectKey,
        { graphDigest: p.graphDigest, sourceBundleId: version.graph.sourceBundleId },
        history,
      ),
    [p.graphRevisionId, p.graphDigest, version.graph.sourceBundleId, objectKey, history],
  );
  const state = useKnowledgeRead(
    client,
    `published-authority:${p.graphRevisionId}:${objectKey}:${history}`,
    load,
    onAccessLost,
    10000,
  );
  return (
    <section>
      <h4>此单条对象／关系的人类决定与可信执行</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setHistory(number);
        }}
      >
        <label>
          历史映射版本
          <input
            type="number"
            min={1}
            step={1}
            required
            value={number}
            onChange={(e) => setNumber(Number(e.target.value))}
          />
        </label>
        <button className="button">读取历史映射</button>
        <button
          className="button"
          type="button"
          onClick={() => {
            setHistory(undefined);
            state.retry();
          }}
        >
          读取当前映射
        </button>
      </form>
      {state.error && <ReadIssue error={state.error} retry={state.retry} />}{" "}
      {state.loading && <p role="status">正在复验映射与权威…</p>}
      {state.data && (
        <>
          <AuthorityStatus value={state.data} />
          {canMaintain && history === undefined && (
            <AuthorityEditor
              client={client}
              revision={p.graphRevisionId}
              objectKey={objectKey}
              fixed={fixed}
              value={state.data}
              onAccessLost={onAccessLost}
              onRefresh={state.retry}
            />
          )}
        </>
      )}
    </section>
  );
}
function SessionCreate({
  client,
  actorId,
  version,
  canMaintain,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  actorId: string;
  version: PublishedVersion;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
}) {
  const [title, setTitle] = useState(""),
    [tick, setTick] = useState(0),
    command = useWorkCommand(
      client,
      `session-create:${version.publication.graphRevisionId}`,
      onAccessLost,
    );
  const [store] = useState(() => {
    try {
      return {
        journal: new WorkJournal(
          window.localStorage,
          client.workspaceId,
          actorId,
          `create:${version.publication.graphRevisionId}`,
        ),
        error: null,
      };
    } catch (cause) {
      return { journal: null, error: cause as Error };
    }
  });
  let pending = null,
    error = store.error;
  try {
    pending = store.journal?.read() ?? null;
  } catch (cause) {
    error = cause as Error;
  }
  const binding = {
    graphRevisionId: version.publication.graphRevisionId,
    graphDigest: version.graph.digest,
    sourceInput: version.publication.binding.sourceInput,
    adoptedVersionIds: version.graph.adoptedVersionIds,
  };
  return (
    <section className="bk-panel" aria-label="创建图谱工作会话">
      <h3>围绕此版本开始工作会话</h3>
      <p>会话绑定精确图谱与摘要；后续每个问题单独运行并累计预算。创建会话本身不调用模型。</p>
      <BindingDetails binding={binding} />
      <CommandIssue error={command.error ?? error} />
      {pending && (
        <div className="bk-warning">
          <p>
            原次操作：<code>{pending.operationId}</code>。未自动重复提交。
          </p>
            <button
              className="button"
              disabled={command.busy}
              onClick={() =>
                void command.execute(
                  async () => {
                    return (await client.work().operation(pending!.operationId,operationLookup(pending!,'CREATE_SESSION',null,binding))).session;
                  },
                  (value) => {
                    store.journal!.resolve(pending!.operationId);
                    try {rememberSession(client.workspaceId, actorId, value.id);}catch{/* Optional bookmark only. */}
                    openWork(client.workspaceId, { tab: "sessions", session: value.id });
                  },
                )
              }
            >
              读取原次会话
            </button>
          <p>按本人原操作键读取；未找到仍视为受理未知，不另建重复会话。</p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!store.journal || pending) return;
          void command.execute(
            async () => {
              const input={operationId:crypto.randomUUID(),expectedGraphDigest:binding.graphDigest,title};
              const operationId = await beginWorkOperation(store.journal!,'CREATE_SESSION',null,binding,input);
              setTick(tick + 1);
              try {
                const value = await client
                  .work()
                  .create(binding.graphRevisionId, input);
                store.journal!.accepted(operationId, value.session.id);
                return value;
              } catch (cause) {
                if (
                  cause instanceof Error &&
                  "status" in cause &&
                  (cause.status === 422 ||
                    (cause instanceof BusinessKnowledgeError &&
                      cause.code === "F003_SESSION_WRITE_BLOCKED"))
                )
                  store.journal!.resolve(operationId);
                throw cause;
              }
            },
            (value) => {
              try{rememberSession(client.workspaceId, actorId, value.session.id);}catch{/* Optional bookmark only. */}
              store.journal!.resolve(value.session.operationId);
              openWork(client.workspaceId, { tab: "sessions", session: value.session.id });
            },
          );
        }}
      >
        <label>
          会话标题
          <input
            required
            maxLength={256}
            value={title}
            disabled={command.busy || !!pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={!canMaintain || !!pending || !!error || command.busy}
        >
          显式创建此版本的工作会话
        </button>
      </form>
      {!canMaintain && <p>当前只读；维护成员可显式创建。发布或质量地基不足时服务端仍会阻断。</p>}
    </section>
  );
}
