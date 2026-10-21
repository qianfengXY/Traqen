import { escapeJsonPointer, JsonSyntaxError, parseJsonSyntax, validJsonPointer } from "./json-syntax.js";
import { extractReportMetadata, reportFieldProblem, reportFields, reportStatuses } from "./test-reports.js";

const sensitiveKey = /(?:password|secret|token|api[_-]?key)/i;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const field = (node, key) => node?.type === "object" ? node.children.find(child => child.key === key) : undefined;
const textField = (node, key) => { const child = field(node, key); return child?.type === "string" ? child.value : null; };
const parameterIdentity = node => {
  const name = textField(node, "name"), location = textField(node, "in");
  return name === null || location === null || field(node, "$ref") ? null : JSON.stringify([name, location]);
};

// Iterative strongly-connected components over syntax containment + references.
// This catches recursion through descendants without unbounded schema expansion
// or JS call-stack growth on long reference chains.
function cyclicReferenceSources(nodes, edges) {
  const graph = new Map([...nodes.values()].map(entry => [entry.object.objectId, []]));
  const reverse = new Map([...graph.keys()].map(id => [id, []]));
  const connect = (from, to) => { graph.get(from).push(to); reverse.get(to).push(from); };
  for (const entry of nodes.values()) if (graph.has(entry.object.parentId)) connect(entry.object.parentId, entry.object.objectId);
  for (const entry of edges.values()) connect(entry.object.objectId, entry.target.objectId);
  const visited = new Set(), order = [];
  for (const root of graph.keys()) {
    if (visited.has(root)) continue;
    visited.add(root); const stack = [{ id: root, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), adjacent = graph.get(frame.id);
      if (frame.next < adjacent.length) {
        const id = adjacent[frame.next++];
        if (!visited.has(id)) { visited.add(id); stack.push({ id, next: 0 }); }
      } else { order.push(frame.id); stack.pop(); }
    }
  }
  const component = new Map(); let index = 0;
  for (const root of order.reverse()) {
    if (component.has(root)) continue;
    const stack = [root]; component.set(root, ++index);
    while (stack.length) for (const id of reverse.get(stack.pop())) if (!component.has(id)) { component.set(id, index); stack.push(id); }
  }
  return new Set([...edges.values()].filter(entry => component.get(entry.object.objectId) === component.get(entry.target.objectId)).map(entry => entry.object.objectId));
}

