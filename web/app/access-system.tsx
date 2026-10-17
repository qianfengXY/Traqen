"use client";
import { useState } from "react";
import { authCall, openAccess, type Person } from "./auth-client";
import { type AccessContext, type RunAction, statusLabel } from "./access-types";
export type Program = {
  id: string;
  accountId: string;
  operations: string[];
  workspaceIds: string[];
  expiresAt: number;
  revoked: boolean;
  expired?: boolean;
  account: Person;
};
export function Personnel({
  accounts,
  run,
  busy,
  refresh,
  admins = false,
}: {
  accounts: Person[];
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
  admins?: boolean;
}) {
  const [selected, setSelected] = useState<Person | null>(null),
    [credential, setCredential] = useState("");
  const showCredential = (raw: string) => setCredential(`${location.origin}/#credential=${encodeURIComponent(raw)}`);
  return (
    <>
      <div className="f008-grid">
        <section className="panel">
          <h2>{admins ? "系统管理员" : "人员账号"}</h2>
          <p>账号开通不附带空间权限；新系统管理员完成两步验证后才生效。</p>
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>状态</th>
                <th>资格</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts
                .filter((person) => person.kind === "HUMAN" && (!admins || person.admin || person.adminPending))
                .map((person) => (
                  <tr key={person.id}>
                    <td>
                      {person.displayName}
                      <small>{person.login}</small>
                    </td>
                    <td>{statusLabel(person.status)}</td>
                    <td>
                      {person.admin ? "系统管理员" : person.adminPending ? "待绑定两步验证" : "普通成员"}
                      {person.globalConfig && <small>全局配置</small>}
                    </td>
                    <td>
                      <button className="button" onClick={() => setSelected(person)}>
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        <aside className="panel">
          <h2>开通人员账号</h2>
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const result = await authCall<{ account: Person; credential: string }>("/v1/admin/accounts", "POST", {
                  login: form.get("login"),
                  displayName: form.get("displayName"),
                });
                showCredential(result.credential);
                await refresh();
              });
            }}
          >
            <label>
              姓名
              <input name="displayName" maxLength={120} required />
            </label>
            <label>
              登录名
              <input name="login" minLength={2} maxLength={120} required />
            </label>
            <button className="button primary" disabled={busy}>
              开通账号
            </button>
            <p>设置密码链接 24 小时内单次有效，请通过可信渠道交给本人。</p>
          </form>
        </aside>
      </div>
      {selected && (
        <section className="panel">
          <h2>管理 {selected.displayName}</h2>
          <form
            key={`${selected.id}:${selected.status}:${selected.admin}`}
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const updated = await authCall<Person>(`/v1/admin/accounts/${selected.id}`, "PATCH", {
                  ...(form.get("status") ? { status: form.get("status") } : {}),
                  admin: form.get("admin") === "on",
                  globalConfig: form.get("globalConfig") === "on",
                });
                setSelected(updated);
                await refresh();
              });
            }}
          >
            {selected.status !== "PENDING" && (
              <label>
                账号状态
                <select name="status" defaultValue={selected.status}>
                  <option value="ACTIVE">有效</option>
                  <option value="DISABLED">停用</option>
                </select>
              </label>
            )}
            <label className="check">
              <input name="admin" type="checkbox" defaultChecked={selected.admin || selected.adminPending} />
              系统管理员
            </label>
            <label className="check">
              <input name="globalConfig" type="checkbox" defaultChecked={selected.globalConfig} />
              全局配置资格
            </label>
            <p>最后一位有效系统管理员不能被移除或停用。所有任免与恢复操作记录审计，并通知其他系统管理员。</p>
            <button className="button primary" disabled={busy}>
              保存账号与资格
            </button>
          </form>
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const result = await authCall<{ credential: string }>(
                  `/v1/admin/accounts/${selected.id}/recover`,
                  "POST",
                  { resetTotp: form.get("resetTotp") === "on" },
                );
                showCredential(result.credential);
                await refresh();
              });
            }}
          >
            <h3>账号恢复</h3>
            <label className="check">
              <input name="resetTotp" type="checkbox" />
              同时重置两步验证
            </label>
            <p>恢复链接 15 分钟内单次有效，原会话和旧恢复凭据将撤销。</p>
            <button className="button danger" disabled={busy}>
              生成恢复链接
            </button>
          </form>
          <button className="button" onClick={() => setSelected(null)}>
            完成
          </button>
        </section>
      )}
      {credential && (
        <section className="panel" role="status">
          <h2>一次性凭据 · 请立即交付本人</h2>
          <p>仅本页内存显示，不会写入通知或审计。关闭后无法再次查看。</p>
          <pre className="f008-secret">{credential}</pre>
          <div className="actions">
            <button className="button" onClick={() => void navigator.clipboard.writeText(credential)}>
              复制链接
            </button>
            <button className="button" onClick={() => setCredential("")}>
              我已交付，隐藏凭据
            </button>
          </div>
        </section>
      )}
    </>
  );
}
export function Programs({
  programs,
  context,
  run,
  busy,
  refresh,
}: {
  programs: Program[];
  context: AccessContext;
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [secret, setSecret] = useState("");
  return (
    <>
      <div className="f008-grid">
        <section className="panel">
          <h2>程序身份</h2>
          <p>CI、Runner 和自动化使用独立身份。创建后还需由空间管理者授予对应空间角色；不允许程序执行业务批准。</p>
          <table>
            <thead>
              <tr>
                <th>身份</th>
                <th>操作范围</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id}>
                  <td>
                    {program.account.displayName}
                    <small>到期：{new Date(program.expiresAt).toLocaleString()}</small>
                  </td>
                  <td>
                    {program.operations.join("、")}
                    <small>
                      {program.workspaceIds
                        .map((id) => context.spaces.find((space) => space.id === id)?.name ?? id)
                        .join("、")}
                    </small>
                  </td>
                  <td>{program.revoked ? "已撤销" : program.expired ? "已到期" : "有效"}</td>
                  <td className="actions">
                    <button
                      className="button"
                      disabled={busy || program.revoked}
                      onClick={() =>
                        void run(async () => {
                          const result = await authCall<{ credential: string }>(
                            `/v1/admin/programs/${program.accountId}/rotate`,
                            "POST",
                            {},
                          );
                          setSecret(result.credential);
                          await refresh();
                        })
                      }
                    >
                      轮换凭据
                    </button>
                    <button
                      className="button danger"
                      disabled={busy || program.revoked}
                      onClick={() =>
                        void run(async () => {
                          await authCall(`/v1/admin/programs/${program.accountId}/revoke`, "POST", {});
                          await refresh();
                        })
                      }
                    >
                      撤销身份
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="panel">
          <h2>创建程序身份</h2>
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const result = await authCall<{ credential: string }>("/v1/admin/programs", "POST", {
                  displayName: form.get("name"),
                  operations: form.getAll("operations"),
                  workspaceIds: form.getAll("spaces"),
                  expiresAt: new Date(String(form.get("expiresAt"))).getTime(),
                });
                setSecret(result.credential);
                await refresh();
              });
            }}
          >
            <label>
              名称
              <input name="name" required />
            </label>
            <label>
              空间
              <select name="spaces" multiple required>
                {context.spaces.map((space) => (
                  <option value={space.id} key={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input name="operations" value="READ" type="checkbox" defaultChecked />
              读取
            </label>
            <label className="check">
              <input name="operations" value="MAINTAIN" type="checkbox" />
              维护
            </label>
            <label>
              到期时间
              <input name="expiresAt" type="datetime-local" required />
            </label>
            <button className="button primary" disabled={busy}>
              创建凭据
            </button>
          </form>
        </aside>
      </div>
      {secret && (
        <section className="panel">
          <h2>程序凭据 · 仅显示一次</h2>
          <pre className="f008-secret">{secret}</pre>
          <button className="button" onClick={() => void navigator.clipboard.writeText(secret)}>
            复制凭据
          </button>
          <button className="button" onClick={() => setSecret("")}>
            隐藏
          </button>
        </section>
      )}
    </>
  );
}
