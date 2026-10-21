// Tree-sitter declaration syntax only. No class loading, classpath, execution,
// inheritance/type inference or name-only overload selection.
const typeKinds = new Set(["class_declaration", "interface_declaration", "record_declaration", "enum_declaration", "annotation_type_declaration"]);
const methodKinds = new Set(["method_declaration", "constructor_declaration"]);
const compact = text => text.replace(/\s+/g, "");
import { extractSpringMappings } from "./spring-mappings.js";
import { extractJavaTests } from "./test-assets.js";

export function extractJavaDeclarations({ root, material, text, limits, textAnchor, addObject, addFact, addGap, testReferences }) {
  if (/\\u+[0-9a-fA-F]{4}/.test(text)) { addGap(material, "java", "JAVA_UNICODE_ESCAPE_UNSUPPORTED"); return; }
  const nodes = [], pending = [root];
  while (pending.length) {
    const node = pending.pop(); nodes.push(node);
    if (nodes.length > (limits.maxJavaNodes ?? 20_000)) { addGap(material, "java", "JAVA_AST_LIMIT"); return; }
    const range = node.range();
    if (node.kind() === "ERROR" || (node !== root && range.start.index === range.end.index)) { addGap(material, "java", "JAVA_PARSE_FAILED"); return; }
    pending.push(...node.children().reverse());
  }
  const named = nodes.filter(n => n.isNamed()), declarations = new Map(), objectsById = new Map(), types = new Map(), methods = [], annotations = [], imports = [], fieldsByNode = new Map();
  const anchor = node => { const r = node.range(); return textAnchor(text, r.start.index, r.end.index); };
  const typeAnnotation = named.find(n => ["annotation", "marker_annotation"].includes(n.kind()) && n.parent()?.kind() !== "modifiers");
  if (typeAnnotation) { addGap(material, "java", "JAVA_TYPE_ANNOTATION_UNSUPPORTED", anchor(typeAnnotation)); return; }
  const property = (object, predicate, value, node, datatype = "string") => addFact({ subject: object, predicate, value: { datatype, value }, material, anchor: anchor(node) });
  const crossBindings = limits.javaBindings === "component-static-zero-v1";
  const declarationConditions = (object, node) => {
    if (!crossBindings) return;
    const modifiers = node.children().find(n => n.kind() === "modifiers");
    const visibility = modifiers?.children().map(n => n.kind()).find(k => ["public", "private", "protected"].includes(k)) ?? "package";
    property(object, "visibility", visibility.toUpperCase(), modifiers ?? node);
    property(object, "hasTypeParameters", !!node.field("type_parameters"), node, "boolean");
  };
  const nearest = node => node.ancestors().map(n => declarations.get(n.id())).find(Boolean)?.object ?? material.root;
  const create = (node, kind, name, parent = nearest(node), sourceName = name, nameNode = node) => {
    const object = addObject(material, kind, name, anchor(node)); object.parentId = parent.objectId;
    objectsById.set(object.objectId, object);
    const nameFact = property(object, "name", sourceName, nameNode);
    declarations.set(node.id(), { node, object, nameFact }); return object;
  };
  const packageNodes = named.filter(n => n.kind() === "package_declaration");
  if (packageNodes.length > 1) { addGap(material, "java", "JAVA_PACKAGE_AMBIGUOUS"); return; }
  let packageName = "";
  for (const node of packageNodes) {
    const identifier = node.children().find(n => ["identifier", "scoped_identifier"].includes(n.kind()));
    if (!identifier) { addGap(material, "java", "JAVA_PARSE_FAILED", anchor(node)); return; }
    packageName = compact(identifier.text()); create(node, "JAVA_PACKAGE", packageName, material.root);
    property(material.root, "packageName", packageName, node);
  }
  if (crossBindings && !packageNodes.length) property(material.root, "packageName", "", root);
  for (const node of named.filter(n => typeKinds.has(n.kind()))) {
    const name = node.field("name")?.text(); if (!name) continue;
    const object = create(node, "JAVA_TYPE", name), owner = node.ancestors().map(n => types.get(n.id())).find(Boolean);
    const qualified = `${owner?.qualified ?? packageName}${owner || packageName ? "." : ""}${name}`;
    const hasInheritance = !!node.field("superclass") || !!node.field("interfaces") || node.kind() === "interface_declaration";
    const inherited = property(object, "hasInheritance", hasInheritance, node, "boolean");
    property(object, "qualifiedName", qualified, node); property(object, "type", node.kind().replace(/_declaration$/, ""), node);
    declarationConditions(object, node);
    types.set(node.id(), { node, object, qualified, hasInheritance, inherited });
  }
  // Rebind local types after methods are known; global traversal order must
  // not flatten a type declared inside a method onto its enclosing class.
  for (const node of named.filter(n => methodKinds.has(n.kind()))) {
    const name = node.field("name")?.text(); if (!name) continue;
    if (node.ancestors().some(n => n.kind() === "class_body" && n.parent()?.kind() === "object_creation_expression")) {
      addGap(material, "java", "JAVA_DECLARATION_OWNER_UNSUPPORTED", anchor(node)); continue;
    }
    const owner = node.ancestors().map(n => types.get(n.id())).find(Boolean);
    if (!owner) { addGap(material, "java", "JAVA_DECLARATION_OWNER_UNSUPPORTED", anchor(node)); continue; }
    const object = create(node, node.kind() === "constructor_declaration" ? "JAVA_CONSTRUCTOR" : "JAVA_METHOD", `${owner.object.name}#${name}`, owner.object, name, node.field("name"));
    const nameFact = declarations.get(node.id()).nameFact;
    const modifiers = node.children().find(n => n.kind() === "modifiers");
    const isStatic = !!modifiers?.children().some(n => n.kind() === "static");
    const staticFact = property(object, "staticModifier", isStatic, modifiers ?? node, "boolean");
    declarationConditions(object, node);
    if (node.field("type")) property(object, "type", compact(node.field("type").text()), node.field("type"));
    const parameters = node.field("parameters")?.children().filter(n => ["formal_parameter", "spread_parameter", "receiver_parameter"].includes(n.kind())) ?? [];
    const method = { node, object, name, nameFact, owner, isStatic, staticFact, parameters, signatureTypes: [] }; methods.push(method);
  }
  for (const { node, object } of declarations.values()) if (typeKinds.has(node.kind())) object.parentId = nearest(node).objectId;
  const addParameters = (owner, nodes, signatureTypes = []) => {
    for (const [index, node] of nodes.entries()) {
      const declarator = node.children().find(n => n.kind() === "variable_declarator");
      const nameNode = node.field("name") ?? declarator?.field("name"), typeNode = node.field("type") ?? node.children().find(n => /(?:type|type_identifier)$/.test(n.kind()));
      if (!nameNode || !typeNode || node.kind() === "receiver_parameter") { addGap(material, "java", "JAVA_PARAMETER_SYNTAX_UNSUPPORTED", anchor(node)); continue; }
      const name = nameNode.text(), object = create(node, "JAVA_PARAMETER", name, owner);
      const dimensions = node.field("dimensions")?.text() ?? declarator?.field("dimensions")?.text() ?? "";
      const type = compact(typeNode.text() + dimensions) + (node.kind() === "spread_parameter" ? "..." : "");
      signatureTypes.push(type); property(object, "type", type, typeNode); property(object, "parameterIndex", index, node, "integer");
      addFact({ subject: owner, predicate: "declaresParameter", target: object, material, anchor: anchor(node) });
    }
    return signatureTypes;
  };
  for (const method of methods) {
    addParameters(method.object, method.parameters, method.signatureTypes);
    if (method.signatureTypes.length === method.parameters.length) property(method.object, "signature", `${method.name}(${method.signatureTypes.join(",")})`, method.node.field("parameters") ?? method.node);
  }
  for (const type of types.values()) if (type.node.kind() === "record_declaration") {
    addParameters(type.object, type.node.field("parameters")?.children().filter(n => n.kind() === "formal_parameter") ?? []);
  }
  for (const node of named.filter(n => n.kind() === "field_declaration")) {
    const owner = nearest(node), type = node.field("type");
    const fieldObjects = []; fieldsByNode.set(node.id(), fieldObjects);
    for (const declared of node.children().filter(n => n.kind() === "variable_declarator")) {
      const name = declared.field("name"); if (!name || !type) continue;
      const object = create(declared, "JAVA_FIELD", name.text(), owner);
      fieldObjects.push(object);
      property(object, "type", compact(type.text() + (declared.field("dimensions")?.text() ?? "")), type);
    }
  }
  for (const node of named.filter(n => ["annotation", "marker_annotation"].includes(n.kind()))) {
    const name = node.field("name")?.text(); if (!name) continue;
    const field = node.ancestors().find(n => n.kind() === "field_declaration");
    const fieldOwners = field ? fieldsByNode.get(field.id()) : null;
    const owner = fieldOwners ? fieldOwners.length === 1 ? fieldOwners[0] : null : nearest(node);
    if (!owner || owner.kind === "MATERIAL" || node.parent()?.kind() !== "modifiers") { addGap(material, "java", "JAVA_ANNOTATION_OWNER_UNSUPPORTED", anchor(node)); continue; }
    const object = create(node, "JAVA_ANNOTATION", compact(name), owner), nameFact = property(object, "annotationName", compact(name), node.field("name"));
    annotations.push({ node, object, owner, nameFact });
    if (/(?:^|\.)(?:Request|Get|Post|Put|Patch|Delete)Mapping$/.test(name)) {
      if (limits.springMappings !== "ast-literals-v1") addGap(material, "java", "SPRING_MAPPING_NOT_CONFIGURED", anchor(node));
    } else if (node.field("arguments") && !(limits.testAssets === "framework-declarations-v1" && /(?:^|\.)Test$/.test(name))) addGap(material, "java", "JAVA_ANNOTATION_ARGUMENTS_NOT_INTERPRETED", anchor(node));
  }
  for (const node of named.filter(n => n.kind() === "import_declaration")) {
    const target = node.children().find(n => ["identifier", "scoped_identifier"].includes(n.kind())); if (!target) continue;
    const wildcard = node.children().some(n => n.kind() === "asterisk"), isStatic = node.children().some(n => n.kind() === "static");
    const name = compact(target.text()) + (wildcard ? ".*" : ""), object = create(node, "IMPORT", name, material.root);
    const pathFact = property(object, "path", name, target), kind = `${isStatic ? "STATIC" : "TYPE"}${wildcard ? "_WILDCARD" : ""}`, kindFact = property(object, "importKind", kind, node);
    imports.push({ node, object, name, kind, pathFact, kindFact });
    addFact({ subject: material.root, predicate: "imports", target: object, material, anchor: anchor(node) });
  }
  for (const { node, object } of declarations.values()) if (["JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR", "JAVA_FIELD"].includes(object.kind)) {
    const parent = objectsById.get(object.parentId) ?? material.root;
    addFact({ subject: parent, predicate: "declares", target: object, material, anchor: anchor(node) });
  }
  const methodsById = new Map(methods.map(m => [m.node.id(), m])), methodsByName = new Map();
  for (const m of methods) { const key = `${m.owner.object.objectId}:${m.name}`; if (!methodsByName.has(key)) methodsByName.set(key, []); methodsByName.get(key).push(m); }
  const shadowNames = new Set(named.filter(n => ["formal_parameter", "spread_parameter", "variable_declarator"].includes(n.kind())).map(n => (n.field("name") ?? n.children().find(c => c.kind() === "variable_declarator")?.field("name"))?.text()));
  for (const node of named.filter(n => n.kind() === "method_invocation")) {
    const chain = node.ancestors(), enclosing = chain.find(n => methodKinds.has(n.kind())), method = methodsById.get(enclosing?.id());
    const boundary = chain.some(n => n.kind() === "lambda_expression" || (n.kind() === "class_body" && n.parent()?.kind() === "object_creation_expression"));
    if (!method || boundary || !method.owner || method.object.parentId !== method.owner.object.objectId) { addGap(material, "java", "JAVA_INVOCATION_SCOPE_UNSUPPORTED", anchor(node)); continue; }
    const name = node.field("name")?.text(); if (!name) continue;
    const occurrence = create(node, "JAVA_CALL", name, method.object, name, node.field("name")), occurrenceName = declarations.get(node.id()).nameFact;
    const count = node.field("arguments")?.children().filter(n => n.isNamed() && !["line_comment", "block_comment"].includes(n.kind())).length ?? 0;
    const argumentFact = property(occurrence, "argumentCount", count, node.field("arguments") ?? node, "integer");
    const receiver = node.field("object")?.text() ?? ""; property(occurrence, "receiverName", receiver, node.field("object") ?? node);
    if (crossBindings) property(occurrence, "lexicalShadow", receiver ? shadowNames.has(receiver.split(".")[0])
      || named.some(n => (typeKinds.has(n.kind()) || n.kind() === "type_parameter") && n.field("name")?.text() === receiver.split(".")[0])
      || named.some(n => ["catch_formal_parameter", "enhanced_for_statement"].includes(n.kind()) || n.kind().includes("pattern")) : false, node, "boolean");
    const candidates = methodsByName.get(`${method.owner.object.objectId}:${name}`) ?? [];
    const shadowed = receiver && shadowNames.has(receiver);
    const target = candidates.length === 1 ? candidates[0] : null;
    if (count || !target?.isStatic || target.parameters.length || target.owner.hasInheritance || shadowed || (receiver && receiver !== target.owner.object.name)
      || target.owner.node.kind() !== "class_declaration"
      || (crossBindings && (target.node.field("type_parameters") || target.owner.node.field("type_parameters")))) {
      if (!crossBindings) addGap(material, "java", "JAVA_INVOCATION_UNRESOLVED", occurrence.anchor);
      continue;
    }
    addFact({ subject: method.object, predicate: "staticCalls", target: target.object, material, anchor: occurrence.anchor, basis: "DERIVED",
      premiseFactIds: [occurrenceName, argumentFact, target.nameFact, target.staticFact, target.owner.inherited] });
  }
  if (limits.springMappings === "ast-literals-v1") extractSpringMappings({ material, limits, types, methods, annotations, imports, text, textAnchor, addObject, addFact, addGap });
  if (limits.testAssets === "framework-declarations-v1") extractJavaTests({ material, text, limits, types, methods, annotations, imports, nodes: named, shadowNames,
    textAnchor, addObject, addFact, addGap, references: testReferences });
  return { types, methods, annotations };
}