export function extractJsonStructure({ material, text, limits, textAnchor, addObject, addFact, addGap }) {
  let root;
  const location = (pointer, start, end) => ({ kind: "JSON_POINTER", pointer, textRange: textAnchor(text, start, end) });
  try { root = parseJsonSyntax(text, limits); }
  catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
    addGap(material, "json", error.code, location(error.pointer, error.start, error.end)); return;
  }
  const versionNode = field(root, "openapi");
  const openapi = /^3\.(?:0|1)\.[0-9]+(?:[-+].*)?$/.test(textField(root, "openapi") ?? "");
  if (versionNode && !openapi) addGap(material, "json", "OPENAPI_VERSION_UNSUPPORTED", location(versionNode.pointer, versionNode.start, versionNode.end));
  const nodes = new Map(), names = new Map(), operations = [], references = [];
  const reportsEnabled = limits?.testReports === "literal-reports-v1", testsNode = field(root, "tests");
  if (reportsEnabled && testsNode?.type === "array" && testsNode.children.length > (limits.maxReportCases ?? 2000)) {
    addGap(material, "json", "REPORT_CASE_LIMIT", location(testsNode.pointer, testsNode.start, testsNode.end)); return;
  }
  const kindFor = (node, segments) => {
    const parent = nodes.get(node.pointer.slice(0, node.pointer.lastIndexOf("/")))?.node;
    if (node.type === "object" && openapi && segments[0] === "paths" && segments[1]?.startsWith("/") && segments.length === 3 && methods.has(segments[2])) return "OPENAPI_OPERATION";
    if (node.type === "object" && openapi && ((parent?.type === "array" && segments[0] === "paths" && ((segments.length === 4 && segments[2] === "parameters")
      || (segments.length === 5 && methods.has(segments[2]) && segments[3] === "parameters")))
      || (parent?.type === "object" && segments.length === 3 && segments[0] === "components" && segments[1] === "parameters"))) return "OPENAPI_PARAMETER";
    if (node.type === "object" && parent?.type === "object" && openapi && segments[0] === "paths" && segments.length === 5 && methods.has(segments[2]) && segments[3] === "responses") return "OPENAPI_RESPONSE";
    if (node.type === "object" && segments.length === 2 && segments[0] === "tests" && (reportsEnabled ? parent?.type === "array" : textField(node, "name") !== null && textField(node, "status") !== null)) return "TEST_RESULT";
    return node.type === "object" ? "JSON_OBJECT" : node.type === "array" ? "JSON_ARRAY" : "JSON_VALUE";
  };
  const visit = (node, parent, segments) => {
    if (node.key !== undefined && sensitiveKey.test(node.key)) {
      // Neither the secret subtree nor its decoded names/pointers are indexed.
      addGap(material, "json", "JSON_SENSITIVE_SUBTREE_RESTRICTED", textAnchor(text, node.keyStart ?? node.start, node.keyEnd ?? node.start)); return;
    }
    const kind = kindFor(node, segments), anchor = location(node.pointer, node.start, node.end);
    if (reportsEnabled && kind === "TEST_RESULT") {
      const problem = reportFieldProblem(textField(node, "name"), limits);
      if (problem) { const child = field(node, "name"); addGap(material, "json", problem, location(child.pointer, child.start, child.end)); return; }
    }
    if (reportsEnabled && parent.kind === "TEST_RESULT" && (reportFields.has(node.key) || ["name", "status"].includes(node.key))) {
      const problem = reportFieldProblem(node.type === "string" ? node.value : null, limits);
      if (problem || (node.key === "sourceBundleId" && !/^[a-f0-9]{64}$/.test(node.value))) {
        addGap(material, "json", problem ?? "REPORT_FIELD_INVALID", anchor); return;
      }
    }
    if (openapi && segments[0] === "paths") {
      const pathParameters = segments.length === 3 && segments[2] === "parameters";
      const operationField = segments.length === 4 && methods.has(segments[2]);
      if (segments.length === 1 && node.type !== "object") addGap(material, "json", "OPENAPI_PATHS_INVALID", anchor);
      if ((pathParameters || (operationField && segments[3] === "parameters")) && node.type !== "array") addGap(material, "json", "OPENAPI_PARAMETERS_INVALID", anchor);
      if (operationField && segments[3] === "responses" && node.type !== "object") addGap(material, "json", "OPENAPI_RESPONSES_INVALID", anchor);
    }
    const name = kind === "OPENAPI_OPERATION" ? `${segments[2].toUpperCase()} ${segments[1]}` : kind === "TEST_RESULT" ? textField(node, "name") : node.key ?? "$";
    const object = addObject(material, kind, name, anchor); object.parentId = parent.objectId;
    nodes.set(node.pointer, { node, object, segments });
    names.set(node.pointer, addFact({ subject: object, predicate: "name", value: { datatype: "string", value: name }, material,
      anchor: location(node.pointer, node.keyStart ?? node.start, node.keyEnd ?? node.end) }));
    addFact({ subject: object, predicate: "type", value: { datatype: "string", value: node.type }, material, anchor });
    if (!node.children.length && !["object", "array"].includes(node.type)) addFact({ subject: object, predicate: "literalValue",
      value: { datatype: node.type === "number" && Number.isInteger(node.value) ? "integer" : node.type, value: node.value }, material, anchor });
    if (kind === "OPENAPI_OPERATION") {
      operations.push({ node, object, segments });
      for (const [predicate, value] of [["httpMethod", segments[2].toUpperCase()], ["path", segments[1]]]) addFact({ subject: object, predicate, value: { datatype: "string", value }, material, anchor });
    }
    if (kind === "TEST_RESULT") {
      for (const [predicate, key] of [["testName", "name"], ["reportsResult", "status"]]) {
        const child = field(node, key);
        if (reportsEnabled && predicate === "reportsResult" && (child?.type !== "string" || !reportStatuses.has(child.value))) { addGap(material, "json", "REPORT_RESULT_AMBIGUOUS", anchor); continue; }
        const at = location(child.pointer, child.start, child.end);
        addFact({ subject: object, predicate, value: { datatype: "string", value: child.value }, material, anchor: at });
      }
      if (reportsEnabled) extractReportMetadata({ material, object, fields: new Map([...reportFields.keys()].flatMap(key => {
        const child = field(node, key); return child ? [[key, { value: child.type === "string" ? child.value : null, anchor: location(child.pointer, child.start, child.end) }]] : [];
      })), limits, addFact, addGap });
      addGap(material, "json", "EXECUTION_BINDING_MISSING", anchor);
    }
    if (openapi && field(node, "$ref")) references.push({ node, object, ref: field(node, "$ref") });
    for (const child of node.children) visit(child, object, [...segments, child.key]);
  };
  visit(root, material.root, []);
  for (const operation of operations) {
    const pathNode = nodes.get(`/paths/${escapeJsonPointer(operation.segments[1])}`);
    const local = field(operation.node, "parameters"), localParameters = local?.type === "array" ? local.children : [];
    const overrides = new Set(localParameters.map(parameterIdentity).filter(identity => identity !== null));
    const unknownOverrides = (local && local.type !== "array") || localParameters.some(node => parameterIdentity(node) === null);
    for (const [owner, inherited] of [[operation, false], [pathNode, true]]) {
      const parameters = field(owner?.node, "parameters");
      if (parameters?.type !== "array") continue;
      for (const child of parameters.children) {
        const entry = nodes.get(child.pointer);
        if (entry?.object.kind !== "OPENAPI_PARAMETER") continue;
        if (inherited) {
          const identity = parameterIdentity(child);
          if (identity === null || unknownOverrides) {
            addGap(material, "json", "OPENAPI_PARAMETER_INHERITANCE_UNCONFIRMED", location(child.pointer, child.start, child.end)); continue;
          }
          if (overrides.has(identity)) continue;
        }
        addFact({ subject: operation.object, predicate: "declaresParameter", target: entry.object, material,
          anchor: location(child.pointer, child.start, child.end), basis: inherited ? "DERIVED" : "DECLARED",
          premiseFactIds: inherited ? [names.get(operation.node.pointer), names.get(pathNode.node.pointer), names.get(child.pointer)] : [] });
      }
    }
    const responses = field(operation.node, "responses");
    if (responses?.type === "object") for (const child of responses.children) {
      if (nodes.get(child.pointer)?.object.kind !== "OPENAPI_RESPONSE") continue;
      addFact({ subject: operation.object, predicate: "declaresResponse", value: { datatype: "string", value: child.key }, material,
        anchor: location(child.pointer, child.keyStart, child.keyEnd) });
    }
  }
  const edges = new Map();
  for (const entry of references) {
    const ref = entry.ref, anchor = location(ref.pointer, ref.start, ref.end);
    if (ref.type !== "string") { addGap(material, "json", "JSON_REFERENCE_INVALID", anchor); continue; }
    if (!ref.value.startsWith("#")) { addGap(material, "json", "JSON_REFERENCE_EXTERNAL_UNSUPPORTED", anchor); continue; }
    let pointer;
    try { pointer = decodeURIComponent(ref.value.slice(1)); } catch { addGap(material, "json", "JSON_REFERENCE_INVALID", anchor); continue; }
    if (!validJsonPointer(pointer)) { addGap(material, "json", "JSON_REFERENCE_INVALID", anchor); continue; }
    const target = nodes.get(pointer);
    if (!target) { addGap(material, "json", "JSON_REFERENCE_UNRESOLVED", anchor); continue; }
    edges.set(entry.object.objectId, { ...entry, target: target.object, anchor });
  }
  const cyclic = cyclicReferenceSources(nodes, edges);
  for (const entry of edges.values()) {
    if (cyclic.has(entry.object.objectId)) addGap(material, "json", "JSON_REFERENCE_CYCLE", entry.anchor);
    else addFact({ subject: entry.object, predicate: "refersTo", target: entry.target, material, anchor: entry.anchor });
  }
}
