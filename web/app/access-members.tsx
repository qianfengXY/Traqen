"use client";
import { useState } from "react";
import { authCall, openAccess, type Person } from "./auth-client";
import { type AccessContext, type AccessSpace, type Member, type RunAction, roleLabel } from "./access-types";
import { RolePicker } from "./access-applications";
export function Members({
  workspace,
  members,
  context,
  run,
  busy,
  refresh,
}: {
  workspace: AccessSpace;
  members: Member[];
  context: AccessContext;
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [target, setTarget] = useState<Person | null>(null),
    [roles, setRoles] = useState<string[]>([]),
    [candidates, setCandidates] = useState<Person[]>([]);
  const prefix = `/v1/access/spaces/${encodeURIComponent(workspace.id)}`;
  return (
    <div className="f008-grid">
      <section className="panel">
        <h2>成员与权限</h2>
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>角色</th>
              <th>授予来源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  {member.displayName}
                  <small>{member.login}</small>
                </td>
                <td>
                  {member.roles.map((role) => (
                    <span className="tag" key={role}>
                      {roleLabel(role)}
                    </span>
                  ))}
                </td>
                <td>
                  {member.grants.map((grant, i) => (
                    <small key={i}>
                      {grant.source === "ADMIN"
                        ? "管理员介入"
                        : grant.source === "APPLICATION"
                          ? "申请批准"
                          : "直接授予"}{" "}
                      · {grant.grantedByName ?? grant.grantedBy}
                      <br />
                      {new Date(grant.createdAt).toLocaleString()}
                    </small>
                  ))}
                </td>
                <td>
                  <button
                    className="button"
                    disabled={
                      !workspace.canOwn && member.roles.some((role) => ["OWNER", "PERMISSION_ADMIN"].includes(role))
                    }
                    onClick={() => {
                      setTarget(member);
                      setRoles(member.roles.filter((role) => role !== "OWNER"));
                    }}
                  >
                    编辑角色
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <aside className="panel">
        <h2>{target ? "编辑角色" : "添加成员"}</h2>
        <form
          className="f008-form"
          onSubmit={(event) => {
            event.preventDefault();
            const query = String(new FormData(event.currentTarget).get("query"));
            void run(async () => {
              const result = await authCall<{ accounts: Person[] }>(
                `${prefix}/candidates?query=${encodeURIComponent(query)}`,
              );
              setCandidates(result.accounts);
            });
          }}
        >
          <label>
            搜索有效账号
            <input name="query" minLength={2} required placeholder="账号或姓名" />
          </label>
          <button className="button" disabled={busy}>
            搜索
          </button>
        </form>
        {candidates.map((person) => (
          <button
            className="button"
            key={person.id}
            onClick={() => {
              setTarget(person);
              setRoles(members.find((m) => m.id === person.id)?.roles.filter((role) => role !== "OWNER") ?? []);
              setCandidates([]);
            }}
          >
            {person.displayName} · {person.login}
          </button>
        ))}
        {target && (
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await authCall(`${prefix}/members`, "PUT", { accountId: target.id, roles });
                setTarget(null);
                await refresh();
              });
            }}
          >
            <p>
              {target.displayName} · {target.login}
            </p>
            <RolePicker manager={workspace.canOwn} roles={context.reviewRoles} value={roles} onChange={setRoles} />
            <p>业务组与合规组不可兼任。留空将撤销普通角色；Owner 只能通过转让更换。</p>
            <button className="button primary" disabled={busy}>
              保存角色
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}
export function SpaceInformation({
  workspace,
  context,
  run,
  busy,
  refresh,
}: {
  workspace: AccessSpace;
  context: AccessContext;
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [entry, setEntry] = useState("");
  const prefix = `/v1/access/spaces/${encodeURIComponent(workspace.id)}`;
  return (
    <div className="f008-grid">
      <section className="panel">
        <h2>空间信息</h2>
        <p>
          {workspace.name} · Owner：{workspace.ownerName}
        </p>
        <form
          className="f008-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await authCall(`${prefix}/settings`, "PUT", { visibility: form.get("visibility") });
              await refresh();
            });
          }}
        >
          <label>
            可见性
            <select name="visibility" defaultValue={workspace.visibility} disabled={!workspace.canOwn}>
              <option value="DISCOVERABLE">可发现 · 只公开名称与 Owner</option>
              <option value="SECRET">保密 · 通过申请入口定位</option>
            </select>
          </label>
          <button className="button" disabled={busy || !workspace.canOwn}>
            保存可见性
          </button>
        </form>
        <hr />
        {workspace.canOwn && (
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await authCall(`/v1/workspaces/${encodeURIComponent(workspace.id)}`, "PATCH", {
                  name: form.get("name"),
                });
                await refresh();
              });
            }}
          >
            <label>
              空间名称
              <input name="name" defaultValue={workspace.name} maxLength={160} required />
            </label>
            <button className="button" disabled={busy}>
              保存名称
            </button>
          </form>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await authCall<{ entry: string }>(`${prefix}/entry`, "POST", {});
              setEntry(`${location.origin}/?page=overview&view=directory&entry=${encodeURIComponent(result.entry)}`);
            })
          }
        >
          生成申请入口
        </button>
        {entry && (
          <p className="f008-secret">
            {entry}
            <button className="button" onClick={() => void navigator.clipboard.writeText(entry)}>
              复制链接
            </button>
          </p>
        )}
        <p>申请入口只用于定位，不授予读取业务内容的权限。</p>
        {workspace.pendingOwner && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await authCall(`${prefix}/transfer`, "POST", { confirm: true });
                await refresh();
              })
            }
          >
            确认接任 Owner
          </button>
        )}
        {workspace.canOwn && (
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const query = String(form.get("login"));
                const { accounts } = await authCall<{ accounts: Person[] }>(
                  `${prefix}/candidates?query=${encodeURIComponent(query)}`,
                );
                const target = accounts.find((p) => p.login === query);
                if (!target) throw new Error("请填写接任者的完整登录名");
                await authCall(`${prefix}/${form.get("mode")}`, "POST", { accountId: target.id });
                await refresh();
              });
            }}
          >
            <h3>Owner 交接</h3>
            <label>
              接任者登录名
              <input name="login" required />
            </label>
            <label>
              交接方式
              <select name="mode">
                <option value="transfer">转让 · 接任者确认后生效</option>
                {context.canAdmin && <option value="designate">恢复管理 · 管理员直接指定</option>}
              </select>
            </label>
            <button className="button" disabled={busy}>
              发起交接
            </button>
          </form>
        )}
      </section>
      <aside className="panel">
        <h2>管理与业务分开</h2>
        <p>管理角色不自动授予业务审核权。</p>
        {context.canAdmin && (
          <>
            <p>读取业务内容前，系统管理员需要明确取得角色，空间管理者可见介入记录。</p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await authCall(`${prefix}/intervene`, "POST", { roles: ["READ"] });
                  await refresh();
                  openAccess("spaces");
                })
              }
            >
              以系统管理员身份取得查看
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await authCall(`${prefix}/intervene`, "POST", { roles: ["MAINTAIN"] });
                  await refresh();
                  openAccess("spaces");
                })
              }
            >
              以系统管理员身份取得维护
            </button>
          </>
        )}
        {workspace.canOwn && (
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                if (form.get("confirmation") !== workspace.name) throw new Error("请完整输入空间名称确认");
                await authCall(`/v1/workspaces/${encodeURIComponent(workspace.id)}/${form.get("action")}`, "POST", {});
                await refresh();
              });
            }}
          >
            <h3>空间删除生命周期</h3>
            <p>当前：{workspace.status}。请求删除后业务操作暂停；完成删除不会改写历史审计。</p>
            <label>
              操作
              <select name="action">
                {workspace.status === "ACTIVE" ? (
                  <option value="request-deletion">请求删除</option>
                ) : (
                  <>
                    <option value="cancel-deletion">取消删除</option>
                    <option value="complete-deletion">完成删除</option>
                  </>
                )}
              </select>
            </label>
            <label>
              输入空间名称确认
              <input name="confirmation" required autoComplete="off" />
            </label>
            <button className="button danger" disabled={busy}>
              确认执行
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}
