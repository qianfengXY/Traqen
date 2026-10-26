import { InvestigationService } from "../../src/business-knowledge/investigation-service.js";
import { SourceAdmissionService } from "../../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../../src/source-truth/publication-service.js";
import { candidateFixture } from "./source-truth-candidate-fixture.js";
import { owner } from "./source-truth-database.js";

// Infrastructure is real; this helper's F006 bridge and caller-supplied model
// responses are test doubles, never real-model or independent quality evidence.
export const profile = { id: "profile-v1", workspaceId: "workspace", mainAgentSlot: { id: "main", role: "MAIN", modelProfileRevisionId: "model-v1", mcpGrants: [] },
  childAgentSlots: [{ id: "child-1", role: "CHILD", modelProfileRevisionId: "model-v1", mcpGrants: [] }],
  entries: [{ kind: "MODEL", logicalName: "model-v1", manifest: { transport: "CLI", cliAdapter: "CODEX", model: "test-model" } }] };

export async function investigationFixture(t, options = {}) {
  const source = await candidateFixture(t, { entryPath: "business.md", content: "用户可以取消未支付的订单。", ...options });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const sealed = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "f003-source" });
  const reference = { bundleId: sealed.bundle.id, receiptId: sealed.receipt.id };
  const sourceAdmission = new SourceAdmissionService(source.repository, source.candidates);
  const profiles = { resolveActive: async () => structuredClone(profile), assertUsable: async () => {} };
  const service = new InvestigationService({ sources: source.repository, sourceAdmission, profiles });
  const request = { operationId: "investigate-1", reference, expectedProfileId: profile.id, question: "取消订单有哪些规则？", technicalVersionId: null,
    scope: { componentIds: sealed.bundle.components.map(c => c.id) },
    budget: { maxReadBytes: 8192, maxModelCalls: 5, deadline: "2099-01-01T00:00:00Z" },
    supplementBudget: { maxMaterials: 10, maxBytes: 8192, maxRuleApplications: 50, maximumAttempts: 3, deadline: "2099-01-01T00:00:00Z" } };
  return { ...source, sourceAdmission, profiles, service, request, reference };
}
