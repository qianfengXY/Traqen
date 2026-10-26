"use client";
import { useCallback, useContext, useState } from "react";
import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import { CommandIssue, useWorkCommand } from "./work-common.tsx";
import { useKnowledgeRead } from "./use-read.ts";
import { ReadIssue } from "./read-issue.tsx";
import { ReviewRoleContext } from "./review-role.tsx";
import type { ClaimTarget } from "./governance-client.ts";
import type { PublishedVersion } from "./authority-types.ts";
import type { Proposition } from "./types.ts";
import { WorkJournal, journalSnapshot } from "./work-journal.ts";

type HumanReviewProps = {
  client: BusinessKnowledgeClient;
  actorId: string;
  version: PublishedVersion;
  record: Proposition;
  canMaintain: boolean;
  onAccessLost: (error: Error) => void;
};

export function HumanReview(props: HumanReviewProps) {
  // The published explorer/session form intentionally survives object changes.
  // Only this governance form owns object-scoped drafts, verified state and a
  // journal. Remount it, not the whole published detail. The old journal stays
  // durably in its original namespace for an explicit GET recovery on return.
  const identity = JSON.stringify([
    props.client.workspaceId,
    props.actorId,
    props.version.publication.graphRevisionId,
    props.record.key,
  ]);
  return <HumanReviewForm key={identity} {...props} />;
}

