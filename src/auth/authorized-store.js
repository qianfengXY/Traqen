import { identityContext } from "./context.js";
import { demand } from "./errors.js";
import { rolesIn } from "./spaces.js";
const read = /^(get|list|find|query|has)/;
const global = /Global|CapabilityTemplate|ModelReplacement|ReverseSkill/;
export function authorizedStore(store, service, database, { bootstrap = null } = {}) {
  return new Proxy(store, {
    get(target, name) {
      const method = target[name];
      if (typeof method !== "function") return method;
      return async (...args) => {
        const identity = identityContext();
        demand(identity, "AUTH_CONTEXT_REQUIRED", "缺少服务端身份上下文", 401);
        if (identity.system && bootstrap?.active) return method.apply(target, args);
        if (identity.signed)
          demand(
            identity.accountId && identity.actorId,
            "AUTH_PROGRAM_MAPPING_REQUIRED",
            "签名身份尚未映射到有效程序账号",
            403,
          );
        if (name === "listProjectFoundations") {
          if (identity.global) {
            await service.globalAccess(identity.raw);
            return method.apply(target, args);
          }
          const ids = new Set((await service.listSpaces(identity.raw)).map((space) => space.id));
          return (await method.apply(target, args)).filter((f) => ids.has(f.project.id));
        }

        return database.transaction(async (tx) => {
          if (global.test(name) || name === "applyWorkspaceModelReplacement") {
            if (!read.test(name)) {
              await tx.query("SELECT id FROM project ORDER BY id FOR UPDATE");
              await tx.query("SELECT singleton FROM auth_control WHERE singleton FOR UPDATE");
            }
            if (read.test(name) && identity.workspaceId && !identity.global) {
              await tx.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [identity.workspaceId]);
              await service.authorizeActor(
                identity.workerAccountId ?? identity.actorId ?? identity.accountId,
                identity.workspaceId,
                identity.operation ?? "READ",
                tx,
              );
              if (identity.raw)
                await service.authorize(identity.raw, identity.workspaceId, identity.operation ?? "READ", tx);
            } else await service.globalAccess(identity.raw, tx);
          } else {
            const workspaceId = args[0];
            demand(typeof workspaceId === "string", "AUTH_UNMAPPED_OPERATION", "未映射的存储操作");
            demand(
              !identity.workspaceId || identity.workspaceId === workspaceId,
              "AUTH_OBJECT_SPACE_MISMATCH",
              "对象不属于当前空间",
              404,
            );
            await tx.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [workspaceId]);
            await service.authorizeActor(
              identity.workerAccountId ?? identity.actorId ?? identity.accountId,
              workspaceId,
              read.test(name) ? (identity.operation ?? "READ") : (identity.operation ?? "MAINTAIN"),
              tx,
            );
            if (identity.raw)
              await service.authorize(
                identity.raw,
                workspaceId,
                identity.operation ?? (read.test(name) ? "READ" : "MAINTAIN"),
                tx,
              );
            if (identity.program && identity.workerAccountId)
              await service.authorizeActor(
                identity.actorId ?? identity.accountId,
                workspaceId,
                identity.operation ?? "MAINTAIN",
                tx,
              );
          }
          const result = await method.apply(target, args);
          if (name === "appendUnderstandingRecord" && args[1] === "WORKSPACE_EVENT") {
            const event = args[2];
            await service.repository.change((s) => {
              const space = s.spaces[args[0]];
              if (!space) return;
              if (event.type === "WORKSPACE_RENAMED") space.name = event.payload.name;
              if (event.type === "DELETION_REQUESTED") space.status = "DELETION_REQUESTED";
              if (event.type === "DELETION_CANCELLED") space.status = "ACTIVE";
              if (event.type === "DELETION_COMPLETED") space.status = "DELETED";
            });
          }
          return result;
        });
      };
    },
  });
}
