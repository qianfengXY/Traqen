import { randomUUID } from "node:crypto";
import { AccountService } from "./accounts.js";
import { demand } from "./errors.js";
import { token, digest } from "./crypto.js";
import { publicAccount, audit, notify, sessionIn, validText } from "./core.js";
export const grantKey = (workspaceId, accountId, source = "DIRECT") => `${workspaceId}:${accountId}:${source}`;
export function rolesIn(s, accountId, workspaceId) {
  const account = s.accounts[accountId];
  if (account?.status !== "ACTIVE") return [];
  return [
    ...new Set(
      Object.values(s.grants)
        .filter(
          (g) => g.accountId === accountId && g.workspaceId === workspaceId && (g.source !== "ADMIN" || account.admin),
        )
        .flatMap((g) => g.roles),
    ),
  ];
}
export function actorIn(s, raw, now, options = {}) {
  if (raw?.startsWith("tp_")) {
    const program = s.programs[digest(raw)],
      account = s.accounts[program?.accountId];
    demand(s.control.initialized && !s.control.recovery, "AUTH_RECOVERY_REQUIRED", "实例尚未开放访问", 503);
    demand(
      program && !program.revoked && now < program.expiresAt && account?.status === "ACTIVE",
      "AUTH_PROGRAM_INVALID",
      "程序凭据已失效",
      401,
    );
    return { account, program };
  }
  return sessionIn(s, raw, now, options);
}
export function spaceAccess(s, actor, workspaceId, operation) {
  const space = s.spaces[workspaceId],
    roles = rolesIn(s, actor.account.id, workspaceId);
  const admin = actor.account.admin && !!actor.account.totp;
  const manager = roles.includes("OWNER") || roles.includes("PERMISSION_ADMIN") || admin;
  const allowed =
    operation === "MANAGE"
      ? manager
      : operation === "OWNER"
        ? roles.includes("OWNER") || admin
        : operation === "MAINTAIN"
          ? roles.some((r) => ["OWNER", "MAINTAIN"].includes(r))
          : operation === "READ"
            ? roles.some((r) => ["OWNER", "MAINTAIN", "READ"].includes(r))
            : roles.includes(operation);
  demand(space && space.status !== "DELETED", "AUTH_SPACE_UNAVAILABLE", "无法访问此空间", 404);
  demand(space.visibility !== "SECRET" || roles.length || admin, "AUTH_SPACE_UNAVAILABLE", "无法访问此空间", 404);
  demand(allowed, "AUTH_FORBIDDEN", "没有执行此操作的空间权限", 403, {
    workspaceId,
    discoverable: space.visibility !== "SECRET",
  });
  if (actor.program)
    demand(
      ["READ", "MAINTAIN"].includes(operation) &&
        actor.program.operations.includes(operation) &&
        actor.program.workspaceIds.includes(workspaceId),
      "AUTH_FORBIDDEN",
      "程序调用不在授权范围内",
    );
  if (!["MANAGE", "OWNER"].includes(operation))
    demand(space.status === "ACTIVE", "AUTH_SPACE_INACTIVE", "空间已暂停或删除", 409);
  return { space, roles, manager, owner: roles.includes("OWNER"), admin };
}
export class SpaceService extends AccountService {
  roleSet(roles) {
    demand(
      Array.isArray(roles) &&
        roles.every((r) => ["READ", "MAINTAIN", "PERMISSION_ADMIN", ...this.policy.reviewRoles].includes(r)),
      "AUTH_INVALID_ROLE",
      "角色无效",
      400,
    );
    const set = [...new Set(roles)];
    demand(
      !(
        set.some((r) => this.policy.businessRoles.includes(r)) &&
        set.some((r) => this.policy.complianceRoles.includes(r))
      ),
      "AUTH_ROLE_CONFLICT",
      "业务组与合规组角色不能兼任",
      409,
    );
    return set;
  }
  async authorize(raw, workspaceId, operation, tx = null) {
    const s = await this.repository.read(tx ?? this.repository.database),
      actor = actorIn(s, raw, this.clock());
    return { ...spaceAccess(s, actor, workspaceId, operation), accountId: actor.account.id };
  }
  async authorizeActor(actorId, workspaceId, operation, tx) {
    // Workers carry only server-persisted principals, never an HTTP supplied account.
    if (tx) await tx.query("SELECT singleton FROM auth_control WHERE singleton FOR UPDATE");
    const s = await this.repository.read(tx),
      binding = s.bindings[actorId];
    const account = s.accounts[binding?.accountId ?? actorId];
    demand(account?.status === "ACTIVE" && !s.control.recovery, "AUTH_FORBIDDEN", "发起账号已停用或恢复尚未完成");
    if (account.kind === "PROGRAM")
      demand(
        Object.values(s.programs).some(
          (p) =>
            p.accountId === account.id &&
            !p.revoked &&
            this.clock() < p.expiresAt &&
            p.workspaceIds.includes(workspaceId) &&
            p.operations.includes(operation),
        ),
        "AUTH_FORBIDDEN",
        "程序身份的空间或操作范围已失效",
      );
    return spaceAccess(s, { account }, workspaceId, operation);
  }
  async principal(s, tx, accountId, tenantId) {
    let binding = Object.values(s.bindings).find((b) => b.accountId === accountId && b.tenantId === tenantId);
    if (binding) return binding.principalId;
    const id = `AUTH-${accountId}-${digest(tenantId).slice(0, 12)}`;
    const account = s.accounts[accountId];
    await tx.query(
      "INSERT INTO principal(id,tenant_id,principal_type,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, tenantId, account.kind === "PROGRAM" ? "SERVICE_ACCOUNT" : "USER", account.displayName],
    );
    binding = { principalId: id, accountId, tenantId };
    s.bindings[id] = binding;
    return id;
  }
  async listSpaces(raw, { all = false } = {}) {
    const s = await this.repository.read(),
      actor = actorIn(s, raw, this.clock());
    if (all) demand(actor.account.admin && !actor.program, "AUTH_ADMIN_REQUIRED", "需要系统管理员资格");
    return Object.values(s.spaces)
      .filter(
        (space) =>
          space.status !== "DELETED" &&
          (!actor.program ||
            (actor.program.workspaceIds.includes(space.id) && actor.program.operations.includes("READ"))) &&
          (all || rolesIn(s, actor.account.id, space.id).some((r) => ["OWNER", "MAINTAIN", "READ"].includes(r))),
      )
      .map((space) => ({
        ...space,
        roles: rolesIn(s, actor.account.id, space.id),
        ownerName: s.accounts[space.ownerId]?.displayName ?? "",
        memberCount: new Set(
          Object.values(s.grants)
            .filter((g) => g.workspaceId === space.id && g.roles.length)
            .map((g) => g.accountId),
        ).size,
        pendingCount: Object.values(s.applications).filter((a) => a.workspaceId === space.id && a.status === "PENDING")
          .length,
      }));
  }
  async directory(raw, entry = null) {
    const s = await this.repository.read();
    sessionIn(s, raw, this.clock());
    return Object.values(s.spaces)
      .filter(
        (space) =>
          space.status === "ACTIVE" &&
          (space.visibility === "DISCOVERABLE" || (entry && space.entryDigest === digest(entry))),
      )
      .map((space) => ({ id: space.id, name: space.name, ownerName: s.accounts[space.ownerId]?.displayName ?? "" }));
  }
  async apply(raw, input) {
    const target = input.kind === "CREATE" ? null : input.workspaceId;
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock());
      validText(input.operationId, 128);
      const prior = Object.values(s.applications).find(
        (a) => a.accountId === account.id && a.operationId === input.operationId,
      );
      if (prior) return prior;
      demand(["CREATE", "JOIN"].includes(input.kind), "AUTH_INVALID_APPLICATION", "申请类型无效", 400);
      if (input.kind === "CREATE")
        demand(
          !Object.values(s.spaces).some(
            (space) => space.tenantId === "TRAQEN-INSTANCE" && space.name === String(input.name ?? "").trim(),
          ),
          "AUTH_SPACE_NAME_EXISTS",
          "空间名称已被使用，请换一个名称",
          409,
        );
      if (input.kind === "JOIN") {
        const space = s.spaces[target];
        demand(
          space?.status === "ACTIVE" &&
            (space.visibility === "DISCOVERABLE" || (input.entry && space.entryDigest === digest(input.entry))),
          "AUTH_SPACE_UNAVAILABLE",
          "无法访问此空间",
          404,
        );
        this.roleSet(input.roles);
        demand(input.roles.length > 0, "AUTH_INVALID_ROLE", "请选择申请角色", 400);
      }
      const duplicate = Object.values(s.applications).find(
        (a) =>
          a.accountId === account.id &&
          a.status === "PENDING" &&
          a.kind === input.kind &&
          (input.kind === "CREATE" ? a.name === input.name : a.workspaceId === target),
      );
      if (duplicate) return duplicate;
      const id = randomUUID(),
        record = {
          id,
          accountId: account.id,
          kind: input.kind,
          workspaceId: target,
          name: input.kind === "CREATE" ? validText(input.name, 160) : undefined,
          reason: validText(input.reason, 2000),
          requestedRoles: input.kind === "JOIN" ? this.roleSet(input.roles) : [],
          operationId: input.operationId,
          status: "PENDING",
          version: 1,
          createdAt: this.clock(),
        };
      s.applications[id] = record;
      audit(s, account.id, "APPLICATION_SUBMITTED", { workspaceId: target, applicationId: id });
      for (const manager of this.approvers(s, record))
        notify(s, manager, "APPLICATION_PENDING", { applicationId: id, workspaceId: target });
      return record;
    }, target);
  }
  approvers(s, application) {
    if (application.kind === "CREATE")
      return Object.values(s.accounts)
        .filter((a) => a.admin && a.status === "ACTIVE")
        .map((a) => a.id);
    const managers = Object.values(s.accounts)
      .filter(
        (a) =>
          a.status === "ACTIVE" &&
          rolesIn(s, a.id, application.workspaceId).some((r) => ["OWNER", "PERMISSION_ADMIN"].includes(r)),
      )
      .map((a) => a.id);
    return managers.length
      ? managers
      : Object.values(s.accounts)
          .filter((a) => a.admin && a.status === "ACTIVE")
          .map((a) => a.id);
  }
  async applications(raw, { pending = false, workspaceId = null } = {}) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    return Object.values(s.applications)
      .filter((a) => {
        if (workspaceId && a.workspaceId !== workspaceId) return false;
        if (!pending) return a.accountId === account.id;
        if (a.status !== "PENDING") return false;
        return account.admin || this.approvers(s, a).includes(account.id);
      })
      .map((a) => ({
        ...a,
        requesterName: s.accounts[a.accountId]?.displayName ?? a.accountId,
        spaceName: s.spaces[a.workspaceId]?.name ?? a.name ?? "",
        ...(a.decidedBy ? { decisionName: s.accounts[a.decidedBy]?.displayName ?? a.decidedBy } : {}),
      }));
  }
  async withdraw(raw, id) {
    const snapshot = await this.repository.read();
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock()),
        a = s.applications[id];
      demand(a?.accountId === account.id, "AUTH_FORBIDDEN", "只能撤回自己的申请");
      if (a.status === "WITHDRAWN") return a;
      demand(a.status === "PENDING", "AUTH_APPLICATION_DECIDED", "申请已处理", 409);
      a.status = "WITHDRAWN";
      a.version++;
      audit(s, account.id, "APPLICATION_WITHDRAWN", { applicationId: id, workspaceId: a.workspaceId });
      return a;
    }, snapshot.applications[id]?.workspaceId);
  }
  async decide(raw, id, { approve, roles, reason = "", version }) {
    const snapshot = await this.repository.read();
    return this.repository.change(async (s, tx) => {
      const { account } = sessionIn(s, raw, this.clock()),
        a = s.applications[id];
      demand(a, "AUTH_APPLICATION_NOT_FOUND", "申请不存在", 404);
      if (a.kind === "CREATE") sessionIn(s, raw, this.clock(), { admin: true });
      else spaceAccess(s, { account }, a.workspaceId, "MANAGE");
      // Returning an already committed result never re-applies grants after revocation.
      if (a.status !== "PENDING") return a;
      demand(a.version === version, "AUTH_APPLICATION_CHANGED", "申请版本已变化", 409);
      demand(s.accounts[a.accountId]?.status === "ACTIVE", "AUTH_ACCOUNT_DISABLED", "申请账号已停用", 409);
      demand(typeof approve === "boolean", "AUTH_INVALID_INPUT", "请选择审批结果", 400);
      let granted = [],
        source = "APPLICATION";
      if (approve) {
        if (a.kind === "CREATE") {
          const workspaceId = randomUUID(),
            tenantId = "TRAQEN-INSTANCE",
            organizationId = "TRAQEN";
          demand(
            !(await tx.query("SELECT id FROM project WHERE tenant_id=$1 AND name=$2", [tenantId, a.name])).rows.length,
            "AUTH_SPACE_NAME_EXISTS",
            "空间名称已被使用，请撤回后使用其他名称重新申请",
            409,
          );
          await tx.query("INSERT INTO organization(id,name) VALUES($1,'Traqen') ON CONFLICT DO NOTHING", [
            organizationId,
          ]);
          await tx.query("INSERT INTO tenant(id,organization_id,name) VALUES($1,$2,'Traqen') ON CONFLICT DO NOTHING", [
            tenantId,
            organizationId,
          ]);
          await tx.query("INSERT INTO project(id,tenant_id,name) VALUES($1,$2,$3)", [workspaceId, tenantId, a.name]);
          await this.principal(s, tx, a.accountId, tenantId);
          await tx.query("INSERT INTO source_truth_workspace(workspace_id,tenant_id) VALUES($1,$2)", [
            workspaceId,
            tenantId,
          ]);
          s.spaces[workspaceId] = {
            id: workspaceId,
            workspaceId,
            tenantId,
            name: a.name,
            ownerId: a.accountId,
            visibility: "DISCOVERABLE",
            status: "ACTIVE",
          };
          a.workspaceId = workspaceId;
          granted = ["OWNER"];
        } else {
          const access = spaceAccess(s, { account }, a.workspaceId, "MANAGE");
          if (account.id === a.accountId && access.admin && !access.owner) source = "ADMIN";
          demand(access.space.status === "ACTIVE", "AUTH_SPACE_INACTIVE", "空间已暂停，暂不能批准新权限", 409);
          demand(
            !(account.id === a.accountId && !access.owner && !access.admin),
            "AUTH_SELF_ESCALATION",
            "权限管理员不能处理自己的角色变更",
          );
          granted = this.roleSet(roles ?? a.requestedRoles);
          demand(
            granted.every(
              (r) => a.requestedRoles.includes(r) || (r === "READ" && a.requestedRoles.includes("MAINTAIN")),
            ),
            "AUTH_INVALID_ROLE",
            "审批只能授予申请角色或降级权限",
            400,
          );
          if (!access.owner && !access.admin)
            demand(
              !granted.includes("PERMISSION_ADMIN") &&
                !rolesIn(s, a.accountId, a.workspaceId).some((r) => ["OWNER", "PERMISSION_ADMIN"].includes(r)),
              "AUTH_SELF_ESCALATION",
              "管理者的角色变更需要 Owner 或系统管理员",
            );
          const existing = rolesIn(s, a.accountId, a.workspaceId).filter((r) => !["OWNER"].includes(r));
          this.roleSet([...existing, ...granted]);
          await this.principal(s, tx, a.accountId, s.spaces[a.workspaceId].tenantId);
        }
        const key = grantKey(a.workspaceId, a.accountId, source);
        const old = s.grants[key];
        s.grants[key] = {
          workspaceId: a.workspaceId,
          accountId: a.accountId,
          roles: [...new Set([...(old?.roles ?? []), ...granted])],
          source,
          grantedBy: account.id,
          version: (old?.version ?? 0) + 1,
          createdAt: this.clock(),
        };
        if (source === "ADMIN")
          for (const member of Object.values(s.accounts))
            if (rolesIn(s, member.id, a.workspaceId).some((role) => ["OWNER", "PERMISSION_ADMIN"].includes(role)))
              notify(s, member.id, "ADMIN_INTERVENTION", {
                workspaceId: a.workspaceId,
                targetName: account.displayName,
                roles: granted,
              });
      } else validText(reason, 2000);
      Object.assign(a, {
        status: approve ? "APPROVED" : "REJECTED",
        actualRoles: granted,
        decisionReason: reason,
        decidedBy: account.id,
        decidedAt: this.clock(),
        version: a.version + 1,
      });
      audit(s, account.id, "APPLICATION_DECIDED", {
        workspaceId: a.workspaceId,
        applicationId: id,
        approve,
        actualRoles: granted,
        source,
      });
      notify(s, a.accountId, "APPLICATION_DECIDED", { applicationId: id, status: a.status, actualRoles: granted });
      return a;
    }, snapshot.applications[id]?.workspaceId);
  }
  async grant(raw, workspaceId, { accountId, roles, source = "DIRECT" }) {
    return this.repository.change(async (s, tx) => {
      const { account } = sessionIn(s, raw, this.clock()),
        access = spaceAccess(s, { account }, workspaceId, "MANAGE");
      demand(
        source === "DIRECT" || (source === "ADMIN" && account.admin && account.id === accountId),
        "AUTH_INVALID_INPUT",
        "授权来源由服务端确定",
        400,
      );
      if (account.id === accountId && access.admin && !access.owner) source = "ADMIN";
      demand(s.accounts[accountId]?.status === "ACTIVE", "AUTH_ACCOUNT_NOT_FOUND", "请选择有效账号", 404);
      const granted = this.roleSet(roles),
        prior = rolesIn(s, accountId, workspaceId);
      if (!access.owner && !access.admin) {
        demand(
          accountId !== account.id &&
            !granted.includes("PERMISSION_ADMIN") &&
            !prior.includes("PERMISSION_ADMIN") &&
            !prior.includes("OWNER"),
          "AUTH_SELF_ESCALATION",
          "此角色变更需要 Owner 或系统管理员",
        );
      }
      // Owner remains singular and changes only through accepted transfer.
      for (const g of Object.values(s.grants))
        if (
          g.workspaceId === workspaceId &&
          g.accountId === accountId &&
          (source === "ADMIN" ? g.source === "ADMIN" : true)
        ) {
          const retained = g.roles.filter((role) => role === "OWNER");
          if (retained.length !== g.roles.length) {
            g.roles = retained;
            g.version = (g.version ?? 0) + 1;
          }
        }
      const independent = Object.values(s.grants)
        .filter((g) => g.workspaceId === workspaceId && g.accountId === accountId && g.roles.length)
        .flatMap((g) => g.roles)
        .filter((r) => r !== "OWNER");
      this.roleSet([...independent, ...granted]);
      await this.principal(s, tx, accountId, access.space.tenantId);
      const key = grantKey(workspaceId, accountId, source);
      s.grants[key] = {
        workspaceId,
        accountId,
        roles: granted,
        source,
        grantedBy: account.id,
        createdAt: this.clock(),
        version: (s.grants[key]?.version ?? 0) + 1,
      };
      audit(s, account.id, "GRANT_CHANGED", { workspaceId, target: accountId, roles: granted, source });
      notify(s, accountId, "GRANT_CHANGED", { workspaceId, roles: granted });
      for (const member of Object.values(s.accounts))
        if (
          member.id !== accountId &&
          rolesIn(s, member.id, workspaceId).some((role) =>
            ["OWNER", "READ", "MAINTAIN", "PERMISSION_ADMIN"].includes(role),
          )
        )
          notify(s, member.id, source === "ADMIN" ? "ADMIN_INTERVENTION" : "ROLE_CHANGED", {
            workspaceId,
            targetName: s.accounts[accountId].displayName,
            roles: granted,
          });
      return { accountId, roles: rolesIn(s, accountId, workspaceId) };
    }, workspaceId);
  }
  async intervene(raw, workspaceId, roles) {
    const s = await this.repository.read();
    sessionIn(s, raw, this.clock(), { admin: true });
    return this.grant(raw, workspaceId, {
      accountId: sessionIn(s, raw, this.clock()).account.id,
      roles,
      source: "ADMIN",
    });
  }
  async members(raw, workspaceId) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    spaceAccess(s, { account }, workspaceId, "MANAGE");
    return Object.values(s.accounts)
      .filter((a) => rolesIn(s, a.id, workspaceId).length)
      .map((a) => ({
        ...publicAccount(a),
        roles: rolesIn(s, a.id, workspaceId),
        grants: Object.values(s.grants)
          .filter((g) => g.workspaceId === workspaceId && g.accountId === a.id && g.roles.length)
          .map((grant) => ({ ...grant, grantedByName: s.accounts[grant.grantedBy]?.displayName ?? grant.grantedBy })),
      }));
  }
  async spaceSettings(raw, workspaceId, input) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock()),
        { space } = spaceAccess(s, { account }, workspaceId, "OWNER");
      demand(
        Object.keys(input).every((k) => ["visibility"].includes(k)),
        "AUTH_INVALID_INPUT",
        "不支持的空间设置",
        400,
      );
      demand(["SECRET", "DISCOVERABLE"].includes(input.visibility), "AUTH_INVALID_INPUT", "可见性无效", 400);
      space.visibility = input.visibility;
      audit(s, account.id, "SPACE_VISIBILITY_CHANGED", { workspaceId, visibility: space.visibility });
      return space;
    }, workspaceId);
  }
  async applicationEntry(raw, workspaceId) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock()),
        { space } = spaceAccess(s, { account }, workspaceId, "MANAGE");
      const entry = token();
      space.entryDigest = digest(entry);
      audit(s, account.id, "APPLICATION_ENTRY_CREATED", { workspaceId });
      return { entry };
    }, workspaceId);
  }
  async transfer(raw, workspaceId, targetId, { confirm = false } = {}) {
    return this.repository.change(async (s, tx) => {
      const { account } = sessionIn(s, raw, this.clock()),
        space = s.spaces[workspaceId];
      demand(space && space.status === "ACTIVE", "AUTH_SPACE_UNAVAILABLE", "无法访问此空间", 404);
      if (confirm) {
        demand(space.pendingOwner === account.id && account.status === "ACTIVE", "AUTH_FORBIDDEN", "需要接任者确认");
        const prior = space.ownerId;
        for (const g of Object.values(s.grants))
          if (g.workspaceId === workspaceId && g.roles.includes("OWNER"))
            g.roles = g.roles.filter((r) => r !== "OWNER");
        await this.principal(s, tx, account.id, space.tenantId);
        space.ownerId = account.id;
        delete space.pendingOwner;
        const key = grantKey(workspaceId, account.id, "OWNER");
        s.grants[key] = {
          workspaceId,
          accountId: account.id,
          roles: ["OWNER"],
          source: "DIRECT",
          grantedBy: account.id,
          version: (s.grants[key]?.version ?? 0) + 1,
          createdAt: this.clock(),
        };
        audit(s, account.id, "OWNER_TRANSFERRED", { workspaceId, priorOwner: prior });
      } else {
        spaceAccess(s, { account }, workspaceId, "OWNER");
        demand(
          s.accounts[targetId]?.status === "ACTIVE" && s.accounts[targetId].kind !== "PROGRAM",
          "AUTH_INVALID_OWNER",
          "接任者必须为有效人员账号",
          400,
        );
        space.pendingOwner = targetId;
        notify(s, targetId, "OWNER_TRANSFER_REQUESTED", { workspaceId });
      }
      return space;
    }, workspaceId);
  }
  async designateOwner(raw, workspaceId, targetId) {
    return this.repository.change(async (s, tx) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true }),
        space = s.spaces[workspaceId];
      demand(
        space && s.accounts[targetId]?.status === "ACTIVE" && s.accounts[targetId].kind !== "PROGRAM",
        "AUTH_INVALID_OWNER",
        "空间或接任者无效",
        400,
      );
      await this.principal(s, tx, targetId, space.tenantId);
      for (const g of Object.values(s.grants))
        if (g.workspaceId === workspaceId) g.roles = g.roles.filter((r) => r !== "OWNER");
      space.ownerId = targetId;
      delete space.pendingOwner;
      s.grants[grantKey(workspaceId, targetId, "OWNER")] = {
        workspaceId,
        accountId: targetId,
        roles: ["OWNER"],
        source: "DIRECT",
        grantedBy: account.id,
        version: 1,
        createdAt: this.clock(),
      };
      audit(s, account.id, "OWNER_DESIGNATED", { workspaceId, target: targetId });
      return space;
    }, workspaceId);
  }
}
