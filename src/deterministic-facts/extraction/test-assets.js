const jsFunctions = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const nodeAssertions = new Set(["ok", "equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "throws", "doesNotThrow", "rejects", "doesNotReject", "ifError", "match", "doesNotMatch", "fail"]);
const javaAssertions = new Set(["assertEquals", "assertNotEquals", "assertTrue", "assertFalse", "assertNull", "assertNotNull", "assertSame", "assertNotSame", "assertArrayEquals", "assertIterableEquals", "assertThrows", "assertDoesNotThrow", "fail"]);
const assertModules = new Set(["node:assert", "node:assert/strict"]);
const testModules = new Map([["node:test", new Set(["default", "test", "it"])], ["vitest", new Set(["test", "it"])], ["@jest/globals", new Set(["test", "it"])]]);
const jupiter = "org.junit.jupiter.api.";

function emitPlans({ plans, material, limits, addObject, addFact, addGap, references }) {
  if (plans.length > (limits.maxTestCases ?? 2000) || plans.reduce((n, p) => n + p.assertions.length, 0) > (limits.maxTestAssertions ?? 10_000)) {
    addGap(material, material.ruleRef.id.slice(5), "TEST_ASSET_LIMIT"); return;
  }
  const property = (object, predicate, value, anchor, basis = "DECLARED", premiseFactIds = []) => addFact({ subject: object, predicate, value: { datatype: "string", value }, material, anchor, basis, premiseFactIds });
  for (const p of plans) {
    if (/(?:password|secret|token|api[_-]?key)/i.test(p.name)) { addGap(material, material.ruleRef.id.slice(5), "TEST_NAME_RESTRICTED", p.nameAnchor); continue; }
    if (Buffer.byteLength(p.name, "utf8") > (limits.maxTestNameBytes ?? 4096)) { addGap(material, material.ruleRef.id.slice(5), "TEST_NAME_LIMIT", p.nameAnchor); continue; }
    const testcase = addObject(material, "TEST_CASE", p.name, p.anchor); testcase.parentId = p.parent.objectId;
    const name = property(testcase, "testName", p.name, p.nameAnchor);
    const registration = property(testcase, "registrationName", p.registration, p.registrationAnchor);
    const body = addFact({ subject: testcase, predicate: "testBody", target: p.caller, material, anchor: p.bodyAnchor });
    const framework = property(testcase, "testFramework", p.framework, p.anchor, "DERIVED", [name, registration, body, ...p.proof]);
    for (const a of p.assertions) {
      const assertion = addObject(material, "TEST_ASSERTION", a.name, a.anchor); assertion.parentId = testcase.objectId;
      const name = property(assertion, "assertionName", a.name, a.nameAnchor);
      const receiver = property(assertion, "assertionReceiver", a.receiver, a.nameAnchor);
      const binding = property(assertion, "testFramework", a.framework, a.anchor, "DERIVED", [name, receiver, ...a.proof]);
      addFact({ subject: testcase, predicate: "hasAssertion", target: assertion, material, anchor: a.anchor, basis: "DERIVED", premiseFactIds: [framework, binding] });
    }
    references.push({ material, testcase, framework, caller: p.caller, anchor: p.bodyAnchor });
  }
}

export function extractJavaScriptTests({ material, text, limits, bindings, functionByNode, textAnchor, addObject, addFact, addGap, references }) {
  if (!bindings) { addGap(material, "javascript", "TEST_BINDINGS_UNAVAILABLE"); return; }
  const at = n => textAnchor(text, n.start, n.end), proof = b => [b.nameFactId, b.pathFactId, b.importFactId];
  const dirty = new Set();
  // A direct import receiver may not be written, detached or passed elsewhere.
  for (const { node, ancestors } of bindings.entries) if (node.type === "Identifier" && !ancestors.some(n => n.type === "ImportDeclaration")) {
    const b = bindings.bindingAt(node, node.name); if (!b?.importNode || (!testModules.has(b.specifier) && !assertModules.has(b.specifier))) continue;
    const parent = ancestors.at(-2), outer = ancestors.at(-3);
    const direct = parent?.type === "CallExpression" && parent.callee === node && !parent.optional;
    const member = parent?.type === "MemberExpression" && parent.object === node && !parent.computed && !parent.optional
      && outer?.type === "CallExpression" && outer.callee === parent && !outer.optional;
    if (!direct && !member) dirty.add(b);
  }
  const plans = [], calls = bindings.entries.filter(e => e.node.type === "CallExpression"), callsByFunction = new Map(); let assertionCount = 0;
  for (const entry of calls) {
    const fn = [...entry.ancestors].reverse().find(n => jsFunctions.has(n.type));
    if (!callsByFunction.has(fn)) callsByFunction.set(fn, []); callsByFunction.get(fn).push(entry);
  }
  for (const { node, ancestors } of calls) {
    const identifier = node.callee.type === "Identifier" ? node.callee : node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" ? node.callee.object : null;
    if (!identifier) continue;
    const b = bindings.bindingAt(node, identifier.name);
    if (!b || !testModules.get(b.specifier)?.has(b.importedName)) continue;
    const callback = node.arguments[1], name = node.arguments[0];
    if (bindings.dynamicScope || b.written || dirty.has(b) || node.optional || node.callee.type !== "Identifier" || node.arguments.length !== 2
      || name?.type !== "Literal" || typeof name.value !== "string" || !jsFunctions.has(callback?.type)) {
      addGap(material, "javascript", "TEST_DECLARATION_UNSUPPORTED", at(node)); continue;
    }
    if (plans.length >= (limits.maxTestCases ?? 2000)) { addGap(material, "javascript", "TEST_ASSET_LIMIT"); return; }
    const assertions = [];
    for (const entry of callsByFunction.get(callback) ?? []) {
      const call = entry.node;
      const member = call.callee.type === "MemberExpression" ? call.callee : null;
      const id = member?.object.type === "Identifier" ? member.object : call.callee.type === "Identifier" ? call.callee : null;
      const binding = id ? bindings.bindingAt(call, id.name) : null;
      if (!binding || !assertModules.has(binding.specifier)) continue;
      const method = member ? member.property.name : binding.importedName === "default" ? "ok" : binding.importedName;
      if (bindings.dynamicScope || binding.written || dirty.has(binding) || call.optional || member?.computed || member?.optional || !nodeAssertions.has(method)
        || (member && binding.importedName !== "default")) { addGap(material, "javascript", "TEST_ASSERTION_UNRESOLVED", at(call)); continue; }
      assertions.push({ name: member ? member.property.name : id.name, receiver: member ? id.name : "", framework: binding.specifier,
        anchor: at(call), nameAnchor: at(call.callee), proof: proof(binding) });
      if (++assertionCount > (limits.maxTestAssertions ?? 10_000)) { addGap(material, "javascript", "TEST_ASSET_LIMIT"); return; }
    }
    const parent = [...ancestors].slice(0, -1).reverse().map(n => functionByNode.get(n)).find(Boolean) ?? material.root;
    plans.push({ name: name.value, registration: identifier.name, framework: b.specifier, proof: proof(b), parent,
      anchor: at(node), nameAnchor: at(name), registrationAnchor: at(node.callee), assertions, caller: functionByNode.get(callback), bodyAnchor: at(callback) });
  }
  emitPlans({ plans, material, limits, addObject, addFact, addGap, references });
}

export function extractJavaTests({ material, text, limits, types, methods, annotations, imports, nodes, shadowNames, textAnchor, addObject, addFact, addGap, references }) {
  const at = n => { const r = n.range(); return textAnchor(text, r.start.index, r.end.index); };
  const resolveType = (name, qualified) => {
    if ([...types.values()].some(t => t.object.name === name.split(".")[0])) return null;
    if (name === qualified) return [];
    const matches = imports.filter(i => i.kind === "TYPE" && i.name.split(".").at(-1) === name);
    return matches.length === 1 && matches[0].name === qualified ? [matches[0].pathFact, matches[0].kindFact] : null;
  };
  const plans = [], callsByMethod = new Map(); let assertionCount = 0;
  for (const node of nodes.filter(n => n.kind() === "method_invocation")) {
    const chain = node.ancestors(), owner = chain.find(n => ["method_declaration", "constructor_declaration"].includes(n.kind()));
    if (!owner || chain.some(n => n.kind() === "lambda_expression" || (n.kind() === "class_body" && n.parent()?.kind() === "object_creation_expression"))) continue;
    if (!callsByMethod.has(owner.id())) callsByMethod.set(owner.id(), []); callsByMethod.get(owner.id()).push(node);
  }
  for (const method of methods) {
    const testAnnotations = annotations.filter(a => a.owner.objectId === method.object.objectId && /(?:^|\.)Test$/.test(a.object.name));
    if (!testAnnotations.length) continue;
    const annotation = testAnnotations[0], binding = resolveType(annotation.object.name, jupiter + "Test");
    if (testAnnotations.length !== 1 || binding === null || method.object.kind !== "JAVA_METHOD") { addGap(material, "java", "TEST_FRAMEWORK_UNRESOLVED", at(method.node)); continue; }
    if (annotation.node.field("arguments")?.children().some(n => n.isNamed() && !["line_comment", "block_comment"].includes(n.kind()))) { addGap(material, "java", "TEST_DECLARATION_UNSUPPORTED", at(annotation.node)); continue; }
    if (plans.length >= (limits.maxTestCases ?? 2000)) { addGap(material, "java", "TEST_ASSET_LIMIT"); return; }
    const assertions = [];
    for (const node of callsByMethod.get(method.node.id()) ?? []) {
      const name = node.field("name")?.text(), receiver = node.field("object")?.text() ?? ""; if (!javaAssertions.has(name)) continue;
      let proof;
      if (receiver) proof = shadowNames.has(receiver) ? null : resolveType(receiver, jupiter + "Assertions");
      else {
        const local = methods.some(m => m.name === name && m.owner.object.objectId === method.owner.object.objectId);
        const matches = imports.filter(i => i.kind === "STATIC" && i.name.split(".").at(-1) === name);
        proof = !local && matches.length === 1 && matches[0].name === jupiter + "Assertions." + name ? [matches[0].pathFact, matches[0].kindFact] : null;
      }
      if (proof === null) { addGap(material, "java", "TEST_ASSERTION_UNRESOLVED", at(node)); continue; }
      assertions.push({ name, receiver, framework: "junit-jupiter", anchor: at(node), nameAnchor: at(node.field("name")), proof });
      if (++assertionCount > (limits.maxTestAssertions ?? 10_000)) { addGap(material, "java", "TEST_ASSET_LIMIT"); return; }
    }
    plans.push({ name: method.name, registration: annotation.object.name, framework: "junit-jupiter", parent: method.object, caller: method.object,
      proof: [annotation.nameFact, method.nameFact, ...binding], anchor: at(method.node), nameAnchor: at(method.node.field("name")),
      registrationAnchor: at(annotation.node.field("name")), assertions, bodyAnchor: at(method.node) });
  }
  emitPlans({ plans, material, limits, addObject, addFact, addGap, references });
}

export function resolveTestReferences({ references, facts, objects, evidence, addFact }) {
  const byId = new Map(objects.map(o => [o.objectId, o])), sources = new Map(evidence.map(e => [e.evidenceId, e]));
  for (const r of references) for (const f of facts.filter(f => f.predicate === "staticCalls" && f.subjectId === r.caller?.objectId)) {
    const e = f.evidenceIds.map(id => sources.get(id)).find(e => e.materialId === r.material.materialId && e.anchor.kind === "TEXT"
      && e.anchor.byteStart >= r.anchor.byteStart && e.anchor.byteEnd <= r.anchor.byteEnd);
    if (e) addFact({ subject: r.testcase, predicate: "refersTo", target: byId.get(f.targetId), material: r.material, anchor: e.anchor, basis: "DERIVED", premiseFactIds: [r.framework, f.factId] });
  }
}
