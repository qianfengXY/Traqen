"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authCall, openAccess, type Person } from "./auth-client";
import { errorText, useIdentity } from "./auth-session";
import { type AccessContext, type AccessApplication, type AccessSpace, type Member, roleLabel } from "./access-types";
import { ApplicationForm, Applications } from "./access-applications";
import { Members, SpaceInformation } from "./access-members";
import { Personnel, Programs, type Program } from "./access-system";
import { Security, type Device } from "./access-security";
const titles: Record<string, string> = {
  spaces: "我的空间",
  management: "我管理的空间",
  directory: "可申请空间",
  applications: "我的申请",
  create: "申请创建空间",
  join: "申请加入空间",
  pending: "待审批",
  members: "成员与权限",
  info: "空间信息",
  audit: "介入与授权记录",
  all: "全部空间",
  accounts: "人员账号",
  admins: "系统管理员",
  programs: "程序身份",
  security: "账号安全",
};
const emptyContext: AccessContext = { spaces: [], reviewRoles: [], canAdmin: false, canGlobalConfig: false };
export function AccessCenter({
  view,
  workspaceId,
  onWorkspace,
}: {
  view: string;
  workspaceId?: string;
  onWorkspace: (id: string) => void;
}) {
  const { session } = useIdentity();
  const [context, setContext] = useState(emptyContext),
    [spaces, setSpaces] = useState<AccessSpace[]>([]),
    [applications, setApplications] = useState<AccessApplication[]>([]),
    [accounts, setAccounts] = useState<Person[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [devices, setDevices] = useState<Device[]>([]),
    [programs, setPrograms] = useState<Program[]>([]),
    [events, setEvents] = useState<
      Array<{ sequence: string; event_type: string; actor_id: string; created_at: string; payload: unknown }>
    >([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState(""),
    [join, setJoin] = useState<string | undefined>(workspaceId);
  const request = useRef(0),
    mutating = useRef(false),
    loadedScope = useRef("");
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(loadedScope.current !== `${view}:${workspaceId ?? ""}`);
    setLoadError("");
    setError("");
    try {
      const current = await authCall<AccessContext>("/v1/access/context");
      if (version !== request.current) return;
      setContext(current);
      if (["directory", "join"].includes(view)) {
        const entry = new URLSearchParams(location.search).get("entry");
        const r = await authCall<{ spaces: AccessSpace[] }>(
          `/v1/access/directory${entry ? "?entry=" + encodeURIComponent(entry) : ""}`,
        );
        if (version === request.current) setSpaces(r.spaces);
      } else if (view === "management") {
        setSpaces(current.spaces.filter((space) => space.canManage));
      } else if (view === "all" || view === "spaces") {
        const r = await authCall<{ spaces: AccessSpace[] }>(`/v1/access/spaces${view === "all" ? "?all=true" : ""}`);
        if (version === request.current) setSpaces(r.spaces);
      } else if (["applications", "pending"].includes(view)) {
        const params = new URLSearchParams();
        if (view === "pending") params.set("pending", "true");
        if (view === "pending" && workspaceId) params.set("workspaceId", workspaceId);
        const r = await authCall<{ applications: AccessApplication[] }>(`/v1/access/applications?${params}`);
        if (version === request.current) setApplications(r.applications);
      } else if (["accounts", "admins"].includes(view)) {
        const r = await authCall<{ accounts: Person[] }>("/v1/admin/accounts");
        if (version === request.current) setAccounts(r.accounts);
      } else if (view === "programs") {
        const r = await authCall<{ programs: Program[] }>("/v1/admin/programs");
        if (version === request.current) setPrograms(r.programs);
      } else if (view === "security") {
        const r = await authCall<{ sessions: Device[] }>("/v1/auth/sessions");
        if (version === request.current) setDevices(r.sessions);
      } else if (workspaceId && view === "members") {
        const r = await authCall<{ members: Member[] }>(`/v1/access/spaces/${encodeURIComponent(workspaceId)}/members`);
        if (version === request.current) setMembers(r.members);
      } else if (workspaceId && view === "audit") {
        const r = await authCall<{ events: typeof events }>(
          `/v1/access/spaces/${encodeURIComponent(workspaceId)}/audit`,
        );
        if (version === request.current) setEvents(r.events);
      }
    } catch (e) {
      if (version === request.current) setLoadError(errorText(e));
    } finally {
      if (version === request.current) {
        loadedScope.current = `${view}:${workspaceId ?? ""}`;
        setLoading(false);
      }
    }
  }, [view, workspaceId]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [reload]);
  const run = async (work: () => Promise<void>) => {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice("操作已记录，请以最新状态为准。");
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  };
  const workspace = context.spaces.find((space) => space.id === workspaceId);
  const accountTabs = [
    ["spaces", "我的空间"],
    ["directory", "可申请空间"],
    ["applications", "我的申请"],
  ] as const;
  const globalTabs = [
    ["all", "全部空间"],
    ["accounts", "人员账号"],
    ["admins", "系统管理员"],
    ["pending", "建空间审批"],
    ["programs", "程序身份"],
  ] as const;
  const spaceTabs = [
    ["members", "成员与权限"],
    ["pending", "待审批"],
    ["info", "空间信息"],
    ["audit", "介入记录"],
  ] as const;
  const managed = Boolean(workspace?.canManage || context.canAdmin),
    scope =
      ["all", "accounts", "admins", "programs"].includes(view) || (view === "pending" && !workspaceId)
        ? "global"
        : ["members", "pending", "info", "audit"].includes(view)
          ? "space"
          : "account";
  let body;
  if (loading)
    body = (
      <section className="panel" role="status">
        正在读取当前账号的权限与记录…
      </section>
    );
  else if (loadError)
    body = (
      <section className="panel">
        <h2>当前内容未能读取</h2>
        <p>{loadError}</p>
        <p>读取失败不代表没有记录；请重试后再判断。</p>
        <button className="button" disabled={busy} onClick={() => void reload()}>
          重新读取
        </button>
      </section>
    );
  else if (view === "create")
    body = (
      <section className="panel">
        <ApplicationForm context={context} onDone={reload} run={run} busy={busy} />
      </section>
    );
  else if (view === "join")
    body = (
      <section className="panel">
        {spaces.some((space) => space.id === (join ?? workspaceId)) ? (
          <ApplicationForm
            key={join ?? workspaceId}
            context={context}
            workspaceId={join ?? workspaceId}
            onDone={reload}
            run={run}
            busy={busy}
            kind="JOIN"
            entry={new URLSearchParams(location.search).get("entry") ?? undefined}
          />
        ) : (
          <p>无法访问此空间。请向空间管理者索取有效申请入口。</p>
        )}
      </section>
    );
  else if (["spaces", "directory", "all", "management"].includes(view))
    body = (
      <section className="panel">
        {spaces.length ? (
          <table>
            <thead>
              <tr>
                <th>空间</th>
                <th>Owner</th>
                {view !== "directory" && <th>当前角色</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((space) => (
                <tr key={space.id}>
                  <td>{space.name}</td>
                  <td>{space.ownerName}</td>
                  {view !== "directory" && (
                    <td>
                      {space.roles?.map(roleLabel).join("、") || "未取得业务角色"}
                      {view === "all" && (
                        <small>
                          {space.visibility === "SECRET" ? "保密" : "可发现"} · {space.memberCount} 位成员 ·{" "}
                          {space.pendingCount} 待审批
                        </small>
                      )}
                    </td>
                  )}
                  <td className="actions">
                    {view === "directory" ? (
                      <button
                        className="button primary"
                        onClick={() => {
                          setJoin(space.id);
                          openAccess("join", space.id);
                        }}
                      >
                        申请加入
                      </button>
                    ) : ["all", "management"].includes(view) ? (
                      <button className="button" onClick={() => openAccess("members", space.id)}>
                        进入管理面
                      </button>
                    ) : (
                      <button className="button primary" onClick={() => onWorkspace(space.id)}>
                        进入空间
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="f008-empty">
            <h2>{view === "spaces" ? "还没有可进入的空间" : "没有可显示的空间"}</h2>
            <p>申请创建空间或加入已有空间，获批后即可继续工作。</p>
            <div className="actions">
              <button className="button primary" onClick={() => openAccess("create")}>
                申请创建空间
              </button>
              <button className="button" onClick={() => openAccess("directory")}>
                浏览可申请空间
              </button>
              {context.canAdmin && (
                <button className="button" onClick={() => openAccess("accounts")}>
                  管理人员账号
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    );
  else if (["applications", "pending"].includes(view))
    body = (
      <Applications
        items={applications}
        context={context}
        pending={view === "pending"}
        run={run}
        busy={busy}
        refresh={reload}
        accountId={session.account.id}
      />
    );
  else if (["accounts", "admins"].includes(view))
    body = <Personnel accounts={accounts} admins={view === "admins"} run={run} busy={busy} refresh={reload} />;
  else if (view === "programs")
    body = <Programs programs={programs} context={context} run={run} busy={busy} refresh={reload} />;
  else if (view === "security") body = <Security devices={devices} run={run} busy={busy} refresh={reload} />;
  else if (!workspace || (!managed && !(view === "info" && workspace.pendingOwner)))
    body = (
      <section className="panel">
        <h2>无法访问此空间管理面</h2>
        <p>请检查当前空间与账号资格。</p>
        <button className="button" onClick={() => openAccess("spaces")}>
          返回我的空间
        </button>
      </section>
    );
  else if (view === "members")
    body = <Members workspace={workspace} members={members} context={context} run={run} busy={busy} refresh={reload} />;
  else if (view === "info")
    body = <SpaceInformation workspace={workspace} context={context} run={run} busy={busy} refresh={reload} />;
  else if (view === "audit")
    body = (
      <section className="panel">
        <h2>介入与授权变更</h2>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>操作者</th>
              <th>记录</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.sequence}>
                <td>{new Date(event.created_at).toLocaleString()}</td>
                <td>{event.event_type}</td>
                <td>{event.actor_id}</td>
                <td>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  else
    body = (
      <section className="panel">
        <h2>无法识别此管理页面</h2>
        <button className="button" onClick={() => openAccess("spaces")}>
          返回我的空间
        </button>
      </section>
    );
  return (
    <section className="f008-panel">
      <header className="f008-heading">
        <div>
          <p className="eyebrow">
            {scope === "global"
              ? "设置中心 / 全局"
              : scope === "space"
                ? `设置中心 / 当前空间 · ${workspace?.name ?? "待选择"}`
                : "当前账号"}
          </p>
          <h1>{titles[view] ?? "账号与权限"}</h1>
          <p>
            {scope === "global"
              ? "管理实例与人员身份；日常空间授权交给各空间管理者。"
              : scope === "space"
                ? "权限与状态由服务端当前记录决定。"
                : "查看自己的空间、申请与登录安全。"}
          </p>
        </div>
        <div className="actions">
          <button className="button" disabled={busy || loading} onClick={() => void reload()}>
            刷新状态
          </button>
          {view === "spaces" && (
            <button className="button primary" onClick={() => openAccess("create")}>
              申请创建空间
            </button>
          )}
        </div>
      </header>
      <nav className="f008-tabs" aria-label="账号与权限分区">
        {(scope === "global"
          ? context.canAdmin
            ? globalTabs
            : []
          : scope === "space"
            ? managed
              ? spaceTabs
              : []
            : accountTabs
        ).map(([key, label]) => (
          <button
            key={key}
            aria-current={view === key ? "page" : undefined}
            onClick={() => openAccess(key, scope === "space" ? workspaceId : undefined)}
          >
            {label}
          </button>
        ))}
        {scope === "space" && <button onClick={() => onWorkspace(workspaceId!)}>返回业务空间</button>}
      </nav>
      {error && (
        <p className="auth-notice" role="alert">
          {error}
          <button className="button" onClick={() => openAccess("security")}>
            验证身份 / 管理会话
          </button>
        </p>
      )}
      {notice && (
        <p className="f008-status" role="status">
          {notice}
        </p>
      )}
      {body}
      {["applications", "security"].includes(view) && !loading && <Notifications />}
    </section>
  );
}
function Notifications() {
  const [items, setItems] = useState<
    Array<{
      id: string;
      type: string;
      workspaceId?: string;
      targetName?: string;
      roles?: string[];
      actualRoles?: string[];
      read: boolean;
      createdAt: string;
    }>
  >([]);
  useEffect(() => {
    let active = true;
    void authCall<{ notifications: typeof items }>("/v1/me/notifications")
      .then((result) => {
        if (active) setItems(result.notifications);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const title = (type: string) =>
    ({
      APPLICATION_PENDING: "收到待审批申请",
      APPLICATION_DECIDED: "申请状态已更新",
      GRANT_CHANGED: "你的角色已变更",
      ROLE_CHANGED: "空间成员角色已变更",
      ADMIN_INTERVENTION: "系统管理员介入",
      OWNER_TRANSFER_REQUESTED: "请确认接任 Owner",
      ACCOUNT_UPDATED: "人员账号或资格已更新",
      ACCOUNT_RECOVERY: "账号恢复已发起",
    })[type] ?? type;
  return (
    <section className="panel">
      <h2>通知与角色变更</h2>
      {items.length ? (
        <ul>
          {items
            .slice()
            .reverse()
            .map((item) => (
              <li key={item.id}>
                <b>{title(item.type)}</b> · {item.targetName ?? ""}{" "}
                {(item.roles ?? item.actualRoles)?.map(roleLabel).join("、")}
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                {item.workspaceId && (
                  <button
                    className="button"
                    onClick={() =>
                      openAccess(item.type === "OWNER_TRANSFER_REQUESTED" ? "info" : "applications", item.workspaceId)
                    }
                  >
                    查看相关记录
                  </button>
                )}
              </li>
            ))}
        </ul>
      ) : (
        <p>暂无通知。</p>
      )}
      <button
        className="button"
        onClick={() =>
          void authCall("/v1/me/notifications/read", "POST", {}).then(() =>
            setItems(items.map((item) => ({ ...item, read: true }))),
          )
        }
      >
        全部标记已读
      </button>
    </section>
  );
}
export function AccountMenu() {
  const { session, logout } = useIdentity();
  const [count, setCount] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const read = () => {
      void authCall<{ notifications: Array<{ read: boolean }> }>("/v1/me/notifications")
        .then((result) => {
          if (active) setCount(result.notifications.filter((item) => !item.read).length);
        })
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <details className="f008-account-menu">
      <summary>
        {session.account.displayName} {count > 0 && <span className="tag">{count}</span>}
        <small>
          {session.account.login}
          {session.account.admin ? " · 系统管理员" : ""}
        </small>
      </summary>
      <nav aria-label="当前账号">
        <button onClick={() => openAccess("applications")}>我的申请{count > 0 ? ` · ${count}` : ""}</button>
        <button onClick={() => openAccess("security")}>登录设备、密码与两步验证</button>
        {session.account.admin && <button onClick={() => openAccess("all")}>系统管理</button>}
        <button onClick={() => void logout().catch((e) => setError(errorText(e)))}>退出此设备</button>
        {error && <p role="alert">{error}</p>}
      </nav>
    </details>
  );
}
