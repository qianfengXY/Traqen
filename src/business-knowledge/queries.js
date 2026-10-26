import { requireF003 } from "./errors.js";

const visible = (record, options) => options.onlyHumanConfirmed ? record.authority === "HUMAN_CONFIRMED"
  : options.includeUncertain || record.state === "ANALYSIS_ACCEPTED" || record.authority === "HUMAN_CONFIRMED";
const identity = graph => ({ graphId: graph.id, graphDigest: graph.digest, investigationId: graph.investigationId,
  sourceBundleId: graph.sourceBundleId, profileId: graph.profileId, adoptedVersionIds: [...graph.adoptedVersionIds], published: graph.published });

function supportingMaterials(graph, nodes, edges) {
  const materialKeys = new Set(graph.materials.map(m => m.id));
  const used = new Set([...nodes, ...edges].flatMap(record => record.evidence.map(e => e.materialId)));
  for (const edge of edges) for (const endpoint of [edge.sourceKey, edge.targetKey]) if (materialKeys.has(endpoint)) used.add(endpoint);
  return graph.materials.filter(m => used.has(m.id));
}

export function queryBusinessGraph(graph, options = {}) {
  const { view = "BUSINESS", key = null, text = "", kind = null } = options;
  requireF003(["BUSINESS", "IMPLEMENTATION", "COVERAGE"].includes(view) && typeof text === "string" && text.length <= 1000
    && (key === null || typeof key === "string") && (kind === null || typeof kind === "string")
    && ["includeUncertain", "onlyHumanConfirmed"].every(k => options[k] === undefined || typeof options[k] === "boolean"),
  "F003_QUERY_INVALID", "图谱查询条件无效", { status: 422 });
  const match = text.toLocaleLowerCase();
  let nodes = graph.candidates.filter(n => visible(n, options) && (!kind || n.kind === kind)
    && (!match || `${n.name}\n${n.statement}\n${n.scope}`.toLocaleLowerCase().includes(match)));
  if (key) {
    requireF003(graph.candidates.some(n => n.key === key), "F003_OBJECT_NOT_FOUND", "此图谱版本没有该命题", { status: 404 });
    const connected = new Set([key]);
    for (const edge of graph.relations.filter(r => visible(r, options))) {
      if (edge.sourceKey === key) connected.add(edge.targetKey);
      if (edge.targetKey === key) connected.add(edge.sourceKey);
    }
    nodes = nodes.filter(n => connected.has(n.key));
  }
  const nodeKeys = new Set(nodes.map(n => n.key)), materialKeys = new Set(graph.materials.map(m => m.id));
  const edges = graph.relations.filter(e => visible(e, options) && (nodeKeys.has(e.sourceKey) || nodeKeys.has(e.targetKey))
    && [e.sourceKey, e.targetKey].every(k => nodeKeys.has(k) || materialKeys.has(k)));
  return structuredClone({ ...identity(graph), view, nodes, edges: view === "BUSINESS" ? edges.filter(e => nodeKeys.has(e.sourceKey) && nodeKeys.has(e.targetKey)) : edges,
    materials: view === "IMPLEMENTATION" ? supportingMaterials(graph, nodes, edges) : [],
    coverage: view === "COVERAGE" ? graph.coverage : [], uncertaintyCount: graph.candidates.filter(n => n.state !== "ANALYSIS_ACCEPTED").length });
}

export function traceBusinessGraph(graph, { key = null, materialId = null } = {}) {
  requireF003((typeof key === "string") !== (typeof materialId === "string"), "F003_QUERY_INVALID", "请选择一个命题或材料进行追溯", { status: 422 });
  if (key) {
    const view = queryBusinessGraph(graph, { view: "IMPLEMENTATION", key, includeUncertain: true });
    const edges = graph.relations.filter(e => e.sourceKey === key || e.targetKey === key);
    return structuredClone({ ...view, direction: "BUSINESS_TO_MATERIAL", edges, materials: supportingMaterials(graph, view.nodes, edges) });
  }
  const material = graph.materials.find(m => m.id === materialId);
  requireF003(material, "F003_OBJECT_NOT_FOUND", "此图谱没有关联该已读材料", { status: 404 });
  const edges = graph.relations.filter(e => e.sourceKey === materialId || e.targetKey === materialId || e.evidence.some(c => c.materialId === materialId));
  const linked = new Set(edges.flatMap(e => [e.sourceKey, e.targetKey]));
  return structuredClone({ ...identity(graph), direction: "MATERIAL_TO_BUSINESS", materials: [material],
    nodes: graph.candidates.filter(n => linked.has(n.key) || n.evidence.some(c => c.materialId === materialId)), edges,
    coverage: graph.coverage.filter(e => e.materialId === materialId) });
}

export function businessSevenQuestions(graph, key) {
  const trace = traceBusinessGraph(graph, { key }), objects = trace.nodes;
  const select = kinds => objects.filter(n => kinds.includes(n.kind));
  const testIds = new Set(graph.materials.filter(m => m.assetType === "TEST_ASSET").map(m => m.id));
  const byKey = new Map(graph.candidates.map(n => [n.key, n]));
  const citesTest = record => record.evidence.some(e => testIds.has(e.materialId));
  // Classify each relationship by its own test participation. A neighbouring
  // test asset, or CHECK/VERIFY in a production predicate, is not such a link.
  const testRelations = trace.edges.filter(edge => citesTest(edge) || [edge.sourceKey, edge.targetKey].some(endpoint =>
    testIds.has(endpoint) || (byKey.has(endpoint) && citesTest(byKey.get(endpoint)))));
  const sections = [
    { question: "功能做什么", nodes: select(["FUNCTION", "PROCESS"]) },
    { question: "规则、角色、状态和例外是什么", nodes: select(["RULE", "ROLE", "STATE", "EXCEPTION"]) },
    { question: "由哪些工程资产实现", materials: trace.materials, relations: trace.edges },
    { question: "涉及哪些业务数据", nodes: select(["BUSINESS_OBJECT"]) },
    { question: "哪些测试检查哪些规则", testAssets: trace.materials.filter(m => m.assetType === "TEST_ASSET"),
      relations: testRelations, executionStatus: "NO_LINKED_EXECUTION_RECORD" },
    { question: "对应什么版本和环境", sourceBundleId: graph.sourceBundleId, adoptedVersionIds: graph.adoptedVersionIds, environmentStatus: "NOT_ESTABLISHED_BY_SOURCE_ANALYSIS" },
    { question: "当前判断有哪些依据与缺口", evidence: [...objects, ...trace.edges].flatMap(n => n.evidence),
      uncertainties: [...objects, ...trace.edges].map(n => ({ key: n.key, state: n.state, uncertainties: n.uncertainties, premises: n.verification?.premises ?? [] })),
      unassociatedMaterials: graph.coverage.filter(e => e.businessStatus === "UNASSOCIATED") },
  ];
  return structuredClone({ ...identity(graph), authority: "DERIVED_VIEW", key, sections });
}
