import { randomUUID } from "node:crypto";
import { SpaceService, rolesIn, grantKey, spaceAccess } from "./spaces.js";
import { digest, token, hashPassword } from "./crypto.js";
import { demand } from "./errors.js";
import { sessionIn, audit, publicAccount, revokeAccountSessions, validText, validLogin } from "./core.js";
import { identityContext } from "./context.js";
export class OperationsService extends SpaceService {
  async executionIdentity({ actorId, projectId, claims }) {
    const s = await this.repository.read();
    if (claims) {
      const jobs = (
        await this.repository.database.query(
          "SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='WORKSPACE_ANALYSIS_JOB' AND record_payload->>'jobId'=$2 ORDER BY created_at DESC",
          [projectId, claims.analysisRunId],
        )
      ).rows;
      const job = jobs
        .map((row) => row.record_payload)
        .sort((a, b) => (b.checkpointSequence ?? 0) - (a.checkpointSequence ?? 0))[0]?.state;
      demand(job && job.initiatorAccountId, "AUTH_PROGRAM_MAPPING_REQUIRED", "原任务尚未绑定可信发起账号", 403);
      actorId = job.initiatorAccountId;
    }
    const account = s.accounts[s.bindings[actorId]?.accountId ?? actorId];
    demand(
      account && (claims || account.kind === "PROGRAM"),
      "AUTH_PROGRAM_MAPPING_REQUIRED",
      "签名调用方需要明确映射到程序身份",
      403,
    );
    await this.authorizeActor(actorId, projectId, "MAINTAIN");
    const binding = Object.values(s.bindings).find(
      (b) => b.accountId === account.id && b.tenantId === s.spaces[projectId]?.tenantId,
    );
    demand(binding, "AUTH_PROGRAM_MAPPING_REQUIRED", "尚无目标空间的程序身份绑定", 403);
    const context = identityContext();
    demand(context, "AUTH_CONTEXT_REQUIRED", "需要服务端调用上下文", 401);
    demand(context.signed || context.program, "AUTH_PROGRAM_REQUIRED", "此入口需要程序身份或任务凭据", 403);
    if (context.signed)
      Object.assign(context, {
        actorId: binding.principalId,
        accountId: account.id,
        workspaceId: projectId,
        operation: "MAINTAIN",
      });
    else if (claims) context.workerAccountId = account.id;
    else demand(context.accountId === account.id, "AUTH_AMBIGUOUS_CREDENTIALS", "程序凭据与签名身份不一致", 400);
  }
  async accessContext(raw) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    const spaces = Object.values(s.spaces)
      .filter(
        (space) =>
          space.status !== "DELETED" &&
          (account.admin || space.pendingOwner === account.id || rolesIn(s, account.id, space.id).length),
      )
      .map((space) => ({
        ...space,
        roles: rolesIn(s, account.id, space.id),
        ownerName: s.accounts[space.ownerId]?.displayName ?? "",
        canManage:
          account.admin || rolesIn(s, account.id, space.id).some((r) => ["OWNER", "PERMISSION_ADMIN"].includes(r)),
        canOwn: account.admin || space.ownerId === account.id,
        pendingOwner: space.pendingOwner === account.id,
      }));
    return {
      spaces,
      reviewRoles: this.policy.reviewRoles,
      canAdmin: account.admin,
      canGlobalConfig: account.admin || account.globalConfig,
    };
  }
  async memberCandidates(raw, workspaceId, query) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    spaceAccess(s, { account }, workspaceId, "MANAGE");
    const term = String(query ?? "").toLowerCase();
    demand(term.length >= 2 && term.length <= 120, "AUTH_INVALID_INPUT", "请输入至少两个字符搜索账号", 400);
    return Object.values(s.accounts)
      .filter(
        (a) =>
          a.status === "ACTIVE" && (a.login.toLowerCase().includes(term) || a.displayName.toLowerCase().includes(term)),
      )
      .slice(0, 20)
      .map(publicAccount);
  }
  async createProgram(raw, { displayName, operations, workspaceIds, expiresAt }) {
    demand(
      Array.isArray(operations) &&
        operations.length &&
        operations.every((x) => ["READ", "MAINTAIN"].includes(x)) &&
        Array.isArray(workspaceIds) &&
        workspaceIds.length,
      "AUTH_INVALID_INPUT",
      "需要明确的空间与操作范围",
      400,
    );
    demand(Number.isFinite(expiresAt) && expiresAt > this.clock(), "AUTH_INVALID_INPUT", "需要未来的到期时间", 400);
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true });
      demand(
        workspaceIds.every((id) => s.spaces[id]),
        "AUTH_SPACE_UNAVAILABLE",
        "空间不可用",
        404,
      );
      const id = randomUUID(),
        credential = `tp_${token()}`;
      s.accounts[id] = {
        id,
        login: `program-${id}`,
        displayName: validText(displayName, 120),
        kind: "PROGRAM",
        status: "ACTIVE",
        admin: false,
      };
      s.programs[digest(credential)] = {
        id: digest(credential),
        accountId: id,
        operations: [...new Set(operations)],
        workspaceIds: [...new Set(workspaceIds)],
        expiresAt,
        createdAt: this.clock(),
        revoked: false,
      };
      audit(s, account.id, "PROGRAM_CREATED", { target: id, operations, workspaceIds });
      return { account: publicAccount(s.accounts[id]), credential };
    });
  }
  async rotateProgram(raw, id) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true });
      const existing = Object.values(s.programs).find((p) => p.accountId === id && !p.revoked);
      demand(existing && s.accounts[id]?.status === "ACTIVE", "AUTH_PROGRAM_INVALID", "程序身份不可用", 404);
      const credential = `tp_${token()}`;
      existing.revoked = true;
      s.programs[digest(credential)] = { ...existing, id: digest(credential), revoked: false, createdAt: this.clock() };
      audit(s, account.id, "PROGRAM_ROTATED", { target: id });
      return { credential };
    });
  }
  async revokeProgram(raw, id) {
    return this.repository.change((s) => {
      const { account } = sessionIn(s, raw, this.clock(), { admin: true, recent: true });
      const target = s.accounts[id];
      demand(target?.kind === "PROGRAM", "AUTH_PROGRAM_INVALID", "程序身份不可用", 404);
      target.status = "DISABLED";
      for (const credential of Object.values(s.programs)) if (credential.accountId === id) credential.revoked = true;
      audit(s, account.id, "PROGRAM_REVOKED", { target: id });
      return { ok: true };
    });
  }
  async listPrograms(raw) {
    const s = await this.repository.read();
    sessionIn(s, raw, this.clock(), { admin: true });
    const current = new Map();
    for (const credential of Object.values(s.programs)) {
      const prior = current.get(credential.accountId);
      if (
        !prior ||
        (prior.revoked && !credential.revoked) ||
        (prior.revoked === credential.revoked && (credential.createdAt ?? 0) >= (prior.createdAt ?? 0))
      )
        current.set(credential.accountId, credential);
    }
    return [...current.values()].map((p) => ({ ...p, expired: this.clock() >= p.expiresAt, account: publicAccount(s.accounts[p.accountId]) }));
  }
  async resolveActor(raw, workspaceId) {
    const s = await this.repository.read();
    const { actorIn } = await import("./spaces.js");
    const actor = actorIn(s, raw, this.clock());
    if (!workspaceId) return { accountId: actor.account.id, program: !!actor.program };
    const binding = Object.values(s.bindings).find(
      (b) => b.accountId === actor.account.id && b.tenantId === s.spaces[workspaceId]?.tenantId,
    );
    demand(binding, "AUTH_FORBIDDEN", "尚未获得此空间身份");
    return {
      accountId: actor.account.id,
      actorId: binding.principalId,
      tenantId: binding.tenantId,
      program: !!actor.program,
    };
  }
  async reviewer(workspaceId, raw, role) {
    const s = await this.repository.read(),
      { account } = sessionIn(s, raw, this.clock());
    demand(
      typeof role === "string" && this.policy.reviewRoles.includes(role),
      "AUTH_REVIEW_ROLE_REQUIRED",
      "请明确选择本次使用的审核角色",
      400,
    );
    spaceAccess(s, { account }, workspaceId, role);
    const actor = await this.resolveActor(raw, workspaceId);
    return { actorId: actor.actorId, actorRole: role, accountId: account.id };
  }
  async canonicalActor(actorId) {
    const s = await this.repository.read();
    const accountId = s.bindings[actorId]?.accountId ?? actorId;
    return s.accounts[accountId]?.id ?? null;
  }
  async globalAccess(raw, tx = null) {
    const s = await this.repository.read(tx ?? this.repository.database),
      { account } = sessionIn(s, raw, this.clock());
    demand(account.admin || account.globalConfig, "AUTH_GLOBAL_CONFIG_REQUIRED", "需要全局配置资格");
    return publicAccount(account);
  }
  async inventory() {
    const db = this.repository.database;
    const state = await this.repository.read();
    return {
      accounts: Object.values(state.accounts).map(publicAccount),
      grants: Object.values(state.grants),
      programs: Object.values(state.programs).map(({ accountId, operations, workspaceIds, expiresAt, revoked }) => ({
        accountId,
        operations,
        workspaceIds,
        expiresAt,
        revoked,
      })),
      principals: (await db.query("SELECT id,tenant_id,principal_type,display_name FROM principal ORDER BY id")).rows,
      spaces: (await db.query("SELECT id,tenant_id,name,status FROM project ORDER BY id")).rows,
      sourceGrants: (await db.query("SELECT * FROM source_truth_access_legacy ORDER BY workspace_id,actor_id")).rows,
      sourceTasks: (
        await db.query(
          "SELECT workspace_id,id,actor_id,status FROM source_truth_run WHERE status NOT IN ('SUCCEEDED','BLOCKED','FAILED_RETRYABLE','CANCELLED')",
        )
      ).rows,
    };
  }
  async migrate({ bindings, owners, grants, confirmed = false, requestedBy }) {
    demand(
      confirmed === true && Array.isArray(bindings) && Array.isArray(owners) && Array.isArray(grants),
      "AUTH_MIGRATION_CONFIRMATION_REQUIRED",
      "需要明确确认的身份、Owner 与授权映射",
      400,
    );
    // Lock every affected project in stable order before touching authorization records.
    const db = this.repository.database;
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM project ORDER BY id FOR UPDATE");
      return this.repository.change(async (s, inner) => {
        demand(s.control.initialized, "AUTH_NOT_INITIALIZED", "先初始化可信管理员", 409);
        for (const binding of bindings) {
          const principal = (await inner.query("SELECT * FROM principal WHERE id=$1", [binding.principalId])).rows[0];
          demand(principal && s.accounts[binding.accountId], "AUTH_MAPPING_INVALID", "映射身份不存在", 400);
          demand(
            !s.bindings[binding.principalId] || s.bindings[binding.principalId].accountId === binding.accountId,
            "AUTH_MAPPING_CONFLICT",
            "历史身份已绑定其他账号",
            409,
          );
          s.bindings[binding.principalId] = {
            principalId: binding.principalId,
            accountId: binding.accountId,
            tenantId: principal.tenant_id,
          };
        }
        for (const owner of owners) {
          const p = (await inner.query("SELECT * FROM project WHERE id=$1", [owner.workspaceId])).rows[0];
          demand(
            p && s.accounts[owner.accountId]?.status === "ACTIVE" && s.accounts[owner.accountId].kind !== "PROGRAM",
            "AUTH_MAPPING_INVALID",
            "每个空间需要有效 Owner",
            400,
          );
          demand(!s.spaces[p.id], "AUTH_MAPPING_CONFLICT", "空间已迁移，不能覆盖现行权限", 409);
          s.spaces[p.id] = {
            id: p.id,
            workspaceId: p.id,
            tenantId: p.tenant_id,
            name: p.name,
            status: p.status === "ACTIVE" ? "ACTIVE" : "DELETED",
            visibility: owner.visibility ?? "DISCOVERABLE",
            ownerId: owner.accountId,
          };
          await this.principal(s, inner, owner.accountId, p.tenant_id);
          s.grants[grantKey(p.id, owner.accountId, "OWNER")] = {
            workspaceId: p.id,
            accountId: owner.accountId,
            roles: ["OWNER"],
            source: "MIGRATION",
            version: 1,
            grantedBy: requestedBy,
          };
        }
        for (const grant of grants) {
          const space = s.spaces[grant.workspaceId];
          demand(space && s.accounts[grant.accountId], "AUTH_MAPPING_INVALID", "授权映射无效", 400);
          this.roleSet(grant.roles);
          this.roleSet([
            ...rolesIn(s, grant.accountId, grant.workspaceId).filter((r) => r !== "OWNER"),
            ...grant.roles,
          ]);
          await this.principal(s, inner, grant.accountId, space.tenantId);
          s.grants[grantKey(space.id, grant.accountId, "MIGRATION")] = {
            workspaceId: space.id,
            accountId: grant.accountId,
            roles: grant.roles,
            source: "MIGRATION",
            version: 1,
            grantedBy: requestedBy,
          };
        }
        s.control.epoch = Number(s.control.epoch) + 1;
        audit(s, requestedBy, "MIGRATION_CONFIRMED", {
          bindingCount: bindings.length,
          ownerCount: owners.length,
          grantCount: grants.length,
        });
        return { ok: true };
      });
    });
  }
  async enterRecovery({ requestedBy }) {
    return this.repository.change((s) => {
      s.control.initialized = true;
      s.control.recovery = true;
      s.control.epoch = Number(s.control.epoch) + 1;
      for (const c of Object.values(s.credentials)) c.used = true;
      for (const a of Object.values(s.accounts)) delete a.recoveryAdmin;
      audit(s, requestedBy, "RECOVERY_ENTERED");
      return { ok: true };
    });
  }
  async trustRecoveryAdmin({ accountId, login, displayName, password, requestedBy }) {
    const record = await hashPassword(password);
    return this.repository.change((s) => {
      demand(s.control.recovery, "AUTH_NOT_RECOVERING", "请先进入受限恢复状态", 409);
      if (!accountId) {
        const normalized = validLogin(login);
        demand(
          !Object.values(s.accounts).some((a) => a.login === normalized),
          "AUTH_LOGIN_EXISTS",
          "账号已存在，请使用明确的账号 ID 恢复，不能自动合并",
          409,
        );
        accountId = randomUUID();
        s.accounts[accountId] = {
          id: accountId,
          login: normalized,
          displayName: validText(displayName ?? login, 120),
          kind: "HUMAN",
          globalConfig: false,
        };
        audit(s, requestedBy, "RECOVERY_ADMIN_CREATED", { target: accountId });
      }
      const account = s.accounts[accountId];
      demand(account?.kind !== "PROGRAM" && account, "AUTH_ACCOUNT_NOT_FOUND", "需要明确的可信人员账号", 404);
      account.status = "ACTIVE";
      account.password = record;
      account.recoveryAdmin = true;
      account.admin = true;
      delete account.adminRequested;
      delete account.totp;
      revokeAccountSessions(s, accountId);
      audit(s, requestedBy, "RECOVERY_ADMIN_CONFIRMED", { target: accountId });
      return publicAccount(account);
    });
  }
  async finishRecovery({ requestedBy, confirmed = false }) {
    return this.repository.change(async (s, tx) => {
      demand(s.control.recovery && confirmed, "AUTH_RECOVERY_CONFIRMATION_REQUIRED", "需要确认已复核账号与授权", 409);
      demand(
        Object.values(s.accounts).some((a) => a.recoveryAdmin && a.admin && a.status === "ACTIVE" && a.password),
        "AUTH_RECOVERY_ADMIN_REQUIRED",
        "请先在部署终端确认可信恢复管理员并设置密码",
        409,
      );
      demand(
        !(await tx.query("SELECT 1 FROM source_truth_workspace WHERE NOT restore_ready OR backup_barrier LIMIT 1")).rows
          .length,
        "AUTH_SOURCE_RESTORE_UNVERIFIED",
        "来源完整性检查尚未通过",
        409,
      );
      s.control.recovery = false;
      for (const a of Object.values(s.accounts)) delete a.recoveryAdmin;
      audit(s, requestedBy, "RECOVERY_COMPLETED");
      return { ok: true };
    });
  }
}
