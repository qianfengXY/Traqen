import { Lang, parse } from "@ast-grep/napi";
import path from "node:path";
import { isSensitiveKey } from "../sensitive-content.js";
import { extractStaticSql } from "./static-sql.js";

const functionKinds = new Set(["function_declaration", "generator_function_declaration", "function_expression", "generator_function", "arrow_function", "method_definition", "method_declaration", "constructor_declaration", "lambda_expression"]);
const baseScopeKinds = new Set(["program", "statement_block", "block", "catch_clause", "for_statement", "for_in_statement", "with_statement", ...functionKinds]);
const javaTypeBodies = new Set(["class_body", "interface_body", "enum_body", "annotation_type_body"]);
const callKinds = new Set(["call_expression", "method_invocation", "object_creation_expression", "new_expression"]);
const writes = new Set(["assignment_expression", "augmented_assignment_expression", "update_expression"]);
const assertionMethods = new Set(["ok", "equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "throws", "doesNotThrow", "rejects", "doesNotReject", "ifError", "match", "doesNotMatch", "fail"]);
const named = node => node?.children().filter(child => child.isNamed()) ?? [];
const same = (left, right) => left && right && left.id() === right.id();
const safeName = value => typeof value === "string" && value.length <= 256 && /^[\p{L}_$][\p{L}\p{N}_$.-]*$/u.test(value) && !isSensitiveKey(value);
const ancestors = node => node.ancestors();
const nearest = (node, kinds) => ancestors(node).find(parent => kinds.has(parent.kind()));

function collect(root, limit) {
  const result = [], stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (result.length >= limit) return null;
    result.push(node);
    stack.push(...named(node).reverse());
  }
  return result;
}

function literalString(node) {
  if (!node) return null;
  const raw = node.text();
  // Decode only supported literal escapes, never evaluate or transpile code.
  if (node.kind() === "string_literal" || node.kind() === "string") {
    if (raw.startsWith('"')) { try { return JSON.parse(raw); } catch { return null; } }
    if (/^'[^'\\]*'$/.test(raw)) return raw.slice(1, -1);
  }
  if (node.kind() === "template_string" && /^`[^`\\$]*`$/.test(raw)) return raw.slice(1, -1);
  return null;
}

export function extractProgramLogic({ material, text, textAnchor, limits, addObject, addFact, addGap, sqlReferences, configReferences, technicalModules }) {
  if (material.kind === "JAVA" && /\\u+[0-9a-fA-F]{4}/.test(text)) { addGap(material, "program-logic", "JAVA_UNICODE_ESCAPE_UNSUPPORTED"); return; }
  const language = material.kind === "JAVA" ? "java" : /\.tsx$/i.test(material.displayPath) ? Lang.Tsx
    : material.kind === "TYPESCRIPT" ? Lang.TypeScript : Lang.JavaScript;
  const root = parse(language, text).root();
  const nodes = collect(root, limits.maxProgramNodes ?? 20_000);
  const anchor = node => { const range = node.range(); return textAnchor(text, range.start.index, range.end.index); };
  if (!nodes) { addGap(material, "program-logic", "PROGRAM_NODE_LIMIT"); return; }
  if (nodes.some(node => node.kind() === "ERROR" || (node !== root && node.range().start.index === node.range().end.index))) { addGap(material, "program-logic", "PROGRAM_PARSE_FAILED"); return; }
  const logicMaterial = { ...material, ruleRef: { id: "f002-program-logic", version: "1" } };
  const scopeKinds = material.kind === "JAVA" ? new Set([...baseScopeKinds, ...javaTypeBodies, "enhanced_for_statement", "try_with_resources_statement"]) : baseScopeKinds;
  const objects = new Map(), declarations = new Map(), declarationNodes = new Set(), branches = [], blockedScopes = new Set(), blockedNames = new Map();
  const inside = (node, outer) => outer && node.range().start.index >= outer.range().start.index && node.range().end.index <= outer.range().end.index;
  const fact = (subject, predicate, node, options) => addFact({ subject, predicate, material: logicMaterial, anchor: anchor(node), ...options });
  const make = (node, kind, name) => {
    const object = addObject(material, kind, name, anchor(node));
    const declaration = fact(object, "syntaxKind", node, { value: { datatype: "string", value: node.kind() } });
    const entry = { node, object, declaration };
    objects.set(`${kind}:${node.id()}`, entry);
    return entry;
  };
  const addBinding = (node, scope, target = null, visible = null) => {
    if (!node || !scope || !safeName(node.text())) return null;
    const binding = make(node, "LOGIC_BINDING", node.text());
    declarationNodes.add(node.id());
    const key = `${scope.id()}:${node.text()}`;
    if (!declarations.has(key)) declarations.set(key, []);
    const scopeFact = material.kind !== "JAVA" && limits.functionBindings === "initializer-proof-v1"
      ? fact(binding.object, "lexicalBindingScope", scope, { value: { datatype: "string", value: scope.kind() } }) : null;
    const entry = { ...binding, target, visible, scopeFact };
    declarations.get(key).push(entry);
    return entry;
  };
  const lookup = (node, name) => {
    for (const scope of [node, ...ancestors(node)].filter(candidate => scopeKinds.has(candidate.kind()))) {
      if (blockedScopes.has(scope.id())) return null;
      if (blockedNames.get(scope.id())?.has(name)) return null;
      const found = declarations.get(`${scope.id()}:${name}`)?.filter(entry => !entry.visible || entry.visible(node));
      if (found?.length) return found.length === 1 ? found[0] : null;
      // Java types have separate member namespaces. Inheritance, enclosing
      // instances and anonymous classes need type resolution, not lexical fallthrough.
      if (material.kind === "JAVA" && javaTypeBodies.has(scope.kind())) return null;
    }
    return null;
  };
  const shadowsGlobal = (node, name) => [node, ...ancestors(node)].filter(candidate => scopeKinds.has(candidate.kind()))
    .some(scope => blockedScopes.has(scope.id()) || declarations.has(`${scope.id()}:${name}`));

  for (const node of nodes.filter(node => functionKinds.has(node.kind()))) {
    const nameNode = node.field("name");
    const functionName = safeName(nameNode?.text()) ? nameNode.text() : "anonymous";
    const fn = make(node, "LOGIC_FUNCTION", functionName);
    if (nameNode) {
      declarationNodes.add(nameNode.id());
      // Only free function declarations can be resolved as identifier calls.
      if (["function_declaration", "generator_function_declaration"].includes(node.kind())) addBinding(nameNode, nearest(node, scopeKinds), fn);
      if (["function_expression", "generator_function"].includes(node.kind())) addBinding(nameNode, node, fn);
    }
    const parameters = node.field("parameters") ?? node.field("parameter");
    for (const parameter of parameters?.kind() === "identifier" ? [parameters] : named(parameters)) {
      const pattern = ["required_parameter", "optional_parameter", "formal_parameter", "spread_parameter"].includes(parameter.kind())
        ? parameter.field("pattern") ?? parameter.field("name") : parameter;
      if (pattern?.kind() === "identifier") addBinding(pattern, node);
      else if (pattern && !["type_parameter", "comment"].includes(pattern.kind())) {
        blockedScopes.add(node.id());
        addGap(material, "program-logic", "PARAMETER_PATTERN_UNSUPPORTED", anchor(parameter));
      }
    }
  }
  for (const node of nodes.filter(node => node.kind() === "variable_declarator")) {
    // Record varargs use a nested variable_declarator in their header. Their
    // component belongs to the record body, not the compilation-unit scope.
    if (material.kind === "JAVA" && node.parent()?.kind() === "spread_parameter"
      && node.parent()?.parent()?.parent()?.kind() === "record_declaration") continue;
    const name = node.field("name");
    if (name?.kind() !== "identifier") {
      const scope = nearest(node, scopeKinds); if (scope) blockedScopes.add(scope.id());
      addGap(material, "program-logic", "BINDING_PATTERN_UNSUPPORTED", anchor(node)); continue;
    }
    const declaration = node.parent();
    const isVar = material.kind !== "JAVA" && declaration?.kind() === "variable_declaration";
    const scope = nearest(node, isVar ? new Set(["program", ...functionKinds]) : scopeKinds);
    const init = node.field("value");
    const fn = init && objects.get(`LOGIC_FUNCTION:${init.id()}`);
    const visible = material.kind === "JAVA" && !javaTypeBodies.has(scope?.kind())
      ? reference => reference.range().start.index >= name.range().start.index : null;
    addBinding(name, scope, fn ?? null, visible);
  }
  for (const node of material.kind === "JAVA" ? [] : nodes.filter(node => ["class_declaration", "enum_declaration"].includes(node.kind()))) addBinding(node.field("name"), nearest(node, scopeKinds));
  for (const node of nodes.filter(node => node.kind() === "catch_clause")) {
    const parameter = node.field("parameter") ?? named(node).find(child => child.kind() === "catch_formal_parameter");
    if (!parameter) continue;
    const name = parameter.kind() === "catch_formal_parameter" ? parameter.field("name") : parameter;
    if (name?.kind() === "identifier") addBinding(name, node);
    else { blockedScopes.add(node.id()); addGap(material, "program-logic", "CATCH_BINDING_UNSUPPORTED", anchor(node)); }
  }
  if (material.kind === "JAVA") {
    for (const node of nodes) {
      if (node.kind() === "enhanced_for_statement") {
        const name = node.field("name"), body = node.field("body");
        if (name?.kind() === "identifier" && body) addBinding(name, node, null, reference => inside(reference, body));
        else { blockedScopes.add(node.id()); addGap(material, "program-logic", "JAVA_LOOP_BINDING_UNSUPPORTED", anchor(node)); }
      }
      if (node.kind() === "resource" && node.field("name")) {
        const scope = nearest(node, new Set(["try_with_resources_statement"])), name = node.field("name");
        const specification = node.parent(), body = scope?.field("body");
        if (scope && name.kind() === "identifier" && body) addBinding(name, scope, null, reference => inside(reference, body)
          || (inside(reference, specification) && reference.range().start.index >= name.range().end.index));
        else { if (scope) blockedScopes.add(scope.id()); addGap(material, "program-logic", "JAVA_RESOURCE_BINDING_UNSUPPORTED", anchor(node)); }
      }
      if (node.kind() === "record_declaration") {
        const body = node.field("body");
        for (const parameter of named(node.field("parameters"))) {
          const name = parameter.field("name") ?? named(parameter).find(child => child.kind() === "variable_declarator")?.field("name");
          if (name?.kind() === "identifier") addBinding(name, body);
          else if (parameter.kind() !== "comment") { if (body) blockedScopes.add(body.id()); addGap(material, "program-logic", "JAVA_RECORD_BINDING_UNSUPPORTED", anchor(parameter)); }
        }
      }
      const patternName = node.kind() === "instanceof_expression" ? node.field("name")
        : ["type_pattern", "record_pattern_component"].includes(node.kind()) ? named(node).findLast(child => child.kind() === "identifier") : null;
      if (patternName) {
        declarationNodes.add(patternName.id());
        // Pattern visibility depends on control flow (including negation and
        // early returns). Suppress only this uncertain name, not unrelated locals.
        const scope = nearest(node, functionKinds) ?? nearest(node, scopeKinds);
        if (scope) {
          if (!blockedNames.has(scope.id())) blockedNames.set(scope.id(), new Set());
          blockedNames.get(scope.id()).add(patternName.text());
        }
        addGap(material, "program-logic", "JAVA_PATTERN_SCOPE_UNRESOLVED", anchor(node));
      }
      if (javaTypeBodies.has(node.kind()) && (nearest(node, javaTypeBodies)
        || node.parent()?.kind() === "object_creation_expression" || node.parent()?.field("superclass") || node.parent()?.field("interfaces"))) {
        addGap(material, "program-logic", "JAVA_CLASS_MEMBER_SCOPE_UNRESOLVED", anchor(node));
      }
    }
  }
  for (const node of material.kind === "JAVA" ? [] : nodes) {
    const callee = node.kind() === "call_expression" ? node.field("function") : null;
    if (node.kind() !== "with_statement" && !(callee?.kind() === "identifier" && callee.text() === "eval" && !lookup(callee, "eval"))) continue;
    const scope = node.kind() === "with_statement" ? node : nearest(node, functionKinds) ?? root;
    blockedScopes.add(scope.id());
    addGap(material, "program-logic", "DYNAMIC_LEXICAL_SCOPE_UNRESOLVED", anchor(node));
  }
  const module = { material: logicMaterial, exports: [], calls: [], initializationProofs: limits.functionInitialization === "local-sequence-v1" };
  for (const node of material.kind === "JAVA" ? [] : nodes.filter(node => node.kind() === "import_statement")) {
    const specifier = literalString(node.field("source"));
    if (!specifier || specifier.length > 1024) continue;
    const clause = named(node).find(child => child.kind() === "import_clause");
    const registrations = [];
    for (const child of named(clause)) {
      if (child.kind() === "identifier") registrations.push({ local: child, imported: "default" });
      if (child.kind() === "named_imports") for (const item of named(child).filter(item => item.kind() === "import_specifier")) {
        registrations.push({ local: item.field("alias") ?? item.field("name"), imported: item.field("name")?.text() });
      }
    }
    for (const { local, imported } of registrations) {
      if (!safeName(imported)) continue;
      const binding = addBinding(local, root);
      if (!binding) continue;
      if (/^import\s+type\b/.test(node.text()) || /^type\s/.test(local.parent()?.text() ?? "")) {
        addGap(material, "program-logic", "TYPE_ONLY_IMPORT_NO_RUNTIME_TARGET", anchor(local)); continue;
      }
      const reference = fact(binding.object, "importSpecifier", node, { value: { datatype: "string", value: specifier } });
      const symbol = fact(binding.object, "importedSymbol", node, { value: { datatype: "string", value: imported } });
      binding.importRef = { specifier, imported, reference, symbol };
    }
  }
  const reassignedGlobals = new Set();
  for (const node of nodes) {
    if (!writes.has(node.kind())) continue;
    let left = node.field("left") ?? node.field("argument");
    const direct = left?.kind() === "identifier";
    while (left?.kind() === "member_expression" || left?.kind() === "subscript_expression") left = left.field("object");
    if (left?.kind() === "identifier") {
      const binding = lookup(left, left.text());
      if (binding) binding.mutated = true;
      else if (direct) reassignedGlobals.add(left.text());
    }
  }
  for (const node of material.kind === "JAVA" ? [] : nodes.filter(node => node.kind() === "export_statement")) {
    const fn = node.field("declaration") && objects.get(`LOGIC_FUNCTION:${node.field("declaration").id()}`);
    if (fn && fn.object.name !== "anonymous") {
      const symbol = /^export\s+default\b/.test(node.text()) ? "default" : fn.object.name;
      const declaration = fact(fn.object, "exportedSymbol", node, { value: { datatype: "string", value: symbol } });
      module.exports.push({ ...fn, symbol, exportFact: declaration });
    }
    for (const specifier of named(node).flatMap(child => child.kind() === "export_clause" ? named(child) : []).filter(child => child.kind() === "export_specifier")) {
      const name = specifier.field("name"), alias = specifier.field("alias") ?? name;
      const binding = name && lookup(name, name.text());
      if (!binding?.target || binding.mutated || !safeName(alias?.text())) continue;
      const declaration = fact(binding.target.object, "exportedSymbol", specifier, { value: { datatype: "string", value: alias.text() } });
      module.exports.push({ ...binding.target, symbol: alias.text(), exportFact: declaration });
    }
  }

  for (const node of nodes.filter(node => ["if_statement", "ternary_expression"].includes(node.kind()))) {
    const conditionNode = node.field("condition");
    if (!conditionNode) continue;
    const condition = make(conditionNode, "LOGIC_CONDITION", "condition");
    for (const [field, outcome] of [["consequence", "TRUE"], ["alternative", "FALSE"]]) {
      const body = node.field(field);
      if (!body) continue;
      const branch = make(body, "LOGIC_BRANCH", outcome);
      const role = fact(branch.object, "branchOutcome", body, { value: { datatype: "string", value: outcome } });
      fact(branch.object, "branchCondition", conditionNode, { target: condition.object, basis: "DERIVED", premiseFactIds: [role, condition.declaration] });
      branches.push({ ...branch, condition });
    }
  }

  // A reference edge is lexical/syntactic, NOT a reaching-definition or value
  // claim. It remains true in loops/mutations without guessing runtime values.
  const references = (expression, owner) => {
    const descendants = collect(expression, limits.maxProgramNodes ?? 20_000) ?? [];
    for (const node of descendants) {
      if (node.kind() !== "identifier" || declarationNodes.has(node.id())) continue;
      if (material.kind === "JAVA" && ancestors(node).some(parent => ["type_pattern", "record_pattern"].includes(parent.kind()))) continue;
      if (nearest(node, functionKinds)?.id() !== nearest(expression, functionKinds)?.id()) continue;
      const parent = node.parent();
      if ((parent?.kind() === "method_invocation" && same(parent.field("name"), node))
        || (parent?.kind() === "field_access" && same(parent.field("field"), node))
        || (parent?.kind() === "pair" && same(parent.field("key"), node))) continue;
      const binding = lookup(node, node.text());
      if (!binding) continue;
      const ref = objects.get(`LOGIC_REFERENCE:${node.id()}`) ?? make(node, "LOGIC_REFERENCE", binding.object.name);
      const read = fact(ref.object, "readsBinding", node, { target: binding.object, basis: "DERIVED", premiseFactIds: [ref.declaration, binding.declaration] });
      fact(owner.object, "dependsOn", node, { target: ref.object, basis: "DERIVED", premiseFactIds: [owner.declaration, read] });
    }
  };

  const contexts = [...objects.values()].filter(entry => entry.object.kind === "LOGIC_CONDITION");
  const bindingProof = binding => {
    if (binding.functionProof) return binding.functionProof;
    const fn = binding.target, declaration = binding.node.parent();
    let kind, container, roleNode;
    if (same(fn.node.field("name"), binding.node)) {
      kind = ["function_declaration", "generator_function_declaration"].includes(fn.node.kind()) ? "DECLARATION_NAME" : "EXPRESSION_NAME";
      container = fn.node; roleNode = binding.node;
    } else if (declaration?.kind() === "variable_declarator" && same(declaration.field("name"), binding.node)
      && same(declaration.field("value"), fn.node)) {
      kind = "FUNCTION_INITIALIZER"; container = declaration; roleNode = fn.node;
    } else return null;
    binding.functionKind = kind;
    const role = fact(binding.object, "functionBindingKind", roleNode, { value: { datatype: "string", value: kind } });
    let region;
    if (limits.functionInitialization === "local-sequence-v1" && kind === "FUNCTION_INITIALIZER") {
      let statement = declaration.parent();
      if (statement?.parent()?.kind() === "export_statement") statement = statement.parent();
      const parent = statement?.parent();
      // A var initializer in an if/loop/try may not run at all. Only a direct
      // statement-list initializer supplies a local sequence region.
      if (["program", "statement_block"].includes(parent?.kind())) {
        binding.initializationRegion = parent;
        region = fact(binding.object, "functionInitializationRegion", parent, { value: { datatype: "string", value: parent.kind() } });
      }
    }
    binding.functionProof = fact(binding.object, "bindingFunction", container, { target: fn.object, basis: "DERIVED",
      premiseFactIds: [binding.declaration, fn.declaration, role, binding.scopeFact, ...(region ? [region] : [])] });
    return binding.functionProof;
  };
  for (const node of nodes) {
    if (["assignment_expression", "augmented_assignment_expression", "update_expression", "while_statement", "do_statement", "for_statement", "for_in_statement", "enhanced_for_statement", "switch_statement", "switch_expression", "try_statement", "try_with_resources_statement", "await_expression", "yield_expression"].includes(node.kind())) {
      addGap(material, "program-logic", "CONTROL_OR_MUTATION_VALUE_UNRESOLVED", anchor(node));
    }
    if (node.kind() === "binary_expression" && ["&&", "||", "??"].includes(node.field("operator")?.text())) addGap(material, "program-logic", "SHORT_CIRCUIT_PATH_UNRESOLVED", anchor(node));
    if (material.kind === "JAVA" && node.kind() === "field_access") addGap(material, "program-logic", "JAVA_MEMBER_ACCESS_UNRESOLVED", anchor(node));
    if (material.kind === "JAVA" && ["enhanced_for_statement", "resource"].includes(node.kind()) && node.field("value")) {
      const binding = objects.get(`LOGIC_BINDING:${node.field("name")?.id()}`);
      if (binding) references(node.field("value"), binding);
    }
    if (node.kind() === "variable_declarator" && node.field("value")) {
      const binding = objects.get(`LOGIC_BINDING:${node.field("name")?.id()}`);
      if (binding) references(node.field("value"), binding);
    }
    if (!callKinds.has(node.kind()) && node.kind() !== "return_statement") continue;
    const callee = node.field("function") ?? node.field("name") ?? node.field("type");
    const label = safeName(callee?.text()) ? callee.text() : node.kind() === "return_statement" ? "return" : "call";
    const call = make(node, node.kind() === "return_statement" ? "LOGIC_RETURN" : "LOGIC_CALL", label);
    contexts.push(call);
    const owner = nearest(node, functionKinds);
    const fn = owner && objects.get(`LOGIC_FUNCTION:${owner.id()}`);
    if (fn) {
      call.object.parentId = fn.object.objectId;
      fact(call.object, "callContext", node, { target: fn.object, basis: "DERIVED", premiseFactIds: [call.declaration, fn.declaration] });
    }
    for (const branch of branches) {
      if (!ancestors(node).some(parent => same(parent, branch.node)) || nearest(branch.node, functionKinds)?.id() !== owner?.id()) continue;
      fact(call.object, "withinBranch", node, { target: branch.object, basis: "DERIVED", premiseFactIds: [call.declaration, branch.declaration] });
    }
    if (!callKinds.has(node.kind())) continue;
    const bound = callee?.kind() === "identifier" && lookup(callee, callee.text());
    if (bound?.target && !bound.mutated && node.kind() === "call_expression") {
      // The initializer's own name may be anonymous or a distinct recursive
      // name. Persist the actual binding→function premise, not a name guess.
      // Retained profiles without this mode keep their exact historical bytes.
      const proof = limits.functionBindings === "initializer-proof-v1" ? bindingProof(bound) : null;
      let initializationGap;
      if (limits.functionInitialization === "local-sequence-v1" && bound.functionKind === "FUNCTION_INITIALIZER"
        && !same(owner, bound.target.node)) {
        const declaration = bound.node.parent(), context = nearest(declaration, functionKinds);
        const sameContext = (!owner && !context) || same(owner, context);
        if (!sameContext || !inside(node, bound.initializationRegion)) initializationGap = "CALL_INITIALIZATION_ORDER_UNRESOLVED";
        else if (node.range().start.index < declaration.range().end.index) initializationGap = "CALL_TARGET_BEFORE_INITIALIZATION";
      }
      if (limits.functionBindings === "initializer-proof-v1" && !proof) addGap(material, "program-logic", "FUNCTION_BINDING_UNSUPPORTED", anchor(node));
      else if (initializationGap) addGap(material, "program-logic", initializationGap, anchor(node));
      else fact(call.object, "callsDeclaration", callee, { target: bound.target.object, basis: "DERIVED",
        premiseFactIds: [call.declaration, bound.declaration, bound.target.declaration, ...(proof ? [proof] : [])] });
    }
    else if (bound?.importRef?.specifier.startsWith(".") && !bound.mutated) module.calls.push({ ...call, binding: bound });
    else addGap(material, "program-logic", "CALL_TARGET_NOT_RESOLVED", anchor(node));
    const argumentsNode = node.field("arguments");
    const args = named(argumentsNode);
    args.forEach((argument, index) => {
      const expression = make(argument, "LOGIC_ARGUMENT", `argument ${index}`);
      const position = fact(expression.object, "argumentPosition", argument, { value: { datatype: "integer", value: index } });
      fact(call.object, "hasArgument", argument, { target: expression.object, basis: "DERIVED", premiseFactIds: [call.declaration, position] });
      references(argument, expression);
    });
    const sqlMethod = callee?.text()?.split(".").at(-1);
    if (["query", "execute", "executeQuery", "executeUpdate", "prepareStatement", "exec"].includes(sqlMethod) && args[0]) {
      const sql = literalString(args[0]);
      if (sql === null) addGap(material, "sql", "DYNAMIC_SQL_UNSUPPORTED", anchor(args[0]));
      else if (/^\s*(SELECT|UPDATE|INSERT|DELETE|CREATE)\b/i.test(sql)) {
        const statements = extractStaticSql({ text: sql, material: logicMaterial, objectMaterial: material, embedded: true,
          anchorFor: () => anchor(args[0]), limits, addObject, addFact, addGap, sqlReferences });
        for (const statement of statements) fact(call.object, "embedsSql", args[0], {
          target: statement.object, basis: "DERIVED", premiseFactIds: [call.declaration, statement.declaration] });
      }
    }
  }
  for (const context of contexts) references(context.node, context);

  for (const node of nodes) {
    const match = /^process\.env\.([A-Za-z_][\w]*)$/.exec(node.text());
    if (!match || !["member_expression", "field_access"].includes(node.kind()) || shadowsGlobal(node, "process") || reassignedGlobals.has("process")) continue;
    if (ancestors(node).some(parent => writes.has(parent.kind()) && (() => {
      const left = parent.field("left") ?? parent.field("argument");
      return left && node.range().start.index >= left.range().start.index && node.range().end.index <= left.range().end.index;
    })())) continue;
    if (!safeName(match[1])) { addGap(material, "program-logic", "CONFIG_READ_RESTRICTED", anchor(node)); continue; }
    const read = make(node, "CONFIG_READ", match[1]);
    const declaration = fact(read.object, "configKeyName", node, { value: { datatype: "string", value: match[1] } });
    configReferences.push({ material: logicMaterial, object: read.object, declaration });
    for (const context of contexts) {
      if (node.range().start.index < context.node.range().start.index || node.range().end.index > context.node.range().end.index) continue;
      if (nearest(node, functionKinds)?.id() !== nearest(context.node, functionKinds)?.id()) continue;
      fact(context.object, "dependsOn", node, { target: read.object, basis: "DERIVED", premiseFactIds: [context.declaration, declaration] });
    }
    const declarator = ancestors(node).find(parent => parent.kind() === "variable_declarator");
    const binding = declarator && objects.get(`LOGIC_BINDING:${declarator.field("name")?.id()}`);
    if (binding) fact(binding.object, "dependsOn", node, { target: read.object, basis: "DERIVED", premiseFactIds: [binding.declaration, declaration] });
  }
  if (material.kind === "TYPESCRIPT") {
    const tests = [];
    for (const call of contexts.filter(entry => entry.object.kind === "LOGIC_CALL")) {
      const callee = call.node.field("function");
      const bound = callee?.kind() === "identifier" && lookup(callee, callee.text());
      const args = named(call.node.field("arguments"));
      const body = args[1] && objects.get(`LOGIC_FUNCTION:${args[1].id()}`);
      if (!bound?.mutated && bound?.importRef?.specifier === "node:test" && ["default", "test", "it"].includes(bound.importRef.imported) && body && literalString(args[0]) !== null) {
        const testCase = make(call.node, "TEST_CASE", "declared test");
        const registration = fact(testCase.object, "testRegistration", call.node, { value: { datatype: "string", value: "node:test" } });
        fact(testCase.object, "declaredTestBody", body.node, { target: body.object, basis: "DERIVED", premiseFactIds: [registration, body.declaration, bound.importRef.reference] });
        tests.push({ ...testCase, body });
      }
    }
    for (const call of contexts.filter(entry => entry.object.kind === "LOGIC_CALL")) {
      const callee = call.node.field("function");
      if (callee?.kind() !== "member_expression") continue;
      const receiver = callee.field("object"), property = callee.field("property");
      const bound = receiver?.kind() === "identifier" && lookup(receiver, receiver.text());
      if (bound?.mutated || !["node:assert", "node:assert/strict"].includes(bound?.importRef?.specifier) || !assertionMethods.has(property?.text())) continue;
      const owner = nearest(call.node, functionKinds);
      const testCase = tests.find(testCase => same(testCase.body.node, owner));
      if (!testCase) continue;
      const assertion = make(call.node, "TEST_ASSERTION", property.text());
      fact(testCase.object, "declaredAssertion", call.node, { target: assertion.object, basis: "DERIVED", premiseFactIds: [testCase.declaration, assertion.declaration, bound.importRef.reference] });
    }
  }
  technicalModules.push(module);
}

export function resolveTechnicalModules({ technicalModules, addFact, addGap }) {
  const locations = new Map();
  for (const module of technicalModules) {
    const key = JSON.stringify([module.material.componentId, module.material.displayPath]);
    if (!locations.has(key)) locations.set(key, []);
    locations.get(key).push(module);
  }
  for (const module of technicalModules) for (const call of module.calls) {
    const ref = call.binding.importRef;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(module.material.displayPath), ref.specifier));
    const candidates = new Set([base]);
    if (/\.([cm]?js)$/.test(base)) candidates.add(base.replace(/\.([cm]?)js$/, ".$1ts"));
    if (!path.posix.extname(base)) for (const suffix of [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"]) candidates.add(base + suffix);
    const matches = [...candidates].flatMap(candidate => locations.get(JSON.stringify([module.material.componentId, candidate])) ?? []);
    const exports = matches.length === 1 ? matches[0].exports.filter(entry => entry.symbol === ref.imported) : [];
    if (exports.length !== 1) { addGap(module.material, "program-logic", matches.length > 1 ? "MODULE_TARGET_AMBIGUOUS" : "MODULE_EXPORT_UNRESOLVED", call.object.anchor); continue; }
    if (module.initializationProofs && !["function_declaration", "generator_function_declaration"].includes(exports[0].node.kind())) {
      addGap(module.material, "program-logic", "CALL_INITIALIZATION_ORDER_UNRESOLVED", call.object.anchor); continue;
    }
    addFact({ subject: call.object, predicate: "callsDeclaration", target: exports[0].object, basis: "DERIVED",
      premiseFactIds: [call.declaration, call.binding.declaration, ref.reference, ref.symbol, exports[0].exportFact, exports[0].declaration],
      material: module.material, anchor: call.object.anchor });
  }
}

export function resolveConfigReferences({ configReferences, objects, facts, materials, addFact, addGap }) {
  const materialById = new Map(materials.map(material => [material.materialId, material]));
  const declarations = new Map();
  for (const object of objects.filter(object => object.kind === "CONFIG_KEY")) {
    const key = JSON.stringify([materialById.get(object.materialId)?.componentId, object.name]);
    if (!declarations.has(key)) declarations.set(key, []);
    declarations.get(key).push(object);
  }
  const declarationFacts = new Map();
  for (const fact of facts) if (["name", "type", "literalValue"].includes(fact.predicate)) {
    if (!declarationFacts.has(fact.subjectId)) declarationFacts.set(fact.subjectId, fact.factId);
  }
  for (const ref of configReferences) {
    const candidates = declarations.get(JSON.stringify([ref.material.componentId, ref.object.name])) ?? [];
    const premise = candidates.length === 1 && declarationFacts.get(candidates[0].objectId);
    if (premise) addFact({ subject: ref.object, predicate: "matchesConfigKey", target: candidates[0],
      basis: "DERIVED", premiseFactIds: [ref.declaration, premise], material: ref.material, anchor: ref.object.anchor });
    else addGap(ref.material, "program-logic", candidates.length > 1 ? "CONFIG_DECLARATION_AMBIGUOUS" : "CONFIG_DECLARATION_UNAVAILABLE", ref.object.anchor);
  }
}
