import { fullAncestor } from "acorn-walk";

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const literal = node => node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
const member = node => node?.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier"
  ? { receiver: node.object.name, method: node.property.name } : null;
const supportedPath = value => typeof value === "string" && value.startsWith("/") && !/[\u0000-\u0020\u007f?#*+()[\]{}!\\]/.test(value) && !value.includes("//")
  && value.split("/").every(segment => !segment.includes(":") || /^:[A-Za-z_$][\w$]*$/.test(segment));
const combine = (prefix, value) => prefix ? prefix.replace(/\/$/, "") + value : value;

// Only direct top-level, same-module, immutable factory and handler declarations.
// Paths are conditioned source declarations; no HTTP server is started here.
export function extractExpressStatic({ ast, material, text, limits, bindings, textAnchor, addObject, addFact, addGap }) {
  const gap = (code, node) => addGap(material, "express", code, node ? textAnchor(text, node.start, node.end) : null);
  if (!bindings || bindings.dynamicScope) { gap("EXPRESS_BINDING_ANALYSIS_UNSUPPORTED"); return; }
  const factoryNames = new Set(ast.body.filter(n => n.type === "ImportDeclaration" && n.source.value === "express").flatMap(n => n.specifiers.map(s => s.local.name)));
  if (!factoryNames.size) return;
  const declarations = ast.body.flatMap(s => { const d = s.type === "ExportNamedDeclaration" ? s.declaration : s; return d?.type === "VariableDeclaration" ? d.declarations.map(node => ({ node, kind: d.kind })) : []; });
  const calls = [];
  const allNodes = [];
  fullAncestor(ast, (node, _state, ancestors) => { allNodes.push(node); if (node.type === "CallExpression") calls.push({ node, ancestors: [...ancestors] }); });
  if (declarations.length + calls.length > (limits.maxExpressDeclarations ?? 2000)) { gap("EXPRESS_DECLARATIONS_LIMIT"); return; }
  const routers = new Map(), mounts = [], routes = [];
  const baseName = node => node?.type === "Identifier" ? node.name : node?.type === "MemberExpression" ? baseName(node.object) : null;
  const assignments = allNodes.filter(n => n.type === "AssignmentExpression" || n.type === "UpdateExpression" || n.type === "UnaryExpression" && n.operator === "delete");
  const referenced = (node, names) => {
    const found = new Set();
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (value.type === "Identifier" && names.has(value.name)) found.add(value.name);
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === "object") visit(child);
    };
    visit(node); return found;
  };
  for (const assignment of assignments) {
    const left = assignment.left ?? assignment.argument, name = left?.type === "MemberExpression" ? baseName(left) : null;
    if (name && bindings.topBinding(name)?.specifier === "express") { gap("EXPRESS_FACTORY_MUTATION_UNSUPPORTED", assignment); return; }
  }
  for (const node of allNodes) {
    const escaped = ["CallExpression", "NewExpression"].includes(node.type) ? node.arguments.some(argument => referenced(argument, factoryNames).size)
      : node.type === "VariableDeclarator" ? referenced(node.init?.type === "Identifier" ? node.init : null, factoryNames).size : false;
    if (escaped) { gap("EXPRESS_FACTORY_ESCAPE_UNSUPPORTED", node); return; }
  }
  const property = (object, predicate, value, node, basis = "DECLARED", premiseFactIds = []) => addFact({ subject: object, predicate, value: { datatype: "string", value }, material,
    anchor: textAnchor(text, node.start, node.end), basis, premiseFactIds });
  for (const { node, kind } of declarations) {
    if (node.id.type !== "Identifier" || node.init?.type !== "CallExpression") continue;
    const factory = member(node.init.callee), factoryName = factory?.receiver ?? (node.init.callee.type === "Identifier" ? node.init.callee.name : null);
    const imported = factoryName ? bindings.topBinding(factoryName) : null;
    if (imported?.specifier !== "express") continue;
    const isApp = !factory && imported.importNode?.type === "ImportDefaultSpecifier", isRouter = factory?.method === "Router"
      && ["ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(imported.importNode?.type) || !factory && imported.importedName === "Router";
    if (!isApp && !isRouter) continue;
    const own = bindings.topBinding(node.id.name);
    if (imported.written || own?.written || kind !== "const") { gap("EXPRESS_BINDING_MUTABLE", node); continue; }
    if (!own || node.init.arguments.length || node.init.optional) { gap("EXPRESS_FACTORY_OPTIONS_UNSUPPORTED", node); continue; }
    const object = addObject(material, "EXPRESS_ROUTER", node.id.name, textAnchor(text, node.start, node.end));
    const nameId = property(object, "name", node.id.name, node.id), kindId = property(object, "routerKind", isApp ? "application" : "router", node.init);
    routers.set(node.id.name, { object, nameId, kindId, isApp, end: node.end });
  }
  for (const assignment of assignments) {
    const left = assignment.left ?? assignment.argument, router = left?.type === "MemberExpression" ? routers.get(baseName(left)) : null;
    if (router) { router.blocked = true; gap("EXPRESS_RECEIVER_MUTATION_UNSUPPORTED", assignment); }
  }
  for (const node of allNodes) if (node.type === "VariableDeclarator" && node.init?.type === "Identifier" && routers.has(node.init.name)) {
    routers.get(node.init.name).blocked = true; gap("EXPRESS_RECEIVER_ESCAPE_UNSUPPORTED", node);
  }
  const routerNames = new Set(routers.keys());
  for (const node of allNodes.filter(n => ["CallExpression", "NewExpression"].includes(n.type))) {
    const called = member(node.callee), validMount = called?.method === "use" && routers.has(called.receiver) && node.arguments.length === 2 && supportedPath(literal(node.arguments[0]));
    for (const [index, argument] of node.arguments.entries()) for (const name of referenced(argument, routerNames)) if (!(validMount && index === 1 && argument.type === "Identifier")) {
      routers.get(name).blocked = true; gap("EXPRESS_RECEIVER_ESCAPE_UNSUPPORTED", node);
    }
  }
  for (const node of allNodes) if (node.type === "ReturnStatement") for (const name of referenced(node.argument, routerNames)) {
    routers.get(name).blocked = true; gap("EXPRESS_RECEIVER_ESCAPE_UNSUPPORTED", node);
  }
  for (const { node, ancestors } of calls) {
    const called = member(node.callee), parent = called ? routers.get(called.receiver) : null;
    if (!parent || parent.blocked || !["use", ...methods].includes(called.method)) continue;
    if (ancestors.length !== 3 || ancestors[1].type !== "ExpressionStatement" || node.optional) { gap("EXPRESS_SETUP_SCOPE_UNSUPPORTED", node); continue; }
    if (node.start < parent.end) { gap("EXPRESS_INITIALIZATION_UNPROVEN", node); continue; }
    const path = literal(node.arguments[0]);
    if (!supportedPath(path) || node.arguments.length !== 2) { gap("EXPRESS_PATH_OR_MIDDLEWARE_UNSUPPORTED", node); continue; }
    if (called.method === "use") {
      const child = node.arguments[1].type === "Identifier" ? routers.get(node.arguments[1].name) : null;
      if (!child || child.blocked || child.isApp || node.start < child.end) { gap("EXPRESS_MOUNT_TARGET_UNSUPPORTED", node); continue; }
      const object = addObject(material, "EXPRESS_MOUNT", path, textAnchor(text, node.start, node.end)); object.parentId = parent.object.objectId;
      const prefixId = property(object, "path", path, node.arguments[0]);
      const factId = addFact({ subject: parent.object, predicate: "mountsRouter", target: child.object, basis: "DERIVED", material, anchor: object.anchor,
        premiseFactIds: [parent.nameId, parent.kindId, child.nameId, child.kindId, prefixId] });
      mounts.push({ parent, child, path, factId, node });
    } else {
      const object = addObject(material, "ROUTE", `${called.method.toUpperCase()} ${path}`, textAnchor(text, node.start, node.end)); object.parentId = parent.object.objectId;
      const pathId = property(object, "path", path, node.arguments[0]), methodId = property(object, "httpMethod", called.method.toUpperCase(), node.callee.property);
      const handler = node.arguments[1].type === "Identifier" ? bindings.topBinding(node.arguments[1].name) : null;
      if (handler?.target && !handler.written && handler.factId && node.start >= handler.initEnd) addFact({ subject: handler.target, predicate: "handlesRoute", target: object, basis: "DERIVED", material,
        anchor: object.anchor, premiseFactIds: [handler.factId, pathId, methodId, parent.nameId, parent.kindId] });
      else gap("EXPRESS_HANDLER_UNRESOLVED", node);
      routes.push({ parent, object, path, pathId, node });
    }
  }
  const outgoing = router => mounts.filter(m => m.parent === router);
  let invalid = false, expanded = [];
  const visited = new Set(), visiting = new Set();
  const detect = (router, depth) => {
    if (visiting.has(router)) { invalid = true; gap("EXPRESS_MOUNT_CYCLE"); return; }
    if (visited.has(router)) return;
    if (depth > (limits.maxExpressMountDepth ?? 16)) { invalid = true; gap("EXPRESS_EXPANSION_LIMIT"); return; }
    visiting.add(router); for (const mount of outgoing(router)) detect(mount.child, depth + 1); visiting.delete(router); visited.add(router);
  };
  for (const router of routers.values()) detect(router, 0);
  if (invalid) return;
  let steps = 0;
  const expand = (root, router, prefix, chain, depth) => {
    steps += 1;
    if (steps > (limits.maxExpressPaths ?? 128) || depth > (limits.maxExpressMountDepth ?? 16)) { invalid = true; return; }
    for (const route of routes.filter(r => r.parent === router)) {
      expanded.push({ route, value: combine(prefix, route.path), premises: [root.nameId, root.kindId, route.pathId, ...chain] });
      if (expanded.length > (limits.maxExpressPaths ?? 128)) invalid = true;
    }
    if (invalid) return;
    for (const mount of outgoing(router)) { expand(root, mount.child, combine(prefix, mount.path), [...chain, mount.factId], depth + 1); if (invalid) return; }
  };
  for (const root of routers.values()) if (root.isApp && !root.blocked) { expand(root, root, "", [], 0); if (invalid) break; }
  if (invalid) { gap("EXPRESS_EXPANSION_LIMIT"); expanded = []; }
  for (const record of expanded) property(record.route.object, "effectivePath", record.value, record.route.node, "DERIVED", record.premises);
  if (!invalid) for (const route of routes) if (!expanded.some(e => e.route === route)) gap("EXPRESS_ROUTER_NOT_MOUNTED", route.node);
}
