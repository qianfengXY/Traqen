import { canonicalDigest } from "./identity.js";
import { requireF002 } from "./errors.js";

export const testAssetPredicates = new Set(["registrationName", "testBody", "testFramework", "assertionName", "assertionReceiver", "hasAssertion"]);
const assertionMethods = new Set(["ok", "equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "throws", "doesNotThrow", "rejects", "doesNotReject", "ifError", "match", "doesNotMatch", "fail"]);
const javaMethods = new Set(["assertEquals", "assertNotEquals", "assertTrue", "assertFalse", "assertNull", "assertNotNull", "assertSame", "assertNotSame", "assertArrayEquals", "assertIterableEquals", "assertThrows", "assertDoesNotThrow", "fail"]);
const check = (value, reason) => requireF002(value, "F002_RECORD_PREMISE_REQUIRED", reason, { status: 422 });

export function verifyTestAssets({ objects, facts, evidence, materials, profile }) {
  const bySubject = new Map(), counts = new Map(), typeNames = new Map();
  for (const o of objects.values()) if (o.kind === "JAVA_TYPE") { if (!typeNames.has(o.materialId)) typeNames.set(o.materialId, new Set()); typeNames.get(o.materialId).add(o.name); }
  const enabled = f => ["f002-javascript", "f002-java"].includes(f.ruleRef?.id) && f.ruleRef?.version === "2";
  for (const f of facts.values()) if (enabled(f)) { if (!bySubject.has(f.subjectId)) bySubject.set(f.subjectId, []); bySubject.get(f.subjectId).push(f); }
  const property = (id, predicate, basis = "DECLARED") => {
    const values = (bySubject.get(id) ?? []).filter(f => f.predicate === predicate && f.basis === basis);
    check(values.length === 1, `测试前提缺少唯一 ${predicate}`); return values[0];
  };
  const exact = (f, expected) => check(f.premiseFactIds.length === expected.length && new Set(f.premiseFactIds).size === expected.length && expected.every(id => f.premiseFactIds.includes(id)), "测试绑定前提不是精确声明集合");
  const range = (outer, inner) => outer?.kind === "TEXT" && inner?.kind === "TEXT" && inner.byteStart >= outer.byteStart && inner.byteEnd <= outer.byteEnd;
  const anchored = (f, object) => check(f.evidenceIds.some(id => { const e = evidence.get(id); return e.materialId === object.materialId
    && canonicalDigest("ANCHOR", e.anchor) === canonicalDigest("ANCHOR", object.anchor); }), "测试事实未绑定其确切语法位置");
  const jsImport = (f, object) => {
    const imports = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.predicate === "path" && objects.get(p.subjectId)?.kind === "IMPORT");
    check(imports.length === 1, "测试框架缺少唯一 import 路径前提");
    const path = imports[0], declaration = objects.get(path.subjectId);
    const name = property(declaration.objectId, "name"), imported = property(declaration.objectId, "importedName");
    check([path, name, imported].every(p => p.basis === "DECLARED" && p.ruleRef.id === "f002-javascript" && p.ruleRef.version === "2")
      && declaration.materialId === object.materialId && path.value?.value === f.value.value, "测试导入不是同材料显式框架声明");
    return { path, name, imported };
  };
  const javaImport = (f, object, receiver, qualified, kind) => {
    check(!typeNames.get(object.materialId)?.has(receiver.split(".")[0]), "测试框架名称被同材料类型遮蔽");
    if (receiver === qualified && kind === "TYPE") return [];
    const paths = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.predicate === "path" && p.value?.value === qualified && objects.get(p.subjectId)?.kind === "IMPORT");
    check(paths.length === 1, "JUnit 缺少确切导入前提");
    const declaration = objects.get(paths[0].subjectId), importKind = property(declaration.objectId, "importKind");
    check(declaration.materialId === object.materialId && declaration.name === qualified && importKind.value?.value === kind && paths[0].basis === "DECLARED", "JUnit 导入类别或材料不匹配");
    if (kind === "TYPE") check(receiver === qualified.split(".").at(-1), "JUnit 接收者不是所列类型名称");
    return [paths[0].factId, importKind.factId];
  };
  for (const o of objects.values()) if (["TEST_CASE", "TEST_ASSERTION"].includes(o.kind) && enabled({ ruleRef: materials.get(o.materialId).ruleRef })) {
    property(o.objectId, "testFramework", "DERIVED");
    if (o.kind === "TEST_CASE") property(o.objectId, "testBody");
    const key = `${o.materialId}:${o.kind}`, count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
    check(count <= (o.kind === "TEST_CASE" ? profile.extractionLimits.maxTestCases ?? 2000 : profile.extractionLimits.maxTestAssertions ?? 10_000), "测试资产超出固定材料预算");
  }
  for (const f of facts.values()) {
    if (!enabled(f)) continue;
    const object = objects.get(f.subjectId);
    if (f.predicate === "testBody") {
      const body = objects.get(f.targetId);
      check(object.kind === "TEST_CASE" && body.materialId === object.materialId && ["FUNCTION", "JAVA_METHOD"].includes(body.kind) && range(object.anchor, body.anchor), "测试体不是同声明范围内的直接函数或方法");
      if (f.ruleRef.id === "f002-java") check(object.parentId === body.objectId, "JUnit 测试体不是注解方法的直接归属");
    }
    if (f.predicate === "testFramework") {
      const isCase = object.kind === "TEST_CASE"; check(isCase || object.kind === "TEST_ASSERTION", "测试框架主体类型无效");
      const name = property(object.objectId, isCase ? "testName" : "assertionName"), registration = property(object.objectId, isCase ? "registrationName" : "assertionReceiver");
      if (isCase) check(!/(?:password|secret|token|api[_-]?key)/i.test(name.value.value) && Buffer.byteLength(name.value.value, "utf8") <= (profile.extractionLimits.maxTestNameBytes ?? 4096), "测试名称受限或越过固定字节预算");
      const body = isCase ? property(object.objectId, "testBody") : null;
      if (f.ruleRef.id === "f002-javascript") {
        const imported = jsImport(f, object), module = imported.path.value.value, symbol = imported.imported.value.value;
        if (isCase) check((module === "node:test" && ["default", "test", "it"].includes(symbol) || ["vitest", "@jest/globals"].includes(module) && ["test", "it"].includes(symbol))
          && registration.value.value === imported.name.value.value, "测试注册名不属于所列框架导入");
        else {
          check(["node:assert", "node:assert/strict"].includes(module), "断言模块不是支持的显式 Node 导入");
          const receiver = registration.value.value;
          check(receiver ? receiver === imported.name.value.value && symbol === "default" && assertionMethods.has(name.value.value)
            : name.value.value === imported.name.value.value && (symbol === "default" || assertionMethods.has(symbol)), "断言接收者或直接调用名与 import 不符");
        }
        exact(f, [name.factId, registration.factId, ...(body ? [body.factId] : []), imported.path.factId, imported.name.factId, imported.imported.factId]);
      } else {
        check(f.value?.value === "junit-jupiter", "JUnit 框架名称无效");
        if (isCase) {
          const method = objects.get(body.targetId), methodName = property(method.objectId, "name");
          const annotationNames = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.predicate === "annotationName" && objects.get(p.subjectId)?.parentId === method.objectId);
          check(annotationNames.length === 1 && annotationNames[0].value.value === registration.value.value && name.value.value === methodName.value.value, "JUnit 用例与注解或方法名称前提不匹配");
          exact(f, [name.factId, registration.factId, body.factId, annotationNames[0].factId, methodName.factId, ...javaImport(f, object, registration.value.value, "org.junit.jupiter.api.Test", "TYPE")]);
        } else {
          check(javaMethods.has(name.value.value), "JUnit 断言名不在支持集合");
          exact(f, [name.factId, registration.factId, ...javaImport(f, object, registration.value.value,
            "org.junit.jupiter.api.Assertions" + (registration.value.value ? "" : "." + name.value.value), registration.value.value ? "TYPE" : "STATIC")]);
        }
      }
      anchored(f, object);
    }
    if (f.predicate === "hasAssertion") {
      const assertion = objects.get(f.targetId); check(object.kind === "TEST_CASE" && assertion.kind === "TEST_ASSERTION" && assertion.parentId === object.objectId
        && assertion.materialId === object.materialId && range(object.anchor, assertion.anchor), "断言不是该测试直接归属");
      exact(f, [property(object.objectId, "testFramework", "DERIVED").factId, property(assertion.objectId, "testFramework", "DERIVED").factId]); anchored(f, assertion);
    }
    if (f.predicate === "refersTo" && object.kind === "TEST_CASE") {
      const body = property(object.objectId, "testBody"), framework = property(object.objectId, "testFramework", "DERIVED");
      const calls = f.premiseFactIds.map(id => facts.get(id)).filter(p => p.predicate === "staticCalls" && p.basis === "DERIVED" && p.subjectId === body.targetId && p.targetId === f.targetId);
      check(calls.length === 1, "测试对象引用不是其直接测试体的已证明静态调用"); exact(f, [framework.factId, calls[0].factId]);
      check(f.evidenceIds.some(id => calls[0].evidenceIds.includes(id) && range(object.anchor, evidence.get(id).anchor)), "测试对象引用缺少同一原文调用证据");
    }
  }
}
