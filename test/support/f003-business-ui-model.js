// Explicit external-model process double for synthetic UI/HTTP verification.
// These responses never establish real model quality or publication readiness.
export function businessUiModelResponse(input) {
  if (input.phase === "PLAN") return { assignments: [{ slotId: input.childSlots[0].id,
    obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "Inspect the exact synthetic order status code and contract", materialKeys: input.inventory.map(item => item.key) }] };
  if (input.phase === "INVESTIGATE") {
    const material = input.materials.find(item => item.text.includes("function orderStatus"));
    if (!material) throw Error("Synthetic frozen order-status material was not read");
    const evidence = [{ materialId: material.id, startLine: 1, endLine: 1, quote: material.text.split("\n")[0] }];
    return { candidates: [
      { key: "order-status", kind: "FUNCTION", name: "查询订单状态", statement: "固定示例函数返回 OPEN 状态。", scope: "仅本次冻结示例代码", evidence, uncertainties: ["未证明实际请求或测试执行"] },
      { key: "open-state", kind: "STATE", name: "开放状态", statement: "示例代码中存在 OPEN 字面状态。", scope: "仅本次冻结示例代码", evidence, uncertainties: ["未证明持久化订单状态或状态转换"] },
    ], relations: [{ key: "has-state", sourceKey: "order-status", targetKey: "open-state", predicate: "HAS_STATE",
      scope: "仅固定示例函数的返回声明", evidence, uncertainties: ["不证明实际执行"] }] };
  }
  if (input.stage === "CONSOLIDATE_PROPOSALS") return { mergeSuggestions: [], conflictGroups: [] };
  if (input.phase === "VERIFY") return { reviews: [...input.candidates, ...input.relations].map(item => ({ key: item.key,
    support: "SUPPORTED", rationale: "合成响应逐字引用已读取的固定代码", premises: ["仅固定代码声明，非人工确认或真实执行"], unresolvedConflicts: [] })) };
  throw Error("Unexpected synthetic business model phase");
}
