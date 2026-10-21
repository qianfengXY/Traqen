const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]);
const parameter = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

// A declaration-pattern shape, not a router, URL decoder, host matcher or
// deployment identity. Keep case and trailing slash; only whole-segment literal
// parameter spellings are normalized positionally. Never interpret regex.
export function endpointPathShape(value, express = false) {
  if (typeof value !== "string" || !value.startsWith("/") || Buffer.byteLength(value) > 8192
    || /[\u0000-\u0020\u007f%?#\\*+()[\]!]/.test(value) || value.includes("//")) return null;
  const segments = value.split("/");
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]; if ([".", ".."].includes(segment)) return null;
    if (express && segment.startsWith(":")) { if (!parameter.test(segment.slice(1))) return null; segments[i] = "{}"; }
    else if (segment.startsWith("{") && segment.endsWith("}")) { if (!parameter.test(segment.slice(1, -1))) return null; segments[i] = "{}"; }
    else if (/[{}:]/.test(segment)) return null;
  }
  return segments.join("/");
}

// Index actual fixed-rule property declarations, retaining separate application
// conditions even when two effectivePath facts point to one route object.
export function endpointDeclarations({ objects, facts, materials }) {
  const bySubject = new Map(), contracts = [], routes = [], invalidContracts = [];
  for (const f of facts) if (f.kind === "PROPERTY") { if (!bySubject.has(f.subjectId)) bySubject.set(f.subjectId, []); bySubject.get(f.subjectId).push(f); }
  for (const o of objects) {
    if (!["OPENAPI_OPERATION", "ROUTE"].includes(o.kind)) continue;
    const material = materials.get(o.materialId), properties = bySubject.get(o.objectId) ?? [], contract = o.kind === "OPENAPI_OPERATION";
    const rule = contract ? "f002-json" : material.ruleRef?.id;
    if (!contract && !["f002-java", "f002-javascript"].includes(rule)) continue;
    const eligible = f => f.ruleRef.id === rule && f.ruleRef.version === "2" && f.value?.datatype === "string" && f.basis === (contract ? "DECLARED" : rule === "f002-java" ? "DERIVED" : f.predicate === "effectivePath" ? "DERIVED" : "DECLARED");
    const verbs = properties.filter(f => f.predicate === "httpMethod" && eligible(f) && methods.has(f.value.value));
    const paths = properties.filter(f => f.predicate === (contract || rule === "f002-java" ? "path" : "effectivePath") && eligible(f));
    if (verbs.length !== 1 || !paths.length) { if (contract) invalidContracts.push({ object: o, material, code: "ENDPOINT_CONTRACT_DECLARATION_UNSUPPORTED" }); continue; }
    for (const path of paths) {
      const shape = endpointPathShape(path.value.value, rule === "f002-javascript");
      if (shape === null) { if (contract) invalidContracts.push({ object: o, material, code: "ENDPOINT_CONTRACT_PATH_UNSUPPORTED" }); continue; }
      const entry = { object: o, material, path, method: verbs[0], key: JSON.stringify([material.componentId, verbs[0].value.value, shape]) };
      (contract ? contracts : routes).push(entry);
    }
  }
  return { contracts, routes, invalidContracts };
}

export function resolveEndpointContracts({ objects, facts, materialById, limits, addFact, addGap }) {
  if (limits?.endpointContracts !== "component-path-shape-v1") return;
  const declarations = objects.filter(o => ["OPENAPI_OPERATION", "ROUTE"].includes(o.kind));
  if (declarations.length > (limits.maxEndpointDeclarations ?? 10_000)) {
    for (const o of declarations) if (o.kind === "OPENAPI_OPERATION") addGap(materialById.get(o.materialId), "json", "ENDPOINT_CONTRACT_LIMIT", o.anchor);
    return;
  }
  const { contracts, routes, invalidContracts } = endpointDeclarations({ objects, facts, materials: materialById });
  for (const item of invalidContracts) addGap(item.material, "json", item.code, item.object.anchor);
  const contractIndex = new Map(), routeIndex = new Map();
  for (const [items, index] of [[contracts, contractIndex], [routes, routeIndex]]) for (const item of items) {
    if (!index.has(item.key)) index.set(item.key, []); index.get(item.key).push(item);
  }
  const planned = [];
  for (const item of contracts) {
    const targets = routeIndex.get(item.key) ?? [], origins = contractIndex.get(item.key);
    if (targets.length > 1 || origins.length > 1) {
      const ids = entries => [...new Set(entries.map(e => e.object.objectId))].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      const candidates = ids(targets), sources = ids(origins), max = limits.maxEndpointCandidateRefs ?? 64;
      addGap(item.material, "json", "ENDPOINT_CONTRACT_AMBIGUOUS", item.object.anchor, {
        candidateObjectIds: candidates.slice(0, max), contractObjectIds: sources.slice(0, max), candidateConditions: targets.length,
        candidateRefsTruncated: candidates.length > max || sources.length > max,
      }); continue;
    }
    if (!targets.length) { addGap(item.material, "json", "ENDPOINT_CONTRACT_TARGET_UNRESOLVED", item.object.anchor); continue; }
    planned.push({ item, target: targets[0] });
  }
  if (planned.length > (limits.maxEndpointMatches ?? 2000)) {
    for (const { item } of planned) addGap(item.material, "json", "ENDPOINT_CONTRACT_LIMIT", item.object.anchor); return;
  }
  for (const { item, target } of planned) addFact({ subject: item.object, predicate: "matchesEndpointContract", target: target.object,
    material: item.material, anchor: item.object.anchor, basis: "DERIVED", premiseFactIds: [item.method.factId, item.path.factId, target.method.factId, target.path.factId] });
}
