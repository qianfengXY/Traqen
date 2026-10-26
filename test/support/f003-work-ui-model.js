// Mechanism-only response. Never a real model, business truth or quality score.
export function syntheticQuestion(input) {
  if (input.operation === "GRAPH_QUESTION_PLAN")
    return {
      assignments: [
        { slotId: input.childSlots[0].id, objectKeys: input.objects.map((o) => o.key) },
      ],
    };
  if (input.operation === "DRAFT")
    return {
      segments: [
        {
          key: "unknown-answer",
          text: "合成派生回答：只能说明固定原文，实际业务执行仍未知。",
          stance: "UNKNOWN",
          graphRefs: input.objects.map((o) => o.key),
          evidence: input.objects.flatMap((o) => o.evidence).slice(0, 1),
          technicalRefs: [],
          uncertainties: ["尚无实际执行证据"],
        },
      ],
      unknowns: ["真实业务质量与运行状态未验证"],
    };
  return {
    reviews: input.drafts
      .flatMap((d) => d.segments)
      .map((s) => ({
        key: s.key,
        support: "UNKNOWN",
        rationale: "synthetic mechanism keeps missing premises unknown",
        premises: ["原文并不证明实际执行"],
        unresolvedConflicts: [],
      })),
    unresolvedConflicts: [],
  };
}
