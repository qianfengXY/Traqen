import { requireF002 } from "./errors.js";
import { technicalPredicateDefinitions } from "./technical-vocabulary.js";

const check = (value, message) => requireF002(value, "F002_TECHNICAL_PREMISE_INVALID", message, { status: 422 });
const encloses = (outer, inner) => outer?.kind === "TEXT" && inner?.kind === "TEXT" && outer.byteStart <= inner.byteStart && outer.byteEnd >= inner.byteEnd;
const bindingScopeKinds = new Set(["program", "statement_block", "catch_clause", "for_statement", "for_in_statement", "with_statement",
  "function_declaration", "generator_function_declaration", "function_expression", "generator_function", "arrow_function", "method_definition"]);

// Publication is a second boundary, independent of the parser's in-memory
// candidate maps. A valid rehash alone never makes a cross-component edge true.
export function verifyTechnicalEvidence({ objects, facts, evidence, materials, profile }) {
  const configs = new Map(), tables = new Map();
  const bindingProofs = profile?.extractionLimits?.functionBindings === "initializer-proof-v1";
  const initializationProofs = profile?.extractionLimits?.functionInitialization === "local-sequence-v1";
  const functions = new Map();
  if (initializationProofs) for (const object of objects.values()) if (object.kind === "LOGIC_FUNCTION") {
    if (!functions.has(object.materialId)) functions.set(object.materialId, []);
    functions.get(object.materialId).push(object);
  }
  const executionContext = object => (functions.get(object.materialId) ?? []).filter(fn => encloses(fn.anchor, object.anchor))
    .sort((a, b) => (a.anchor.byteEnd - a.anchor.byteStart) - (b.anchor.byteEnd - b.anchor.byteStart))[0]?.objectId;
  const scopes = new Map();
  const scopeKey = object => JSON.stringify([object.materialId, object.name]);
  if (bindingProofs) for (const fact of facts.values()) if (fact.predicate === "lexicalBindingScope") {
    const binding = objects.get(fact.subjectId), key = scopeKey(binding);
    if (!scopes.has(key)) scopes.set(key, []);
    scopes.get(key).push({ binding, fact, anchors: fact.evidenceIds.map(id => evidence.get(id)?.anchor) });
  }
  const component = object => materials.get(object.materialId)?.componentId;
  const key = object => JSON.stringify([component(object), object.name]);
  for (const object of objects.values()) if (object.kind === "CONFIG_KEY") {
    if (!configs.has(key(object))) configs.set(key(object), []);
    configs.get(key(object)).push(object);
  }
  for (const fact of facts.values()) if (fact.predicate === "declaresSqlTable") {
    const table = objects.get(fact.targetId);
    if (!tables.has(key(table))) tables.set(key(table), []);
    tables.get(key(table)).push({ object: table, fact });
  }
  for (const fact of facts.values()) {
    if (!technicalPredicateDefinitions.has(fact.predicate)) continue;
    const subject = objects.get(fact.subjectId), target = fact.targetId && objects.get(fact.targetId);
    const premises = fact.premiseFactIds.map(id => facts.get(id));
    check(fact.evidenceIds.every(id => evidence.get(id)?.materialId === subject.materialId), "技术事实证据不属于其主体材料");
    const stated = (object, predicate = "syntaxKind") => premises.some(premise => premise.subjectId === object.objectId && premise.predicate === predicate && premise.basis === "DECLARED");
    if (fact.kind === "PROPERTY") {
      check(fact.basis === "DECLARED" && fact.premiseFactIds.length === 0, "语法属性必须为直接声明");
      if (fact.predicate === "functionBindingKind") check(bindingProofs
        && ["DECLARATION_NAME", "EXPRESSION_NAME", "FUNCTION_INITIALIZER"].includes(fact.value.value), "函数绑定角色不属于此固定配置");
      if (fact.predicate === "functionInitializationRegion") check(initializationProofs
        && ["program", "statement_block"].includes(fact.value.value)
        && fact.evidenceIds.every(id => encloses(evidence.get(id)?.anchor, subject.anchor)), "初始化缺少支持的本地顺序范围");
      if (fact.predicate === "lexicalBindingScope") check(bindingProofs && bindingScopeKinds.has(fact.value.value)
        && fact.evidenceIds.every(id => encloses(evidence.get(id)?.anchor, subject.anchor)), "词法声明缺少包含自身的支持作用域");
      if (fact.predicate === "branchOutcome") check(["TRUE", "FALSE"].includes(fact.value.value), "分支角色无效");
      if (fact.predicate === "argumentPosition") check(Number.isSafeInteger(fact.value.value) && fact.value.value >= 0 && fact.value.value < 20_000, "实参位置无效");
      if (fact.predicate === "sqlOperation") check(["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE"].includes(fact.value.value), "SQL 操作不在声明子集");
      continue;
    }
    check(fact.basis === "DERIVED" && premises.length > 0, "技术关系必须有明确推导前提");
    check(component(subject) === component(target), "技术关系跨越来源组件");
    if (!["callsDeclaration", "matchesConfigKey", "matchesSqlTable"].includes(fact.predicate)) check(subject.materialId === target.materialId, "局部技术关系跨材料");
    if (["readsBinding", "callContext", "withinBranch", "hasArgument"].includes(fact.predicate)) {
      check(stated(subject), "技术关系缺少主体语法声明");
      if (fact.predicate !== "hasArgument") check(stated(target), "技术关系缺少目标语法声明");
    }
    if (fact.predicate === "readsBinding") check(subject.name === target.name, "词法引用与声明名称不同");
    if (fact.predicate === "bindingFunction") {
      check(bindingProofs && stated(subject) && stated(target), "函数绑定缺少该固定配置的语法前提");
      const role = premises.find(premise => premise.subjectId === subject.objectId && premise.predicate === "functionBindingKind" && premise.basis === "DECLARED");
      const syntax = premises.find(premise => premise.subjectId === target.objectId && premise.predicate === "syntaxKind");
      const scope = premises.filter(premise => premise.subjectId === subject.objectId && premise.predicate === "lexicalBindingScope");
      const exactRange = (left, right) => encloses(left, right) && left.byteStart === right.byteStart && left.byteEnd === right.byteEnd;
      check(role && syntax && scope.length === 1, "函数绑定缺少同一绑定的角色、作用域与目标声明");
      if (role.value.value === "FUNCTION_INITIALIZER") {
        check(["arrow_function", "function_expression", "generator_function"].includes(syntax.value.value)
          && role.evidenceIds.every(id => exactRange(evidence.get(id)?.anchor, target.anchor))
          && fact.evidenceIds.every(id => {
            const anchor = evidence.get(id)?.anchor;
            return encloses(anchor, subject.anchor) && encloses(anchor, target.anchor)
              && anchor.byteStart === subject.anchor.byteStart && anchor.byteEnd === target.anchor.byteEnd
              && subject.anchor.byteEnd < target.anchor.byteStart;
          }), "函数目标不是所列绑定的直接初始化器");
      } else {
        const kinds = role.value.value === "DECLARATION_NAME" ? ["function_declaration", "generator_function_declaration"] : ["function_expression", "generator_function"];
        check(kinds.includes(syntax.value.value) && subject.name === target.name && encloses(target.anchor, subject.anchor)
          && role.evidenceIds.every(id => exactRange(evidence.get(id)?.anchor, subject.anchor))
          && fact.evidenceIds.every(id => exactRange(evidence.get(id)?.anchor, target.anchor)), "函数名绑定不属于该声明或表达式");
      }
    }
    if (["callContext", "withinBranch"].includes(fact.predicate)) check(encloses(target.anchor, subject.anchor), "词法上下文不包含其调用/返回");
    if (fact.predicate === "hasArgument") check(encloses(subject.anchor, target.anchor) && stated(target, "argumentPosition"), "实参不属于该调用");
    if (fact.predicate === "branchCondition") check(stated(subject, "branchOutcome") && stated(target), "分支缺少角色或条件声明");
    if (fact.predicate === "dependsOn") check(stated(subject) && (stated(target, "configKeyName")
      || premises.some(premise => premise.predicate === "readsBinding" && premise.subjectId === target.objectId)), "直接依赖没有所列读取前提");
    if (fact.predicate === "callsDeclaration") {
      check(stated(subject) && stated(target), "调用目标缺少语法声明");
      const imported = premises.find(premise => premise.predicate === "importedSymbol");
      if (imported) {
        const exported = premises.find(premise => premise.predicate === "exportedSymbol" && premise.subjectId === target.objectId);
        const specifier = premises.find(premise => premise.predicate === "importSpecifier" && premise.subjectId === imported.subjectId);
        check(exported && specifier && exported.value.value === imported.value.value
          && objects.get(imported.subjectId)?.name === subject.name, "跨材料调用缺少一致的显式导入/导出前提");
        if (initializationProofs) check(premises.some(premise => premise.subjectId === target.objectId && premise.predicate === "syntaxKind"
          && ["function_declaration", "generator_function_declaration"].includes(premise.value.value)), "跨模块初始化器的执行顺序未证明");
      } else if (bindingProofs) {
        const bindings = premises.filter(premise => premise.predicate === "bindingFunction" && premise.basis === "DERIVED"
          && premise.targetId === target.objectId && objects.get(premise.subjectId)?.name === subject.name
          && stated(objects.get(premise.subjectId)));
        check(subject.materialId === target.materialId && bindings.length === 1, "直接调用缺少其同名词法绑定到函数目标的前提");
        const candidates = (scopes.get(scopeKey(subject)) ?? []).filter(candidate => candidate.anchors.every(anchor => encloses(anchor, subject.anchor)));
        const size = candidate => Math.min(...candidate.anchors.map(anchor => anchor.byteEnd - anchor.byteStart));
        const nearestSize = candidates.reduce((nearest, candidate) => Math.min(nearest, size(candidate)), Infinity);
        const nearest = candidates.filter(candidate => size(candidate) === nearestSize);
        check(nearest.length === 1 && nearest[0].binding.objectId === bindings[0].subjectId
          && bindings[0].premiseFactIds.includes(nearest[0].fact.factId), "调用目标不是当前位置最近且唯一的同名词法绑定");
        if (initializationProofs) {
          const binding = bindings[0], bindingObject = objects.get(binding.subjectId);
          const roles = binding.premiseFactIds.map(id => facts.get(id));
          if (roles.some(role => role.predicate === "functionBindingKind" && role.value.value === "FUNCTION_INITIALIZER")
            && executionContext(subject) !== target.objectId) {
            const regions = roles.filter(role => role.predicate === "functionInitializationRegion" && role.subjectId === binding.subjectId);
            check(executionContext(subject) === executionContext(bindingObject) && regions.length === 1
              && regions[0].evidenceIds.every(id => encloses(evidence.get(id)?.anchor, subject.anchor))
              && binding.evidenceIds.every(id => evidence.get(id)?.anchor?.byteEnd <= subject.anchor.byteStart),
            "函数初始化调用缺少同一执行上下文内已完成的本地顺序前提");
          }
        }
      } else check(subject.materialId === target.materialId && subject.name === target.name
        && premises.some(premise => objects.get(premise.subjectId)?.kind === "LOGIC_BINDING" && objects.get(premise.subjectId)?.name === subject.name), "直接调用不是其同名词法声明");
    }
    if (fact.predicate === "matchesConfigKey") {
      const candidates = configs.get(key(subject)) ?? [];
      check(candidates.length === 1 && candidates[0].objectId === target.objectId && stated(subject, "configKeyName")
        && premises.some(premise => premise.subjectId === target.objectId && ["name", "type", "literalValue"].includes(premise.predicate)), "配置引用不是同组件唯一键及其声明");
    }
    if (fact.predicate === "matchesSqlTable") {
      const candidates = tables.get(key(subject)) ?? [];
      check(candidates.length === 1 && candidates[0].object.objectId === target.objectId
        && premises.some(premise => premise.subjectId === candidates[0].fact.subjectId && premise.predicate === "sqlOperation"), "SQL 引用不是同组件唯一表声明");
    }
    if (["readsTable", "writesTable", "declaresSqlTable"].includes(fact.predicate)) {
      const operation = premises.find(premise => premise.subjectId === subject.objectId && premise.predicate === "sqlOperation");
      check(operation && (fact.predicate === "readsTable" ? operation.value.value === "SELECT"
        : fact.predicate === "declaresSqlTable" ? operation.value.value === "CREATE" : ["INSERT", "UPDATE", "DELETE"].includes(operation.value.value)), "SQL 关系没有相应操作声明");
    }
    if (fact.predicate === "embedsSql") check(stated(subject) && stated(target, "sqlOperation") && encloses(subject.anchor, target.anchor), "字面 SQL 不属于该调用");
    if (fact.predicate === "declaredTestBody") check(stated(subject, "testRegistration") && stated(target) && encloses(subject.anchor, target.anchor), "测试体不属于其注册声明");
    if (fact.predicate === "declaredAssertion") check(stated(subject) && stated(target) && encloses(subject.anchor, target.anchor), "断言不属于该测试声明");
  }
}
