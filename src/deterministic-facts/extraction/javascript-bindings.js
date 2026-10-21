import path from "node:path";
import { fullAncestor } from "acorn-walk";

const functionKinds = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const scopeKinds = new Set(["Program", ...functionKinds, "BlockStatement", "StaticBlock", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "ClassDeclaration", "ClassExpression"]);
function identifiers(node) {
  if (!node) return [];
  if (node.type === "Identifier") return [node];
  if (node.type === "AssignmentPattern") return identifiers(node.left);
  if (node.type === "RestElement") return identifiers(node.argument);
  if (node.type === "ArrayPattern") return node.elements.flatMap(identifiers);
  if (node.type === "ObjectPattern") return node.properties.flatMap(p => identifiers(p.value ?? p.argument));
  return [];
}
const string = node => node?.type === "Literal" && typeof node.value === "string" ? node.value : node?.name;

// A fixed, conservative syntactic binding pass, not a runtime call graph.
// No expression evaluation, alias propagation, re-export traversal or filesystem reads.
export function extractJavaScriptBindings({ ast, material, text, limits, textAnchor, addObject, addFact, addGap, functionByNode, modules }) {
  const entries = [], scopes = new Map();
  fullAncestor(ast, (node, _state, ancestors) => entries.push({ node, ancestors: [...ancestors] }));
  entries.sort((a, b) => a.ancestors.length - b.ancestors.length || a.node.start - b.node.start);
  const callEntries = entries.filter(e => e.node.type === "CallExpression");
  const declaredCount = entries.reduce((n, e) => n + (e.node.type === "VariableDeclarator" ? identifiers(e.node.id).length
    : functionKinds.has(e.node.type) ? e.node.params.flatMap(identifiers).length + Number(Boolean(e.node.id))
      : e.node.type === "ImportDeclaration" ? e.node.specifiers.length : 0), 0);
  if (callEntries.length > (limits.maxJavaScriptCalls ?? 20_000) || declaredCount > (limits.maxJavaScriptBindings ?? 20_000)) {
    addGap(material, "javascript", "JAVASCRIPT_BINDINGS_LIMIT"); return;
  }
  const nearest = ancestors => [...ancestors].reverse().map(n => scopes.get(n)).find(Boolean);
  for (const { node, ancestors } of entries) if (scopeKinds.has(node.type)) scopes.set(node, { node, parent: nearest(ancestors.slice(0, -1)), bindings: new Map() });
  const root = scopes.get(ast);
  const lookup = (scope, name) => { for (let s = scope; s; s = s.parent) if (s.bindings.has(name)) return s.bindings.get(name); return []; };
  const bind = (scope, id, extra = {}) => {
    if (!id || !scope) return null;
    const binding = { name: id.name, id, ...extra };
    if (!scope.bindings.has(id.name)) scope.bindings.set(id.name, []);
    scope.bindings.get(id.name).push(binding); return binding;
  };
  let dynamicScope = false;
  for (const { node, ancestors } of entries) {
    const scope = nearest(ancestors), outer = nearest(ancestors.slice(0, -1));
    if (node.type === "WithStatement" || (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "eval")) dynamicScope = true;
    if (functionKinds.has(node.type)) {
      for (const id of node.params.flatMap(identifiers)) bind(scopes.get(node), id);
      if (node.type === "FunctionDeclaration" && node.id) {
        const annexB = ast.sourceType === "script" && outer.node.type === "BlockStatement"
          && !functionKinds.has(outer.parent?.node.type);
        bind(outer, node.id, { target: annexB ? null : functionByNode.get(node), initEnd: 0 });
      } else if (node.type === "FunctionExpression" && node.id) bind(scopes.get(node), node.id, { target: functionByNode.get(node), initEnd: 0 });
    }
    if (node.type === "CatchClause") for (const id of identifiers(node.param)) bind(scopes.get(node), id);
    if (["ClassDeclaration", "ClassExpression"].includes(node.type) && node.id) {
      bind(scopes.get(node), node.id); if (node.type === "ClassDeclaration") bind(outer, node.id);
    }
    if (node.type === "VariableDeclarator") {
      const declaration = [...ancestors].reverse().find(n => n.type === "VariableDeclaration");
      let bindingScope = scope;
      if (declaration.kind === "var") while (bindingScope.parent && !functionKinds.has(bindingScope.node.type) && bindingScope.node.type !== "Program") bindingScope = bindingScope.parent;
      for (const id of identifiers(node.id)) bind(bindingScope, id, { target: node.id.type === "Identifier" && declaration.kind === "const" && functionKinds.has(node.init?.type) ? functionByNode.get(node.init) : null, initEnd: node.end });
    }
    if (node.type === "ImportDeclaration") for (const spec of node.specifiers) {
      const importedName = spec.type === "ImportDefaultSpecifier" ? "default" : spec.type === "ImportSpecifier" ? string(spec.imported) : null;
      bind(root, spec.local, { importedName, specifier: node.source.value, importNode: spec });
    }
  }
  // Any syntactic write anywhere invalidates that exact resolved binding, not a same-named outer symbol.
  for (const { node, ancestors } of entries) {
    const written = node.type === "AssignmentExpression" ? identifiers(node.left) : node.type === "UpdateExpression" ? identifiers(node.argument)
      : ["ForInStatement", "ForOfStatement"].includes(node.type) && node.left.type !== "VariableDeclaration" ? identifiers(node.left) : [];
    for (const id of written) for (const binding of lookup(nearest(ancestors), id.name)) binding.written = true;
  }
  if (dynamicScope) addGap(material, "javascript", "JAVASCRIPT_DYNAMIC_SCOPE_UNSUPPORTED");
  const property = (subject, predicate, value, at) => addFact({ subject, predicate, value: { datatype: "string", value }, material, anchor: textAnchor(text, at.start, at.end) });
  for (const scope of scopes.values()) for (const bindings of scope.bindings.values()) for (const binding of bindings) {
    if (binding.target) binding.factId = property(binding.target, "bindingName", binding.name, binding.id);
    if (binding.importNode) {
      binding.object = addObject(material, "IMPORT", binding.name, textAnchor(text, binding.importNode.start, binding.importNode.end));
      binding.nameFactId = property(binding.object, "name", binding.name, binding.importNode.local);
      binding.pathFactId = property(binding.object, "path", binding.specifier, binding.importNode);
      if (binding.importedName) binding.importFactId = property(binding.object, "importedName", binding.importedName, binding.importNode);
    }
  }
  const exports = [];
  const exportBinding = (binding, exportedName, at) => {
    if (!binding?.target || binding.written || dynamicScope) { addGap(material, "javascript", "JAVASCRIPT_EXPORT_UNRESOLVED", textAnchor(text, at.start, at.end)); return; }
    exports.push({ name: exportedName, target: binding.target, factId: property(binding.target, "exportedName", exportedName, at) });
  };
  for (const statement of ast.body) {
    if (["ExportAllDeclaration", "ExportNamedDeclaration"].includes(statement.type) && statement.source) { addGap(material, "javascript", "JAVASCRIPT_REEXPORT_UNSUPPORTED", textAnchor(text, statement.start, statement.end)); continue; }
    if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement.declaration;
      const ids = declaration?.type === "VariableDeclaration" ? declaration.declarations.flatMap(d => identifiers(d.id)) : declaration?.id ? [declaration.id] : [];
      for (const id of ids) { const matches = lookup(root, id.name); exportBinding(matches.length === 1 ? matches[0] : null, id.name, id); }
      for (const spec of statement.specifiers) { const matches = lookup(root, string(spec.local)); exportBinding(matches.length === 1 ? matches[0] : null, string(spec.exported), spec); }
    }
    if (statement.type === "ExportDefaultDeclaration") {
      const node = statement.declaration;
      if (functionKinds.has(node.type)) exportBinding({ target: functionByNode.get(node), written: node.id ? lookup(root, node.id.name).some(b => b.written) : false }, "default", node);
      else if (node.type === "Identifier") { const matches = lookup(root, node.name); exportBinding(matches.length === 1 ? matches[0] : null, "default", node); }
      else addGap(material, "javascript", "JAVASCRIPT_EXPORT_UNRESOLVED", textAnchor(text, node.start, node.end));
    }
  }
  const importedCalls = [];
  for (const { node, ancestors } of callEntries) {
    const caller = [...ancestors].reverse().map(n => functionByNode.get(n)).find(Boolean);
    const anchor = textAnchor(text, node.start, node.end), name = node.callee.type === "Identifier" ? node.callee.name : "[dynamic call]";
    const occurrence = addObject(material, "JAVASCRIPT_CALL", name, anchor);
    occurrence.parentId = caller?.objectId ?? material.root.objectId;
    const callFactId = property(occurrence, "name", name, node.callee);
    if (!caller || node.callee.type !== "Identifier" || node.optional || dynamicScope) { addGap(material, "javascript", "JAVASCRIPT_CALL_UNSUPPORTED", anchor); continue; }
    const matches = lookup(nearest(ancestors), name);
    if (matches.length !== 1) { addGap(material, "javascript", matches.length ? "JAVASCRIPT_BINDING_AMBIGUOUS" : "JAVASCRIPT_BINDING_UNRESOLVED", anchor); continue; }
    const binding = matches[0];
    if (binding.written) { addGap(material, "javascript", "JAVASCRIPT_BINDING_MUTABLE", anchor); continue; }
    if (binding.target) {
      if (node.start < binding.initEnd) { addGap(material, "javascript", "JAVASCRIPT_BINDING_INITIALIZATION_UNPROVEN", anchor); continue; }
      addFact({ subject: caller, predicate: "staticCalls", target: binding.target, basis: "DERIVED", material, anchor, premiseFactIds: [callFactId, binding.factId] });
    } else if (binding.importedName) importedCalls.push({ material, caller, anchor, callFactId, binding });
    else addGap(material, "javascript", "JAVASCRIPT_BINDING_UNRESOLVED", anchor);
  }
  const entriesByNode = new Map(entries.map(e => [e.node, e]));
  const module = { material, exports, importedCalls, dynamicScope,
    entries,
    bindingAt: (node, name) => { const entry = entriesByNode.get(node); const matches = entry ? lookup(nearest(entry.ancestors), name) : []; return matches.length === 1 ? matches[0] : null; },
    topBinding: name => { const matches = lookup(root, name); return matches.length === 1 ? matches[0] : null; } };
  modules.push(module); return module;
}

