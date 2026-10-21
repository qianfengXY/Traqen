import { canonicalDigest } from "./identity.js";
import { requireF002 } from "./errors.js";
import { endpointDeclarations } from "./extraction/endpoint-contracts.js";

const check = (value, reason) => requireF002(value, "F002_ENDPOINT_CONTRACT_INVALID", reason, { status: 422 });
export function verifyEndpointContracts({ objects, facts, materials, evidence, gaps, profile }) {
  const graph = endpointDeclarations({ objects: [...objects.values()], facts: [...facts.values()], materials });
  const origins = new Map(), targets = new Map(), byOrigin = new Map();
  for (const item of graph.contracts) byOrigin.set(`${item.object.objectId}:${item.method.factId}:${item.path.factId}`, item);
  for (const [items, index] of [[graph.contracts, origins], [graph.routes, targets]]) for (const item of items) {
    if (!index.has(item.key)) index.set(item.key, []); index.get(item.key).push(item);
  }
  const enabled = profile.extractionLimits?.endpointContracts === "component-path-shape-v1";
  let count = 0;
  for (const f of facts.values()) if (f.predicate === "matchesEndpointContract") {
    check(enabled && f.kind === "RELATION" && f.ruleRef.id === "f002-json" && f.ruleRef.version === "2" && f.basis === "DERIVED", "端点合同关系不属于固定组件匹配能力");
    check(++count <= (profile.extractionLimits.maxEndpointMatches ?? 2000), "端点合同关系预算越界");
    const source = objects.get(f.subjectId), target = objects.get(f.targetId);
    check(source.kind === "OPENAPI_OPERATION" && target.kind === "ROUTE" && materials.get(source.materialId).componentId === materials.get(target.materialId).componentId, "端点合同关系越过组件或对象类型边界");
    const method = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.subjectId === source.objectId && p.predicate === "httpMethod");
    const path = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.subjectId === source.objectId && p.predicate === "path");
    check(method.length === 1 && path.length === 1, "端点合同缺少来源方法或路径前提");
    const entry = byOrigin.get(`${source.objectId}:${method[0].factId}:${path[0].factId}`);
    const candidates = entry ? targets.get(entry.key) ?? [] : [];
    check(entry && origins.get(entry.key).length === 1 && candidates.length === 1 && candidates[0].object.objectId === target.objectId, "端点合同方法、路径形状或候选唯一性不成立");
    const expected = [entry.method.factId, entry.path.factId, candidates[0].method.factId, candidates[0].path.factId];
    check(f.premiseFactIds.length === 4 && new Set(f.premiseFactIds).size === 4 && expected.every(id => f.premiseFactIds.includes(id)), "端点合同缺少正确两端四项前提");
    check(f.evidenceIds.length === 1 && evidence.get(f.evidenceIds[0]).materialId === source.materialId
      && canonicalDigest("ENDPOINT_ANCHOR", evidence.get(f.evidenceIds[0]).anchor) === canonicalDigest("ENDPOINT_ANCHOR", source.anchor), "端点合同证据没有回到合同声明锚点");
  }
  if (count) check([...objects.values()].filter(o => ["OPENAPI_OPERATION", "ROUTE"].includes(o.kind)).length <= (profile.extractionLimits.maxEndpointDeclarations ?? 10_000), "端点合同声明预算越界");
  for (const g of gaps.values()) if (g.code === "ENDPOINT_CONTRACT_AMBIGUOUS") {
    const componentId = materials.get(g.materialId)?.componentId;
    for (const [key, kind] of [["candidateObjectIds", "ROUTE"], ["contractObjectIds", "OPENAPI_OPERATION"]]) {
      const ids = g.reason[key]; check(enabled && Array.isArray(ids) && ids.length <= (profile.extractionLimits.maxEndpointCandidateRefs ?? 64) && new Set(ids).size === ids.length, "端点合同歧义候选列表无效");
      check(ids.every(id => { const o = objects.get(id); return o?.kind === kind && materials.get(o.materialId).componentId === componentId; }), "端点合同歧义候选越过组件或引用未登记对象");
    }
  }
}