function HumanReviewForm({
  client,
  actorId,
  version,
  record,
  canMaintain,
  onAccessLost,
}: HumanReviewProps) {
  const roles = useContext(ReviewRoleContext),
    command = useWorkCommand(
      client,
      `human:${version.publication.graphRevisionId}:${record.key}`,
      onAccessLost,
    );
  const [target, setTarget] = useState<ClaimTarget>({
    featureId: "",
    featureVersion: 1,
    claimId: "",
    claimVersion: 1,
    scopeId: "",
    scopeVersion: 1,
  });
  const [name, setName] = useState(record.name ?? record.predicate ?? ""),
    [scope, setScope] = useState(record.scope),
    [statement, setStatement] = useState(record.statement ?? record.predicate ?? "");
  const [caseId, setCaseId] = useState(""),
    [lookup, setLookup] = useState(""),
    [risk, setRisk] = useState("MEDIUM"),
    [mode, setMode] = useState("DUAL"),
    [decision, setDecision] = useState("CONFIRMED"),
    [rationale, setRationale] = useState(""),
    [hours, setHours] = useState(24);
  const [verified, setVerified] = useState("");
  const targetKey = JSON.stringify(target);
  const [initialStore] = useState(() => {
      try {
        const journal = new WorkJournal(
          window.localStorage,
          client.workspaceId,
          actorId,
          `human:${version.publication.graphRevisionId}:${record.key}`,
        );
        journal.read();
        return { journal, error: null };
      } catch (cause) {
        return { journal: null, error: cause as Error };
      }
    }),
    store = journalSnapshot(initialStore),
    pending = store.pending;
  const readCase = useCallback(
    async (bound: BusinessKnowledgeClient) => {
      const v = await bound.governance().review(lookup),
        c = v.reviewCase;
      if (
        c.claimId !== target.claimId ||
        c.claimVersion !== target.claimVersion ||
        c.scopeId !== target.scopeId ||
        c.scopeVersion !== target.scopeVersion
      )
        throw new BusinessKnowledgeError(
          "复核案例不属于当前明确Claim/scope版本，未套用到本对象。",
          "F003_RESPONSE_INVALID",
        );
      return v;
    },
    [lookup, target.claimId, target.claimVersion, target.scopeId, target.scopeVersion],
  );
  // A separate child mounts only after explicit case selection; no guessed GET.
  return (
    <section className="bk-authority" aria-label="单条对象人工复核">
      <h4>单条对象／关系的人工复核</h4>
      <p>
        固定对象：<code>{record.key}</code>；发布修订：{version.publication.graphRevisionId}
        。创建Claim、提出决定、独立审批、图谱版本映射是四个分开的显式操作，不提供整个子图一键认可。
      </p>
      <CommandIssue error={command.error ?? store.error} />
      {command.notice && <p role="status">{command.notice}</p>}
      {pending && (
        <div className="bk-warning">
          <p>原提案ID {pending.operationId}。刷新或失联不会产生第二份提案。</p>
          <button
            className="button"
            disabled={command.busy}
            onClick={() =>
              void command.execute(
                async () => {
                  const current = await client.currentWorkspaceRole(),
                    v = await client.governance().review(pending.operationId),
                    c = v.reviewCase;
                  // Local coordinates are not authority. A readable case must
                  // still belong to this exact published object and proposer.
                  // A remounted form may be empty; recover the server's actual
                  // Claim/scope coordinates without restoring verified state.
                  if (
                    c.proposerId !== current.actor.actorId ||
                    !c.proposedDecision.evidenceRefs.includes(
                      `F003:${version.publication.graphRevisionId}:${record.key}`,
                    ) ||
                    (target.claimId &&
                      (c.claimId !== target.claimId || c.claimVersion !== target.claimVersion)) ||
                    (target.scopeId &&
                      (c.scopeId !== target.scopeId || c.scopeVersion !== target.scopeVersion))
                  )
                    throw Error("原提案不属于当前账号、精确对象或明确Claim/scope；保留原坐标，未套用。");
                  return v;
                },
                (v) => {
                  store.journal!.resolve(pending.operationId);
                  setTarget((old) => ({
                    ...old,
                    claimId: v.reviewCase.claimId,
                    claimVersion: v.reviewCase.claimVersion,
                    scopeId: v.reviewCase.scopeId,
                    scopeVersion: v.reviewCase.scopeVersion,
                  }));
                  setVerified("");
                  setCaseId(v.reviewCase.id);
                  setLookup(v.reviewCase.id);
                  command.setNotice("已只读找回原提案；未重复提交。");
                },
              )
            }
          >
            只读找回原人工提案
          </button>
        </div>
      )}
      <div className="bk-authority-fields">
        {(
          [
            "featureId",
            "featureVersion",
            "claimId",
            "claimVersion",
            "scopeId",
            "scopeVersion",
          ] as const
        ).map((k) => (
          <label key={k}>
            {k}
            <input
              type={k.endsWith("Version") ? "number" : "text"}
              min={1}
              maxLength={128}
              value={target[k]}
              onChange={(e) => {
                setTarget((v) => ({
                  ...v,
                  [k]: k.endsWith("Version") ? Number(e.target.value) : e.target.value,
                }));
                setLookup("");
              }}
            />
          </label>
        ))}
      </div>
      <details>
        <summary>明确创建单条Feature / scope / Claim（如已有则不创建）</summary>
        <p>使用现有治理API和真实维护权限；每次只保存一项。冲突或失联后先按同ID读取，不自动重写。</p>
        <label>
          Feature名称
          <input maxLength={256} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="button"
          disabled={!canMaintain || command.busy || !target.featureId || !name.trim()}
          onClick={() =>
            void command.execute(
              () =>
                client
                  .governance()
                  .feature({ id: target.featureId, version: target.featureVersion, name }),
              () => command.setNotice("Feature版本已保存；未创建或批准Claim。"),
            )
          }
        >
          保存明确Feature版本
        </button>
        <label>
          适用scope文字
          <textarea maxLength={16384} value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
        <button
          className="button"
          disabled={!canMaintain || command.busy || !target.scopeId || !scope.trim()}
          onClick={() =>
            void command.execute(
              () =>
                client
                  .governance()
                  .scope({
                    id: target.scopeId,
                    version: target.scopeVersion,
                    scope: { description: scope },
                  }),
              () => command.setNotice("scope版本已保存；不是全图认可。"),
            )
          }
        >
          保存明确scope版本
        </button>
        <label>
          这一条Claim的明确陈述
          <textarea
            maxLength={16384}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={
            !canMaintain ||
            command.busy ||
            !target.claimId ||
            !target.featureId ||
            !target.scopeId ||
            !statement.trim()
          }
          onClick={() =>
            void command.execute(
              () =>
                client
                  .governance()
                  .claim({
                    id: target.claimId,
                    version: target.claimVersion,
                    featureId: target.featureId,
                    type: "NORMATIVE_REQUIREMENT",
                    statement,
                    sourceType: "HUMAN",
                    evidenceSupport: "INCOMPLETE",
                    scopeId: target.scopeId,
                    scopeVersion: target.scopeVersion,
                  }),
              () => {
                command.setNotice(
                  "单条人工起草Claim已保存；证据仍记INCOMPLETE，尚未产生批准决定。",
                );
                setVerified("");
              },
            )
          }
        >
          保存这一条待复核Claim
        </button>
      </details>
      <button
        className="button"
        disabled={command.busy || !target.featureId}
        onClick={() =>
          void command.execute(
            async () => {
              const b = await client.governance().baseline(target.featureId),
                c = b.claims.find(
                  (x) => x.claim.id === target.claimId && x.claim.version === target.claimVersion,
                )?.claim;
              if (
                b.feature.version !== target.featureVersion ||
                !c ||
                c.scopeId !== target.scopeId ||
                c.scopeVersion !== target.scopeVersion
              )
                throw Error(
                  "现有Feature / Claim / scope版本不匹配；请明确选择，不按同名或latest替换。",
                );
              return b;
            },
            () => {
              setVerified(targetKey);
              command.setNotice("当前服务端Feature/Claim/scope版本已核对；仍不是批准。");
            },
          )
        }
      >
        读取并核对这条Claim的现有版本
      </button>
      <label>
        本次明确审核角色
        <select value={roles.selected} onChange={(e) => roles.choose(e.target.value)}>
          <option value="">请选择当前账号已授予角色</option>
          {roles.roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <p>
        角色来自当前工作区授权；服务端再次复验，选择角色不能自行赋权。提议人与审批人须满足独立性策略。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canMaintain || verified !== targetKey || !roles.selected) return;
          void command.execute(
            async () => {
              if (!store.journal || pending) throw Error("请先找回原提案");
              const id = store.journal.begin(caseId.trim() || crypto.randomUUID());
              setCaseId(id);
              try {
                return await client
                  .governance()
                  .propose({
                    id,
                    claimId: target.claimId,
                    claimVersion: target.claimVersion,
                    scopeId: target.scopeId,
                    scopeVersion: target.scopeVersion,
                    risk,
                    approvalMode: mode,
                    expiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
                    proposedDecision: {
                      id: `decision-${id}`,
                      type: decision,
                      content: rationale,
                      evidenceRefs: [`F003:${version.publication.graphRevisionId}:${record.key}`],
                      validUntil: null,
                    },
                  });
              } catch (cause) {
                if (
                  cause instanceof BusinessKnowledgeError &&
                  [400, 403, 422].includes(cause.status)
                )
                  store.journal.resolve(id);
                throw cause;
              }
            },
            (v) => {
              store.journal!.resolve(v.reviewCase.id);
              setLookup(v.reviewCase.id);
              command.setNotice("决定提案已保存；是否生效以服务端独立审批求值为准。");
            },
          );
        }}
      >
        <fieldset disabled={command.busy || !!pending}>
          <legend>提出单条决定，不直接批准</legend>
          <label>
            复核案例ID（留空时生成；失联保留同ID）
            <input maxLength={128} value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          </label>
          <label>
            风险
            <select
              value={risk}
              onChange={(e) => {
                setRisk(e.target.value);
                if (["HIGH", "CRITICAL"].includes(e.target.value) && mode === "SINGLE")
                  setMode("DUAL");
              }}
            >
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            审批模式
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {(["HIGH", "CRITICAL"].includes(risk)
                ? ["DUAL", "BUSINESS_COMPLIANCE"]
                : ["SINGLE", "DUAL", "BUSINESS_COMPLIANCE"]
              ).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            拟议决定
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              {[
                "CONFIRMED",
                "REJECTED",
                "EXCEPTION_RECORDED",
                "INSUFFICIENT_EVIDENCE",
                "DEFERRED",
                "DEPRECATED",
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            提案理由与适用条件
            <textarea
              required
              maxLength={16384}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </label>
          <label>
            提案到期时长（小时）
            <input
              required
              type="number"
              min={1}
              max={8760}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
        </fieldset>
        <button
          className="button"
          disabled={
            !canMaintain || command.busy || verified !== targetKey || !roles.selected || !!pending || !store.journal
          }
        >
          明确提出此Claim的决定复核
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setLookup(caseId.trim());
        }}
      >
        <label>
          原案例／另一审批人共享的精确ID
          <input
            required
            maxLength={128}
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          />
        </label>
        <button className="button" disabled={!target.claimId || !target.scopeId}>
          只读找回该案例
        </button>
      </form>
      {lookup && (
        <CaseDetail
          key={`${lookup}:${targetKey}`}
          client={client}
          actorId={actorId}
          id={lookup}
          load={readCase}
          role={roles.selected}
          onAccessLost={onAccessLost}
        />
      )}
      <p>
        决定完成后仍须在上方“权威映射”中显式绑定精确Claim/scope版本；不会自动继承到此图谱或其他修订。
      </p>
    </section>
  );
}
function CaseDetail({
  client,
  actorId,
  id,
  load,
  role,
  onAccessLost,
}: {
  client: BusinessKnowledgeClient;
  actorId: string;
  id: string;
  load: (
    client: BusinessKnowledgeClient,
  ) => ReturnType<ReturnType<BusinessKnowledgeClient["governance"]>["review"]>;
  role: string;
  onAccessLost: (error: Error) => void;
}) {
  const state = useKnowledgeRead(client, `decision-case:${id}`, load, onAccessLost, 5000),
    command = useWorkCommand(client, `decision-event:${id}`, onAccessLost);
  const [action, setAction] = useState("APPROVE"),
    [rationale, setRationale] = useState("");
  const [initialStore] = useState(() => {
      try {
        const journal = new WorkJournal(
          window.localStorage,
          client.workspaceId,
          actorId,
          `review-event:${id}`,
        );
        journal.read();
        return { journal, error: null };
      } catch (cause) {
        return { journal: null, error: cause as Error };
      }
    }),
    store = journalSnapshot(initialStore),
    pending = store.pending;
  return (
    <section className="bk-panel" aria-label="独立审批案例">
      <h5>独立审批案例 {id}</h5>
      {state.error && <ReadIssue error={state.error} retry={state.retry} />}
      {state.data && (
        <>
          <p>
            提议人：{state.data.reviewCase.proposerId}（{state.data.reviewCase.proposerRole}
            ）；策略：{state.data.reviewCase.approvalMode}；到期：{state.data.reviewCase.expiresAt}
          </p>
          <details open>
            <summary>服务端审批求值</summary>
            <pre>{JSON.stringify(state.data.evaluation, null, 2)}</pre>
          </details>
          <ol>
            {state.data.events.map((e) => (
              <li key={e.id}>
                {e.action} · {e.actorId} / {e.actorRole} · {e.rationale}
              </li>
            ))}
          </ol>
        </>
      )}
      <CommandIssue error={command.error ?? store.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!role || !store.journal || pending) return;
          void command.execute(
            async () => {
              const next = store.journal!.begin();
              try {
                return await client.governance().event(id, { id: next, action, rationale });
              } catch (cause) {
                if (
                  cause instanceof BusinessKnowledgeError &&
                  [400, 403, 422].includes(cause.status)
                )
                  store.journal!.resolve(next);
                throw cause;
              }
            },
            () => {
              const op = store.journal!.read();
              if (op) store.journal!.resolve(op.operationId);
              setRationale("");
              state.retry();
            },
          );
        }}
      >
        <label>
          审核动作
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {["APPROVE", "REJECT", "REVOKE", "DISPUTE", "REOPEN", "POST_REVIEW"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          明确理由
          <textarea
            required
            maxLength={16384}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </label>
        {pending && <p>原次动作ID {pending.operationId}。结果未确认时只读刷新核对，不自动重发。</p>}
        <button
          className="button"
          disabled={command.busy || !role || !state.data || !!pending || !store.journal}
        >
          以当前独立账号提交审核动作
        </button>
        <button
          type="button"
          className="button"
          disabled={command.busy || !pending}
          onClick={() =>
            void command.execute(
              async () => {
                const v = await load(client);
                if (!v.events.some((e) => e.id === pending!.operationId))
                  throw Error("原动作仍未确认；保留坐标，不自动重发。");
                return v;
              },
              () => {
                store.journal!.resolve(pending!.operationId);
                state.retry();
                command.setNotice("已只读确认原审核事件。");
              },
            )
          }
        >
          只读核对原动作
        </button>
      </form>
    </section>
  );
}