export function resolveJavaScriptModules({ modules, materialByLocation, addFact, addGap }) {
  const byMaterial = new Map(modules.map(m => [m.material.materialId, m]));
  for (const module of modules) for (const call of module.importedCalls) {
    const specifier = call.binding.specifier;
    if (!/^\.\.?\//.test(specifier) || /[\u0000-\u001f\u007f\\?#]/.test(specifier)) { addGap(call.material, "javascript", "JAVASCRIPT_IMPORT_OUT_OF_SCOPE", call.anchor); continue; }
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(call.material.displayPath), specifier));
    if (base === ".." || base.startsWith("../")) { addGap(call.material, "javascript", "JAVASCRIPT_IMPORT_OUT_OF_SCOPE", call.anchor); continue; }
    const paths = path.posix.extname(base) ? [base] : [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`];
    const materials = paths.map(p => materialByLocation.get(`${call.material.componentId}\u0000${p}`)).filter(Boolean);
    if (materials.length !== 1) { addGap(call.material, "javascript", materials.length ? "JAVASCRIPT_MODULE_AMBIGUOUS" : "JAVASCRIPT_IMPORT_UNRESOLVED", call.anchor); continue; }
    const targets = byMaterial.get(materials[0].materialId)?.exports.filter(e => e.name === call.binding.importedName) ?? [];
    if (targets.length !== 1) { addGap(call.material, "javascript", targets.length ? "JAVASCRIPT_EXPORT_AMBIGUOUS" : "JAVASCRIPT_IMPORT_UNRESOLVED", call.anchor); continue; }
    const exported = targets[0];
    addFact({ subject: call.caller, predicate: "staticCalls", target: exported.target, basis: "DERIVED", material: call.material, anchor: call.anchor,
      premiseFactIds: [call.callFactId, call.binding.nameFactId, call.binding.pathFactId, call.binding.importFactId, exported.factId] });
  }
}
