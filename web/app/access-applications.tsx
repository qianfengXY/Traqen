"use client";
import { useRef, useState } from "react";
import { authCall, openAccess } from "./auth-client";
import { type AccessApplication, type AccessContext, type RunAction, roleLabel, statusLabel } from "./access-types";
export function RolePicker({
  roles,
  value,
  onChange,
  manager = false,
}: {
  roles: string[];
  value: string[];
  onChange: (roles: string[]) => void;
  manager?: boolean;
}) {
  return (
    <fieldset className="f008-member-picker">
      <legend>角色集合</legend>
      {["READ", "MAINTAIN", ...(manager ? ["PERMISSION_ADMIN"] : []), ...roles].map((role) => (
        <label className="check" key={role}>
          <input
            type="checkbox"
            checked={value.includes(role)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, role] : value.filter((item) => item !== role))
            }
          />
          {roleLabel(role)}
        </label>
      ))}
    </fieldset>
  );
}
export function ApplicationForm({
  context,
  workspaceId,
  onDone,
  run,
  busy,
  kind = "CREATE",
  entry,
}: {
  context: AccessContext;
  workspaceId?: string;
  onDone: () => Promise<void>;
  run: RunAction;
  busy: boolean;
  kind?: string;
  entry?: string;
}) {
  const [roles, setRoles] = useState(["READ"]);
  const operation = useRef(crypto.randomUUID());
  return (
    <form
      className="f008-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(async () => {
          await authCall("/v1/access/applications", "POST", {
            kind,
            name: form.get("name"),
            reason: form.get("reason"),
            workspaceId,
            roles,
            operationId: operation.current,
            entry,
          });
          operation.current = crypto.randomUUID();
          await onDone();
          openAccess("applications");
        });
      }}
    >
      <h2>{kind === "CREATE" ? "申请创建空间" : "申请加入空间"}</h2>
      {kind === "CREATE" ? (
        <>
          <label>
            空间名称
            <input name="name" required maxLength={160} />
          </label>
          <p>系统管理员批准后，你将成为空间 Owner；不会自动启动采集或分析。</p>
        </>
      ) : (
        <>
          <p>申请由目标空间的 Owner 或权限管理员处理。</p>
          <RolePicker roles={context.reviewRoles} value={roles} onChange={setRoles} />
        </>
      )}
      <label>
        {kind === "CREATE" ? "用途" : "申请理由"}
        <textarea name="reason" required maxLength={2000} rows={4} />
      </label>
      <p>审核角色中的业务组与合规组不能兼任。批准结果可能低于申请权限，请以实际授予为准。</p>
      <button className="button primary" disabled={busy || (kind !== "CREATE" && !roles.length)}>
        提交申请
      </button>
    </form>
  );
}
export function Applications({
  items,
  context,
  pending,
  run,
  busy,
  refresh,
  accountId,
}: {
  items: AccessApplication[];
  context: AccessContext;
  pending: boolean;
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
  accountId: string;
}) {
  const [selected, setSelected] = useState<AccessApplication | null>(null),
    [roles, setRoles] = useState<string[]>([]);
  const decide = (approve: boolean, reason: string) => {
    if (!selected) return;
    void run(async () => {
      await authCall(`/v1/access/applications/${selected.id}/decide`, "POST", {
        approve,
        roles,
        reason,
        version: selected.version,
      });
      await refresh();
      setSelected(null);
    });
  };
  return (
    <div className="f008-grid">
      <section className="panel">
        <h2>{pending ? "待审批申请" : "申请记录"}</h2>
        {items.length ? (
          <table>
            <thead>
              <tr>
                <th>申请</th>
                <th>角色与理由</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name ??
                      item.spaceName ??
                      context.spaces.find((space) => space.id === item.workspaceId)?.name ??
                      "加入空间"}
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                    <small>申请人 {item.accountId === accountId ? "我" : (item.requesterName ?? item.accountId)}</small>
                  </td>
                  <td>
                    {item.requestedRoles.map(roleLabel).join("、") || "批准后成为 Owner"}
                    <small>{item.reason}</small>
                  </td>
                  <td>
                    <span className="tag">{statusLabel(item.status)}</span>
                    {item.actualRoles && <small>实际授予：{item.actualRoles.map(roleLabel).join("、") || "无"}</small>}
                    {item.decisionReason && <small>原因：{item.decisionReason}</small>}
                  </td>
                  <td className="actions">
                    {pending && item.status === "PENDING" ? (
                      <button
                        className="button"
                        onClick={() => {
                          setSelected(item);
                          setRoles(item.requestedRoles);
                        }}
                      >
                        处理
                      </button>
                    ) : (
                      item.status === "PENDING" && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await authCall(`/v1/access/applications/${item.id}/withdraw`, "POST", {});
                              await refresh();
                            })
                          }
                        >
                          撤回
                        </button>
                      )
                    )}
                    <button
                      className="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          `${location.origin}/?page=settings&view=pending&applicationId=${encodeURIComponent(item.id)}${item.workspaceId ? "&workspace=" + encodeURIComponent(item.workspaceId) : ""}`,
                        )
                      }
                    >
                      复制申请链接
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>没有符合条件的申请。</p>
        )}
      </section>
      <aside className="panel">
        {selected ? (
          <>
            <h2>处理申请</h2>
            <p>{selected.reason}</p>
            {selected.kind === "JOIN" && (
              <RolePicker
                manager={context.canAdmin || context.spaces.find((space) => space.id === selected.workspaceId)?.canOwn}
                roles={context.reviewRoles}
                value={roles}
                onChange={setRoles}
              />
            )}
            <p>可以降级为查看；业务组与合规组互斥。服务端会重新检查申请与授权。</p>
            <form
              className="f008-form"
              onSubmit={(event) => {
                event.preventDefault();
                decide(false, String(new FormData(event.currentTarget).get("reason")));
              }}
            >
              <label>
                处理理由
                <textarea name="reason" rows={3} required />
              </label>
              <button
                type="button"
                className="button primary"
                disabled={busy || (selected.kind === "JOIN" && !roles.length)}
                onClick={() => decide(true, "")}
              >
                批准所选角色
              </button>
              <button className="button danger" disabled={busy}>
                拒绝并记录原因
              </button>
            </form>
          </>
        ) : (
          <>
            <h2>申请详情</h2>
            <p>选择一条申请查看详情。历史通过记录不会覆盖后来撤销的权限。</p>
          </>
        )}
      </aside>
    </div>
  );
}
