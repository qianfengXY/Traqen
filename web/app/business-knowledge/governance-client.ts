import type { WorkRequest } from "./work-client.ts";
import { positive, workId } from "./work-types.ts";
export type ClaimTarget = {
  featureId: string;
  featureVersion: number;
  claimId: string;
  claimVersion: number;
  scopeId: string;
  scopeVersion: number;
};
export type FeatureInput = { id: string; version: number; name: string; description?: string };
export type ScopeInput = {
  id: string;
  version: number;
  scope: Record<string, unknown>;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};
export type ClaimInput = {
  id: string;
  version: number;
  featureId: string;
  type: string;
  statement: string;
  sourceType: string;
  evidenceSupport: string;
  scopeId: string;
  scopeVersion: number;
};
export type ReviewInput = {
  id: string;
  claimId: string;
  claimVersion: number;
  scopeId: string;
  scopeVersion: number;
  risk: string;
  approvalMode: string;
  expiresAt: string;
  proposedDecision: {
    id: string;
    type: string;
    content: string;
    evidenceRefs: string[];
    validUntil: string | null;
  };
};
export type ReviewCase = ReviewInput & {
  proposerId: string;
  proposerRole: string;
  createdAt: string;
};
export type ReviewEvent = {
  id: string;
  caseId: string;
  actorId: string;
  actorRole: string;
  action: string;
  rationale: string;
  createdAt: string;
};
export type ReviewView = {
  reviewCase: ReviewCase;
  events: ReviewEvent[];
  decisions: unknown[];
  evaluation: Record<string, unknown>;
};
type FeatureBaseline = {
  feature: FeatureInput;
  claims: { claim: ClaimInput; latestDecision: unknown }[];
  scopes: ScopeInput[];
};
const invalid = () =>
  Object.assign(new Error("人工复核响应与明确的对象、Claim或scope不符。"), {
    code: "F003_RESPONSE_INVALID",
    status: 0,
  });
const key = (s: string) => {
  if (!workId(s)) throw invalid();
  return encodeURIComponent(s);
};
function viewValid(v: ReviewView, id: string) {
  return (
    v?.reviewCase?.id === id &&
    workId(v.reviewCase.claimId) &&
    positive(v.reviewCase.claimVersion) &&
    workId(v.reviewCase.scopeId) &&
    positive(v.reviewCase.scopeVersion) &&
    typeof v.reviewCase.proposerId === "string" &&
    typeof v.reviewCase.proposerRole === "string" &&
    Array.isArray(v.events) &&
    v.events.every(
      (e) => e.caseId === id && typeof e.actorId === "string" && typeof e.actorRole === "string",
    ) &&
    !!v.evaluation &&
    typeof v.evaluation === "object"
  );
}
export class GovernanceClient {
  private request: WorkRequest;
  constructor(request: WorkRequest) {
    this.request = request;
  }
  async feature(input: FeatureInput) {
    const v = await this.request<FeatureInput>("features", "POST", input);
    if (v.id !== input.id || v.version !== input.version || v.name !== input.name) throw invalid();
    return v;
  }
  async scope(input: ScopeInput) {
    const v = await this.request<ScopeInput>("claim-scopes", "POST", input);
    if (
      v.id !== input.id ||
      v.version !== input.version ||
      JSON.stringify(v.scope) !== JSON.stringify(input.scope)
    )
      throw invalid();
    return v;
  }
  async claim(input: ClaimInput) {
    const v = await this.request<ClaimInput>("claims", "POST", input);
    if (
      v.id !== input.id ||
      v.version !== input.version ||
      v.featureId !== input.featureId ||
      v.scopeId !== input.scopeId ||
      v.scopeVersion !== input.scopeVersion ||
      v.statement !== input.statement
    )
      throw invalid();
    return v;
  }
  async baseline(id: string) {
    const v = await this.request<FeatureBaseline>(`features/${key(id)}`);
    if (
      v.feature?.id !== id ||
      !Array.isArray(v.claims) ||
      v.claims.some((x) => x.claim?.featureId !== id)
    )
      throw invalid();
    return v;
  }
  async review(id: string) {
    const v = await this.request<ReviewView>(`decision-review-cases/${key(id)}`);
    if (!viewValid(v, id)) throw invalid();
    return v;
  }
  async propose(input: ReviewInput) {
    const v = await this.request<ReviewView>("decision-review-cases", "POST", input),
      c = v.reviewCase;
    if (
      !viewValid(v, input.id) ||
      c.claimId !== input.claimId ||
      c.claimVersion !== input.claimVersion ||
      c.scopeId !== input.scopeId ||
      c.scopeVersion !== input.scopeVersion ||
      c.proposedDecision.id !== input.proposedDecision.id
    )
      throw invalid();
    return v;
  }
  async event(id: string, input: { id: string; action: string; rationale: string }) {
    const v = await this.request<ReviewView>(
      `decision-review-cases/${key(id)}/events`,
      "POST",
      input,
    );
    if (
      !viewValid(v, id) ||
      !v.events.some(
        (e) => e.id === input.id && e.action === input.action && e.rationale === input.rationale,
      )
    )
      throw invalid();
    return v;
  }
}
