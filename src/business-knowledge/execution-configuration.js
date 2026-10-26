import { canonicalEncode } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";

// Resolve F006's existing persisted identities under the caller's transaction.
// No model default, capability activation or new configuration authority lives here.
export class F006ExecutionConfiguration {
  async resolveActive(_actor, workspaceId, tx) {
    const row = (await tx.query(`SELECT r.record_payload FROM workspace_capability_head h
      JOIN understanding_record r ON r.project_id=h.project_id AND r.id=h.record_id AND r.record_type='WORKSPACE_EXECUTION_PROFILE'
      WHERE h.project_id=$1 AND h.head_key='WORKSPACE_EXECUTION_PROFILE' FOR SHARE OF h`, [workspaceId])).rows[0];
    return row?.record_payload ?? null;
  }

  async assertUsable(_actor, workspaceId, profile, tx) {
    const stored = (await tx.query(`SELECT record_payload FROM understanding_record
      WHERE project_id=$1 AND id=$2 AND record_type='WORKSPACE_EXECUTION_PROFILE'`, [workspaceId, profile?.id])).rows[0];
    requireF003(stored && canonicalEncode(stored.record_payload) === canonicalEncode(profile)
      && profile.workspaceId === workspaceId && profile.mainAgentSlot?.role === "MAIN" && profile.childAgentSlots?.length > 0,
    "F003_PROFILE_UNAVAILABLE", "调查配置必须引用此 Workspace 已生效并持久保存的完整配置");
    const slots = [profile.mainAgentSlot, ...profile.childAgentSlots];
    for (const slot of slots) {
      requireF003((slot.mcpGrants ?? []).length === 0 && (slot.mcpRevisionIds ?? []).length === 0,
        "F003_PROFILE_UNAVAILABLE", "MCP 仍暂停，不能用于本轮调查执行");
      const model = (await tx.query(`SELECT r.profile_payload,l.lifecycle FROM global_model_profile_revision r
        JOIN global_model_lifecycle l ON l.profile_id=r.profile_id WHERE r.revision_id=$1`, [slot.modelProfileRevisionId])).rows[0];
      const pinned = profile.entries?.find(e => e.kind === "MODEL" && e.logicalName === slot.modelProfileRevisionId);
      const payload = model?.profile_payload;
      requireF003(model?.lifecycle === "ACTIVE" && payload?.transport === "CLI" && (payload.ready === true || payload.verifiedAt)
        && pinned?.manifest.transport === "CLI" && payload.model && payload.model === pinned.manifest.model
        && payload.cliAdapter === pinned.manifest.cliAdapter && payload.currentRevisionId === slot.modelProfileRevisionId,
      "F003_MODEL_UNAVAILABLE", "固定模型已失效、未验证或与配置不符，请修复后继续");
      const account = payload.accountId ? (await tx.query("SELECT payload FROM global_account_revision WHERE account_id=$1 ORDER BY revision DESC LIMIT 1", [payload.accountId])).rows[0]?.payload : null;
      requireF003(account?.lifecycle === "ACTIVE" && (account.authMethod === "API_KEY"
        || (account.authMethod === "OAUTH" && account.oauthStatus === "AUTHENTICATED" && account.cliAdapter === payload.cliAdapter)),
      "F003_ACCOUNT_UNAVAILABLE", "固定模型关联的账号目前不可用");
      for (const grant of slot.skillGrants ?? []) {
        const capability = profile.entries?.find(e => e.kind === "SKILL" && e.logicalName === grant.normalizedName);
        requireF003(capability, "F003_CAPABILITY_UNAVAILABLE", "Agent 授权不在固定配置中");
        if (capability.sourceTemplateId) {
          const current = (await tx.query(`SELECT payload FROM capability_template_revision WHERE kind='SKILL'
            AND lower(btrim(logical_name))=$1 ORDER BY revision DESC LIMIT 1`, [grant.normalizedName])).rows[0]?.payload;
          requireF003(current && (current.lifecycle ?? "ACTIVE") === "ACTIVE", "F003_CAPABILITY_UNAVAILABLE", "已授权的全局 Skill 目前不可用");
        }
      }
    }
    return profile;
  }
}
