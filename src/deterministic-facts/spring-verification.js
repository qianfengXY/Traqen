import { canonicalDigest } from "./identity.js";
import { requireF002 } from "./errors.js";

export const springPredicates = new Set(["annotationType", "mappingPath", "mappingDefaultPath", "mappingMethod", "mappingMethodReference", "mappingDefaultMethod", "mappingClassAbsent"]);
const prefix = "org.springframework.web.bind.annotation.";
const shortcuts = new Map([["GetMapping", "GET"], ["PostMapping", "POST"], ["PutMapping", "PUT"], ["PatchMapping", "PATCH"], ["DeleteMapping", "DELETE"]]);
const controllers = new Set([prefix + "RestController", "org.springframework.stereotype.Controller"]);
const mappings = new Set([prefix + "RequestMapping", ...[...shortcuts.keys()].map(n => prefix + n)]);
const names = new Set([...controllers, ...mappings]);
const verbs = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]);
const check = (condition, message) => requireF002(condition, "F002_RECORD_PREMISE_REQUIRED", message, { status: 422 });

// Validate the published proof graph, not by rerunning the producer. The
// declared syntax leaves still need their sealed source evidence and replay.
export function verifySpringMappings({ objects, facts, evidence, materials, profile }) {
  const declarations = [...facts.values()].filter(f => f.ruleRef.id === "f002-java" && f.ruleRef.version === "2");
  const bySubject = new Map(), annotationsByOwner = new Map(), importsByMaterial = new Map(), typeNamesByMaterial = new Map(), contexts = new Map(), pathCounts = new Map();
  for (const o of objects.values()) {
    if (o.kind === "JAVA_ANNOTATION") { if (!annotationsByOwner.has(o.parentId)) annotationsByOwner.set(o.parentId, []); annotationsByOwner.get(o.parentId).push(o); }
    if (o.kind === "IMPORT") { if (!importsByMaterial.has(o.materialId)) importsByMaterial.set(o.materialId, []); importsByMaterial.get(o.materialId).push(o); }
    if (o.kind === "JAVA_TYPE") { if (!typeNamesByMaterial.has(o.materialId)) typeNamesByMaterial.set(o.materialId, new Set()); typeNamesByMaterial.get(o.materialId).add(o.name); }
  }
  for (const f of declarations) {
    if (!bySubject.has(f.subjectId)) bySubject.set(f.subjectId, []);
    bySubject.get(f.subjectId).push(f);
    const o = objects.get(f.subjectId);
    if (f.predicate === "path" && o.kind === "ROUTE") pathCounts.set(o.materialId, (pathCounts.get(o.materialId) ?? 0) + 1);
  }
  for (const count of pathCounts.values()) check(count <= (profile.extractionLimits.maxSpringPaths ?? 128), "Spring 路径数量越过固定材料预算");
  const props = (id, predicate, basis) => (bySubject.get(id) ?? []).filter(f => f.predicate === predicate && (!basis || f.basis === basis));
  const one = (id, predicate, basis = "DECLARED") => {
    const values = props(id, predicate, basis); check(values.length === 1, `Spring 前提缺少唯一 ${predicate} 声明`); return values[0];
  };
  const exact = (f, expected) => check(f.premiseFactIds.length === expected.length && expected.every(id => f.premiseFactIds.includes(id)) && new Set(f.premiseFactIds).size === expected.length, "Spring 前提不是所需声明的精确集合");
  const children = id => annotationsByOwner.get(id) ?? [];
  const bindings = id => props(id, "annotationType", "DERIVED");
  const binding = id => one(id, "annotationType", "DERIVED");
  const importsFor = (materialId, spelling, qualified) => {
    check(!typeNamesByMaterial.get(materialId)?.has(spelling.split(".")[0]), "Spring 注解或枚举名称被材料内声明遮蔽");
    if (spelling === qualified) return [];
    check(!spelling.includes(".") && spelling === qualified.split(".").at(-1), "Spring 名称不是精确全名或显式导入名");
    const candidates = (importsByMaterial.get(materialId) ?? []).filter(o => o.name.split(".").at(-1) === spelling
      && props(o.objectId, "importKind").some(f => f.value?.value === "TYPE"));
    check(candidates.length === 1 && candidates[0].name === qualified, "Spring 名称缺少唯一显式 TYPE 导入");
    const path = one(candidates[0].objectId, "path"), kind = one(candidates[0].objectId, "importKind");
    check(path.value?.value === qualified && kind.value?.value === "TYPE", "Spring 导入声明不匹配绑定");
    return [path.factId, kind.factId];
  };
  const validPath = value => typeof value === "string" && !/[\s\u0000-\u001f\u007f\\?#*$]/.test(value) && !value.includes("//")
    && value.split("/").every(part => !/[{}]/.test(part) || /^\{[A-Za-z_$][\w$]*\}$/.test(part));
  const anchored = (f, object) => check(f.evidenceIds.some(id => {
    const e = evidence.get(id); return e.materialId === object.materialId && canonicalDigest("ANCHOR", e.anchor) === canonicalDigest("ANCHOR", object.anchor);
  }), "Spring 推导证据没有绑定其原注解位置");
  const context = route => {
    if (contexts.has(route.objectId)) return contexts.get(route.objectId);
    const annotation = objects.get(route.parentId), method = objects.get(annotation?.parentId), type = objects.get(method?.parentId);
    check(route.kind === "ROUTE" && annotation?.kind === "JAVA_ANNOTATION" && method?.kind === "JAVA_METHOD" && type?.kind === "JAVA_TYPE"
      && [annotation, method, type].every(o => o.materialId === route.materialId) && type.parentId === materials.get(type.materialId).rootObjectId,
    "Spring 路由未绑定同材料直接控制器、方法与映射注解");
    const inherited = one(type.objectId, "hasInheritance"), typeKind = one(type.objectId, "type");
    check(inherited.value?.value === false && typeKind.value?.value === "class", "Spring 控制器范围包含继承或非 class 声明");
    const control = children(type.objectId).flatMap(o => bindings(o.objectId)).filter(f => controllers.has(f.value?.value));
    const methodMappings = children(method.objectId).filter(o => /Mapping$/.test(o.name));
    check(control.length === 1 && methodMappings.length === 1 && methodMappings[0].objectId === annotation.objectId, "Spring 控制器或方法映射不唯一");
    const childBinding = binding(annotation.objectId); check(mappings.has(childBinding.value?.value), "Spring 方法不是直接已知映射注解");
    const bases = children(type.objectId).filter(o => /Mapping$/.test(o.name)); check(bases.length <= 1, "Spring 类级映射不唯一");
    const base = bases[0], baseBinding = base ? binding(base.objectId) : null;
    if (base) check(baseBinding.value?.value === prefix + "RequestMapping", "Spring 类级映射不是直接 RequestMapping");
    const result = { annotation, method, type, base, baseBinding, ids: [control[0].factId, inherited.factId, childBinding.factId], childBinding };
    contexts.set(route.objectId, result); return result;
  };
  for (const f of declarations) {
    const object = objects.get(f.subjectId);
    if (f.predicate === "annotationType") {
      const name = one(object.objectId, "annotationName");
      check(object.kind === "JAVA_ANNOTATION" && object.name === name.value?.value && names.has(f.value?.value), "Spring 注解绑定的主体或限定名称不成立");
      exact(f, [name.factId, ...importsFor(object.materialId, name.value.value, f.value.value)]); anchored(f, object);
    }
    if (f.predicate === "mappingPath") check(validPath(f.value?.value), "Spring 路径不是受支持的字面模式");
    if (["mappingDefaultPath", "mappingDefaultMethod", "mappingClassAbsent"].includes(f.predicate)) {
      check(f.value?.value === true, "Spring 默认前提必须明确为 true");
      if (f.predicate === "mappingDefaultPath") check(props(object.objectId, "mappingPath").length === 0, "Spring 默认路径与显式路径冲突");
      if (f.predicate === "mappingDefaultMethod") check(props(object.objectId, "mappingMethodReference").length === 0 && binding(object.objectId).value.value === prefix + "RequestMapping", "Spring 默认方法与显式枚举或快捷注解冲突");
      if (f.predicate === "mappingClassAbsent") check(children(object.objectId).every(a => !/Mapping$/.test(a.name)), "Spring 类级缺省与已有映射冲突");
    }
    if (f.predicate === "mappingMethod") {
      const references = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.predicate === "mappingMethodReference" && p.subjectId === object.objectId);
      const b = binding(object.objectId), shortcut = shortcuts.get(b.value.value.slice(prefix.length));
      if (shortcut) { check(f.value?.value === shortcut, "Spring 快捷注解 HTTP 条件不匹配"); exact(f, [b.factId]); }
      else if (f.value?.value === "ANY") { check(b.value.value === prefix + "RequestMapping", "Spring ANY 不是 RequestMapping 缺省"); exact(f, [b.factId, one(object.objectId, "mappingDefaultMethod").factId]); }
      else {
        check(b.value.value === prefix + "RequestMapping" && references.length === 1 && verbs.has(f.value?.value), "Spring HTTP 枚举前提不成立");
        const spelling = references[0].value?.value, split = typeof spelling === "string" ? spelling.lastIndexOf(".") : -1;
        check(split > 0 && spelling.slice(split + 1) === f.value.value, "Spring HTTP 枚举成员不匹配");
        exact(f, [references[0].factId, ...importsFor(object.materialId, spelling.slice(0, split), prefix + "RequestMethod")]);
      }
    }
    if (!["handlesRoute", "path", "httpMethod"].includes(f.predicate) || (f.predicate !== "handlesRoute" && object.kind !== "ROUTE")) continue;
    const route = f.predicate === "handlesRoute" ? objects.get(f.targetId) : object;
    check(f.basis === "DERIVED", "Spring 路由必须保留显式推导依据");
    const c = context(route); anchored(f, c.annotation);
    check(canonicalDigest("ANCHOR", route.anchor) === canonicalDigest("ANCHOR", c.annotation.anchor), "Spring 路由身份不属于该注解原位置");
    if (f.predicate === "handlesRoute") {
      check(f.subjectId === c.method.objectId, "Spring 处理器不是注解直接声明的方法"); exact(f, [one(c.method.objectId, "name").factId, ...c.ids]);
    } else {
      const premises = f.premiseFactIds.map(id => facts.get(id)), methods = premises.filter(p => p.predicate === "mappingMethod" && p.subjectId === c.annotation.objectId && p.basis === "DERIVED");
      check(methods.length === 1, "Spring 路由缺少唯一方法条件前提");
      if (f.predicate === "httpMethod") { check(f.value?.value === methods[0].value.value, "Spring 路由 HTTP 条件不匹配"); exact(f, [c.childBinding.factId, methods[0].factId]); }
      else {
        const selectPath = (id, absent = false) => {
          const values = premises.filter(p => p.subjectId === id && p.basis === "DECLARED"
            && (absent ? p.predicate === "mappingClassAbsent" : ["mappingPath", "mappingDefaultPath"].includes(p.predicate)));
          check(values.length === 1, "Spring 拼接缺少唯一类级或方法路径条件"); return values[0];
        };
        const base = selectPath(c.base?.objectId ?? c.type.objectId, !c.base), suffix = selectPath(c.annotation.objectId);
        const b = base.predicate === "mappingPath" ? base.value.value : "", s = suffix.predicate === "mappingPath" ? suffix.value.value : "";
        const leading = p => p && p[0] !== "/" ? "/" + p : p;
        const expected = (s ? leading(b).replace(/\/$/, "") + leading(s) : leading(b)) || "/";
        check(f.value?.value === expected, "Spring 路由路径不是所列字面条件的固定拼接");
        exact(f, [...c.ids, base.factId, suffix.factId, methods[0].factId, ...(c.baseBinding ? [c.baseBinding.factId] : [])]);
      }
    }
  }
}
