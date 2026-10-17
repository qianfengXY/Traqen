import type { Person } from "./auth-client";
export type AccessSpace = {
  id: string;
  workspaceId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  visibility: string;
  status: string;
  roles: string[];
  canManage: boolean;
  canOwn: boolean;
  pendingOwner: boolean;
  memberCount?: number;
  pendingCount?: number;
};
export type AccessContext = {
  spaces: AccessSpace[];
  reviewRoles: string[];
  canAdmin: boolean;
  canGlobalConfig: boolean;
};
export type AccessApplication = {
  canDecide?: boolean;
  id: string;
  accountId: string;
  requesterName?: string;
  spaceName?: string;
  decisionName?: string;
  kind: string;
  workspaceId: string | null;
  name?: string;
  reason: string;
  requestedRoles: string[];
  actualRoles?: string[];
  status: string;
  version: number;
  createdAt: number;
  decisionReason?: string;
  decidedBy?: string;
};
export type Member = Person & {
  roles: string[];
  grants: Array<{ source: string; grantedBy: string; grantedByName?: string; createdAt: number; roles: string[] }>;
};
export const roleLabel = (role: string) =>
  ({ OWNER: "Owner", PERMISSION_ADMIN: "权限管理员", READ: "查看", MAINTAIN: "维护" })[role] ?? role;
export const statusLabel = (status: string) =>
  ({
    PENDING: "待审批",
    APPROVED: "已通过",
    REJECTED: "被拒绝",
    WITHDRAWN: "已撤回",
    ACTIVE: "有效",
    DISABLED: "已停用",
    DELETION_REQUESTED: "等待删除",
    DELETED: "已删除",
  })[status] ?? status;
export type RunAction = (work: () => Promise<void>) => Promise<void>;
