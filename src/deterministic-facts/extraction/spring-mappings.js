// Direct, explicitly bound annotations only. No bean loading, meta-annotation
// interpretation, classpath lookup, inherited mappings or deployed URL claim.
const prefix = "org.springframework.web.bind.annotation.";
const shortcuts = new Map([["GetMapping", "GET"], ["PostMapping", "POST"], ["PutMapping", "PUT"], ["PatchMapping", "PATCH"], ["DeleteMapping", "DELETE"]]);
const verbs = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]);
const controllerNames = new Set([`${prefix}RestController`, "org.springframework.stereotype.Controller"]);
const mappings = new Set([`${prefix}RequestMapping`, ...[...shortcuts.keys()].map(n => prefix + n)]);
const qualifiedNames = new Set([...controllerNames, ...mappings, `${prefix}RequestMethod`]);
const children = node => node?.children().filter(n => n.isNamed() && !["line_comment", "block_comment"].includes(n.kind())) ?? [];
const values = node => node?.kind() === "element_value_array_initializer" ? children(node) : node ? [node] : [];
const joined = (base, suffix) => {
  const leading = path => path && !path.startsWith("/") ? "/" + path : path;
  return (suffix ? leading(base).replace(/\/$/, "") + leading(suffix) : leading(base)) || "/";
};
const validPath = path => typeof path === "string" && !/[\s\u0000-\u001f\u007f\\?#*$]/.test(path) && !path.includes("//")
  && path.split("/").every(part => !/[{}]/.test(part) || /^\{[A-Za-z_$][\w$]*\}$/.test(part));

export function extractSpringMappings({ material, limits, types, methods, annotations, imports, text, textAnchor, addObject, addFact, addGap }) {
  const anchor = node => { const r = node.range(); return textAnchor(text, r.start.index, r.end.index); };
  const prop = (object, predicate, value, node, basis = "DECLARED", premiseFactIds = [], datatype = "string") => addFact({ subject: object, predicate, value: { datatype, value }, material, anchor: anchor(node), basis, premiseFactIds });
  const gap = (code, node) => addGap(material, "java", code, anchor(node));
  const resolve = name => {
    if ([...types.values()].some(t => t.object.name === name.split(".")[0])) return null;
    if (qualifiedNames.has(name)) return { name, ids: [] };
    const candidates = imports.filter(i => i.kind === "TYPE" && i.name.split(".").at(-1) === name);
    return candidates.length === 1 && qualifiedNames.has(candidates[0].name) ? { name: candidates[0].name, ids: [candidates[0].pathFact, candidates[0].kindFact] } : null;
  };
  const bound = new Map();
  for (const annotation of annotations) {
    const binding = resolve(annotation.object.name);
    if (binding && (controllerNames.has(binding.name) || mappings.has(binding.name))) bound.set(annotation.object.objectId, { ...annotation, qualified: binding.name,
      bindingFact: prop(annotation.object, "annotationType", binding.name, annotation.node, "DERIVED", [annotation.nameFact, ...binding.ids]) });
  }
  const parse = (annotation, classLevel = false) => {
    const args = children(annotation.node.field("arguments")), attrs = new Map();
    for (const node of args) {
      const key = node.kind() === "element_value_pair" ? node.field("key")?.text() : "value", value = node.kind() === "element_value_pair" ? node.field("value") : node;
      if (!key || attrs.has(key) || !["value", "path", "method"].includes(key) || (classLevel && key === "method")) { gap("SPRING_CONDITION_UNSUPPORTED", node); return null; }
      attrs.set(key, value);
    }
    if (attrs.has("path") && attrs.has("value")) { gap("SPRING_ALIAS_CONFLICT", annotation.node); return null; }
    const paths = [], methods = [], pathNode = attrs.get("path") ?? attrs.get("value");
    if (!pathNode) paths.push({ value: "", id: prop(annotation.object, "mappingDefaultPath", true, annotation.node, "DECLARED", [], "boolean") });
    else {
      const literalNodes = values(pathNode);
      if (!literalNodes.length || literalNodes.length > (limits.maxSpringValues ?? 128)) { gap("SPRING_MAPPING_LIMIT", pathNode); return null; }
      for (const node of literalNodes) {
        let value; try { if (node.kind() !== "string_literal") throw new Error("not a literal"); value = JSON.parse(node.text()); } catch { gap("SPRING_MAPPING_UNRESOLVED", node); return null; }
        if (!validPath(value)) { gap("SPRING_PATH_PATTERN_UNSUPPORTED", node); return null; }
        paths.push({ value, id: prop(annotation.object, "mappingPath", value, node) });
      }
    }
    const simple = annotation.qualified.slice(prefix.length), shortcut = shortcuts.get(simple), methodNode = attrs.get("method");
    if (shortcut) {
      if (methodNode) { gap("SPRING_CONDITION_UNSUPPORTED", methodNode); return null; }
      methods.push({ value: shortcut, id: prop(annotation.object, "mappingMethod", shortcut, annotation.node, "DERIVED", [annotation.bindingFact]) });
    } else if (!classLevel) {
      if (!methodNode) {
        const defaultFact = prop(annotation.object, "mappingDefaultMethod", true, annotation.node, "DECLARED", [], "boolean");
        methods.push({ value: "ANY", id: prop(annotation.object, "mappingMethod", "ANY", annotation.node, "DERIVED", [annotation.bindingFact, defaultFact]) });
      } else {
        const nodes = values(methodNode); if (!nodes.length || nodes.length > (limits.maxSpringValues ?? 128)) { gap("SPRING_MAPPING_LIMIT", methodNode); return null; }
        for (const node of nodes) {
          const receiver = node.field("object")?.text(), verb = node.field("field")?.text(), binding = receiver ? resolve(receiver) : null;
          if (node.kind() !== "field_access" || binding?.name !== prefix + "RequestMethod" || !verbs.has(verb)) { gap("SPRING_MAPPING_METHOD_UNRESOLVED", node); return null; }
          const ref = prop(annotation.object, "mappingMethodReference", node.text(), node);
          methods.push({ value: verb, id: prop(annotation.object, "mappingMethod", verb, node, "DERIVED", [ref, ...binding.ids]) });
        }
      }
    }
    return { annotation, paths, methods };
  };
  const plans = []; let count = 0;
  for (const type of types.values()) {
    const owned = annotations.filter(a => a.owner.objectId === type.object.objectId), controller = owned.map(a => bound.get(a.object.objectId)).filter(a => a && controllerNames.has(a.qualified));
    const ownMethods = methods.filter(m => m.owner.object.objectId === type.object.objectId && m.object.kind === "JAVA_METHOD");
    const methodMappings = method => annotations.filter(a => a.owner.objectId === method.object.objectId && /Mapping$/.test(a.object.name));
    if (!ownMethods.some(m => methodMappings(m).length)) continue;
    if (type.hasInheritance || type.node.kind() !== "class_declaration" || type.object.parentId !== material.root.objectId) { gap("SPRING_CONTROLLER_SCOPE_UNSUPPORTED", type.node); continue; }
    if (controller.length !== 1) { gap("SPRING_CONTROLLER_UNPROVEN", type.node); continue; }
    const bases = owned.filter(a => /Mapping$/.test(a.object.name));
    if (bases.length > 1 || (bases.length && bound.get(bases[0].object.objectId)?.qualified !== prefix + "RequestMapping")) { gap("SPRING_MAPPING_UNRESOLVED", type.node); continue; }
    const base = bases.length ? parse(bound.get(bases[0].object.objectId), true) : { paths: [{ value: "", id: prop(type.object, "mappingClassAbsent", true, type.node, "DECLARED", [], "boolean") }], annotation: null };
    if (!base) continue;
    for (const method of ownMethods) {
      const candidates = methodMappings(method); if (!candidates.length) continue;
      if (candidates.length !== 1) { gap("SPRING_MAPPING_AMBIGUOUS", method.node); continue; }
      const annotation = bound.get(candidates[0].object.objectId);
      if (!annotation || !mappings.has(annotation.qualified)) { gap("SPRING_MAPPING_UNRESOLVED", candidates[0].node); continue; }
      const child = parse(annotation); if (!child) continue;
      count += base.paths.length * child.paths.length * child.methods.length;
      if (count > (limits.maxSpringPaths ?? 128)) { gap("SPRING_MAPPING_LIMIT", annotation.node); return; }
      plans.push({ method, type, controller: controller[0], base, child });
    }
  }
  for (const { method, type, controller, base, child } of plans) {
    const combinations = base.paths.flatMap(b => child.paths.flatMap(p => child.methods.map(m => ({ b, p, m, path: joined(b.value, p.value) }))));
    const label = combinations.length === 1 ? `${combinations[0].m.value} ${combinations[0].path}` : `Spring mapping ${method.object.name}`;
    const route = addObject(material, "ROUTE", label, anchor(child.annotation.node)); route.parentId = child.annotation.object.objectId;
    const context = [controller.bindingFact, type.inherited, child.annotation.bindingFact];
    addFact({ subject: method.object, predicate: "handlesRoute", target: route, material, anchor: anchor(child.annotation.node), basis: "DERIVED", premiseFactIds: [method.nameFact, ...context] });
    for (const { b, p, m, path } of combinations) {
      prop(route, "path", path, child.annotation.node, "DERIVED", [...context, b.id, p.id, m.id, ...(base.annotation ? [base.annotation.bindingFact] : [])]);
      prop(route, "httpMethod", m.value, child.annotation.node, "DERIVED", [child.annotation.bindingFact, m.id]);
    }
  }
}
