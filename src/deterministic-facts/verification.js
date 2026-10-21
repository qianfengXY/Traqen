import {
  canonicalDigest,
  createEvidenceId,
  createFactId,
  createGapId,
  createGraphVersionId,
  createMaterialId,
  createObjectId,
} from "./identity.js";
import { requireF002 } from "./errors.js";
import { installedF002Rules } from "./rules.js";
import { predicateDefinitions } from "./vocabulary.js";
import { validJsonPointer } from "./extraction/json-syntax.js";
import path from "node:path";
import { decodePathBytes } from "../source-truth/identity.js";
import { springPredicates, verifySpringMappings } from "./spring-verification.js";
import { testAssetPredicates, verifyTestAssets } from "./test-verification.js";
import { reportPredicates, verifyReports } from "./report-verification.js";
import { verifyEndpointContracts } from "./endpoint-verification.js";
import { verifyJavaBindings } from "./java-binding-verification.js";
import { containsPrivateKey } from "./sensitive-content.js";

const identifier = /^[a-f0-9]{64}$/;
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const recordKinds = new Set(["MATERIAL", "OBJECT", "EVIDENCE", "FACT", "GAP"]);

function normalizedPayload(record) {
  if (record.payload !== undefined) return record.payload;
  const payload = { ...record };
  delete payload.kind;
  delete payload.id;
  return payload;
}

function checked(condition, code, message) {
  requireF002(condition, code, message, { status: 422 });
}

function hex(value, code = "F002_RECORD_ID_INVALID") { checked(typeof value === "string" && identifier.test(value), code, "记录身份必须是内容哈希"); }

function anchor(value) {
  checked(value && typeof value === "object" && !Array.isArray(value) && typeof value.kind === "string", "F002_RECORD_ANCHOR_INVALID", "证据锚点无效");
  if (value.kind === "TEXT") {
    for (const key of ["byteStart", "byteEnd", "lineStart", "columnStart", "lineEnd", "columnEnd"]) checked(Number.isInteger(value[key]) && value[key] >= 0, "F002_RECORD_ANCHOR_INVALID", "文本锚点坐标无效");
    checked(value.byteEnd >= value.byteStart && value.lineStart >= 1 && value.columnStart >= 1 && value.lineEnd >= value.lineStart,
      "F002_RECORD_ANCHOR_INVALID", "文本锚点范围无效");
  } else if (value.kind === "JSON_POINTER") {
    checked(validJsonPointer(value.pointer) && Buffer.byteLength(value.pointer, "utf8") <= 8192 && value.textRange?.kind === "TEXT",
      "F002_RECORD_ANCHOR_INVALID", "JSON Pointer 或其物理范围无效");
    anchor(value.textRange);
  } else if (value.kind === "BINARY" || value.kind === "IMAGE") {
    checked(value.digest === null || identifier.test(value.digest), "F002_RECORD_ANCHOR_INVALID", "二进制锚点摘要无效");
    if (value.kind === "IMAGE") for (const key of ["width", "height"]) checked(Number.isInteger(value[key]) && value[key] >= 0, "F002_RECORD_ANCHOR_INVALID", "图像锚点尺寸无效");
  } else checked(false, "F002_RECORD_ANCHOR_INVALID", "证据锚点类型不受支持");
  return value;
}

function exactIdentity(actual, expected) {
  hex(actual);
  checked(actual === expected, "F002_RECORD_ID_INVALID", "记录身份未绑定其规范载荷");
}

function typedPropertyValue(value) {
  checked(value && typeof value === "object" && !Array.isArray(value) && typeof value.datatype === "string"
    && Object.hasOwn(value, "value"), "F002_RECORD_VALUE_INVALID", "属性事实值缺少声明类型或实际值");
  const valid = value.datatype === "string" ? typeof value.value === "string"
    : value.datatype === "boolean" ? typeof value.value === "boolean"
      : value.datatype === "integer" ? Number.isInteger(value.value)
        : value.datatype === "number" ? typeof value.value === "number" && Number.isFinite(value.value)
          : value.datatype === "null" && value.value === null;
  checked(valid, "F002_RECORD_VALUE_INVALID", "属性事实值不符合声明 datatype");
  return value;
}

function validateRecord(record, { workspaceId, bundleId, profile = null }) {
  checked(record && typeof record === "object" && !Array.isArray(record) && recordKinds.has(record.kind),
    "F002_RECORD_SCHEMA_INVALID", "记录类型不受支持");
  hex(record.id);
  const payload = normalizedPayload(record);
  checked(payload && typeof payload === "object" && !Array.isArray(payload), "F002_RECORD_SCHEMA_INVALID", "记录载荷无效");
  try { canonicalDigest("RECORD", { kind: record.kind, id: record.id, payload }); }
  catch { checked(false, "F002_RECORD_SCHEMA_INVALID", "记录载荷不是规范值"); }
  checked(!containsPrivateKey(JSON.stringify(payload)), "F002_RECORD_SENSITIVE", "私钥材料不能进入封存记录");
  if (record.kind === "MATERIAL") {
    checked(payload.materialId === record.id && typeof payload.componentId === "string" && typeof payload.pathBytes === "string"
      && typeof payload.mediaType === "string" && typeof payload.contentAvailable === "boolean" && typeof payload.kind === "string"
      && typeof payload.rootObjectId === "string", "F002_RECORD_SCHEMA_INVALID", "材料记录缺少来源坐标");
    if (payload.contentAvailable) hex(payload.contentDigest, "F002_RECORD_SCHEMA_INVALID");
    else checked(payload.contentDigest === null, "F002_RECORD_SCHEMA_INVALID", "不可读取材料不能伪造内容摘要");
    exactIdentity(record.id, createMaterialId({ workspaceId, bundleId, componentId: payload.componentId, pathBytes: payload.pathBytes }));
  } else if (record.kind === "OBJECT") {
    checked(payload.objectId === record.id && typeof payload.materialId === "string" && typeof payload.kind === "string" && typeof payload.name === "string", "F002_RECORD_SCHEMA_INVALID", "对象记录缺少身份字段");
    hex(payload.materialId); anchor(payload.anchor);
    if (Object.hasOwn(payload, "parentId")) hex(payload.parentId, "F002_RECORD_REFERENCE_INVALID");
    exactIdentity(record.id, createObjectId({ materialId: payload.materialId, objectKind: payload.kind, anchor: payload.anchor }));
  } else if (record.kind === "EVIDENCE") {
    checked(payload.evidenceId === record.id && typeof payload.materialId === "string" && typeof payload.evidenceKind === "string", "F002_RECORD_SCHEMA_INVALID", "证据记录缺少身份字段");
    hex(payload.materialId); hex(payload.contentDigest, "F002_RECORD_SCHEMA_INVALID"); anchor(payload.anchor);
    exactIdentity(record.id, createEvidenceId({ materialId: payload.materialId, contentDigest: payload.contentDigest, anchor: payload.anchor, evidenceKind: payload.evidenceKind }));
  } else if (record.kind === "FACT") {
    checked(payload.factId === record.id && ["PROPERTY", "RELATION"].includes(payload.kind) && typeof payload.subjectId === "string"
      && typeof payload.predicate === "string" && typeof payload.basis === "string" && Array.isArray(payload.evidenceIds)
      && Array.isArray(payload.premiseFactIds) && payload.ruleRef && typeof payload.ruleRef === "object", "F002_RECORD_SCHEMA_INVALID", "事实记录缺少来源或推导前提");
    hex(payload.subjectId); payload.evidenceIds.forEach((value) => hex(value)); payload.premiseFactIds.forEach((value) => hex(value));
    if (payload.kind === "RELATION") { hex(payload.targetId, "F002_RECORD_SCHEMA_INVALID"); checked(payload.value === undefined, "F002_RECORD_SCHEMA_INVALID", "关系事实不能同时携带值"); }
    else {
      checked(payload.targetId === undefined, "F002_RECORD_SCHEMA_INVALID", "属性事实不能携带目标");
      typedPropertyValue(payload.value);
    }
    if (profile) {
      const predicate = predicateDefinitions.get(payload.predicate);
      checked(predicate && predicate.form === payload.kind, "F002_RECORD_VOCABULARY_INVALID", "事实谓词或其对象范围不在固定词表内");
      checked(["DECLARED", "DERIVED"].includes(payload.basis), "F002_RECORD_VOCABULARY_INVALID", "事实依据类型不在固定词表内");
      checked(typeof payload.ruleRef.id === "string" && /^f002-[a-z][a-z0-9-]*$/.test(payload.ruleRef.id)
        && typeof payload.ruleRef.version === "string" && /^[1-9][0-9]*$/.test(payload.ruleRef.version),
      "F002_RECORD_RULE_INVALID", "事实规则引用无效");
      const capability = payload.ruleRef.id.slice("f002-".length);
      checked(profile.ruleVersions?.includes(`${capability}@${payload.ruleRef.version}`), "F002_RECORD_RULE_INVALID", "事实规则不属于当前能力配置");
      if (["contains", "declares", "imports"].includes(payload.predicate)) checked(payload.ruleRef.version === "2"
        && (["javascript", "java", "markdown", "json"].includes(capability) || (payload.predicate === "contains" && (capability === "properties" || (capability === "junit-xml" && profile.extractionLimits?.testReports === "literal-reports-v1")))), "F002_RECORD_RULE_INVALID", "结构事实不能挂到未提供该能力的旧规则");
      if (["type", "literalValue", "declaresParameter"].includes(payload.predicate)) checked(payload.ruleRef.version === "2"
        && (capability === "json" || (capability === "properties" && payload.predicate !== "declaresParameter")
          || (capability === "markdown" && payload.predicate === "literalValue" && profile.extractionLimits?.documentSyntax === "static-document-v1")
          || (capability === "java" && payload.predicate !== "literalValue" && profile.extractionLimits?.javaSyntax === "ast-declarations-v1" && payload.basis === "DECLARED")),
        "F002_RECORD_RULE_INVALID", "字面声明不能挂到未提供该能力的规则");
      if (["packageName", "qualifiedName", "signature", "staticModifier", "hasInheritance", "parameterIndex", "annotationName", "importKind", "argumentCount", "receiverName"].includes(payload.predicate)) checked(capability === "java" && payload.ruleRef.version === "2"
        && profile.extractionLimits?.javaSyntax === "ast-declarations-v1" && payload.basis === "DECLARED", "F002_RECORD_RULE_INVALID", "Java AST 声明不属于当前固定能力");
      if (["visibility", "hasTypeParameters", "lexicalShadow"].includes(payload.predicate)) checked(capability === "java" && payload.ruleRef.version === "2"
        && profile.extractionLimits?.javaBindings === "component-static-zero-v1" && payload.basis === "DECLARED", "F002_RECORD_RULE_INVALID", "Java 绑定条件不属于当前固定能力");
      if (["bindingName", "importedName", "exportedName"].includes(payload.predicate)) checked(capability === "javascript" && payload.ruleRef.version === "2"
        && profile.extractionLimits?.javascriptBindings === "lexical-bindings-v1" && payload.basis === "DECLARED",
        "F002_RECORD_RULE_INVALID", "词法绑定声明不属于当前固定 JavaScript 能力");
      if (springPredicates.has(payload.predicate)) checked(capability === "java" && payload.ruleRef.version === "2"
        && profile.extractionLimits?.javaSyntax === "ast-declarations-v1" && profile.extractionLimits?.springMappings === "ast-literals-v1"
        && payload.basis === (["annotationType", "mappingMethod"].includes(payload.predicate) ? "DERIVED" : "DECLARED"),
        "F002_RECORD_RULE_INVALID", "Spring 前提不属于当前固定直接注解能力");
      if (testAssetPredicates.has(payload.predicate)) checked(["java", "javascript"].includes(capability) && payload.ruleRef.version === "2"
        && profile.extractionLimits?.testAssets === "framework-declarations-v1"
        && payload.basis === (["testFramework", "hasAssertion"].includes(payload.predicate) ? "DERIVED" : "DECLARED"),
        "F002_RECORD_RULE_INVALID", "测试资产不属于当前固定框架声明能力");
      if (reportPredicates.has(payload.predicate)) checked(["json", "junit-xml"].includes(capability) && payload.ruleRef.version === "2"
        && profile.extractionLimits?.testReports === "literal-reports-v1" && payload.basis === "DECLARED"
        && (payload.predicate !== "reportOutcomeMarker" || capability === "junit-xml"), "F002_RECORD_RULE_INVALID", "报告字段不属于固定静态声明能力");
      if (payload.predicate === "matchesEndpointContract") checked(capability === "json" && payload.ruleRef.version === "2" && payload.basis === "DERIVED"
        && profile.extractionLimits?.endpointContracts === "component-path-shape-v1", "F002_RECORD_RULE_INVALID", "端点合同关系不属于固定组件匹配规则");
      if (["routerKind", "mountsRouter", "effectivePath"].includes(payload.predicate)) checked(capability === "javascript" && payload.ruleRef.version === "2"
        && profile.extractionLimits?.expressStatic === "top-level-literals-v1" && payload.basis === (payload.predicate === "routerKind" ? "DECLARED" : "DERIVED"),
        "F002_RECORD_RULE_INVALID", "静态挂载不属于当前固定 Express 能力");
    }
  } else {
    checked(payload.gapId === record.id && typeof payload.origin === "string" && typeof payload.capability === "string" && typeof payload.code === "string"
      && payload.reason && typeof payload.reason === "object", "F002_RECORD_SCHEMA_INVALID", "缺口记录缺少原因或能力");
    if (payload.materialId !== null && payload.materialId !== undefined) hex(payload.materialId);
    if (payload.objectId !== null && payload.objectId !== undefined) hex(payload.objectId);
    if (payload.anchor !== null && payload.anchor !== undefined) anchor(payload.anchor);
    exactIdentity(record.id, createGapId({ origin: payload.origin, materialId: payload.materialId ?? null, objectId: payload.objectId ?? null,
      capability: payload.capability, code: payload.code, location: payload.anchor ?? null, reason: payload.reason }));
  }
  return { kind: record.kind, id: record.id, payload };
}

function validateClosure(records, { profile = null, bundleId = null } = {}) {
  const byKind = new Map([...recordKinds].map((kind) => [kind, new Map()]));
  for (const record of records) byKind.get(record.kind).set(record.id, record.payload);
  const materials = byKind.get("MATERIAL"), objects = byKind.get("OBJECT"), evidence = byKind.get("EVIDENCE"), facts = byKind.get("FACT");
  const containment = new Set([...facts.values()].filter(fact => fact.kind === "RELATION" && fact.predicate === "contains")
    .map(fact => `${fact.subjectId}:${fact.targetId}`));
  for (const [id, payload] of materials) {
    const root = objects.get(payload.rootObjectId);
    checked(root && root.materialId === id, "F002_RECORD_REFERENCE_INVALID", "材料根对象不存在或越过材料边界");
  }
  for (const payload of objects.values()) {
    checked(materials.has(payload.materialId), "F002_RECORD_REFERENCE_INVALID", "对象引用了不存在的材料");
    const material = materials.get(payload.materialId);
    if (profile && material.ruleRef?.version === "2" && payload.objectId !== material.rootObjectId) checked(typeof payload.parentId === "string",
      "F002_RECORD_REFERENCE_INVALID", "新结构非根对象缺少直接父引用");
    if (payload.parentId !== undefined) {
      const parent = objects.get(payload.parentId);
      checked(parent && parent.materialId === payload.materialId && materials.get(payload.materialId).rootObjectId !== payload.objectId,
        "F002_RECORD_REFERENCE_INVALID", "父对象不存在、跨材料或材料根对象具有父引用");
      if (profile && materials.get(payload.materialId).ruleRef?.version === "2") checked(containment.has(`${payload.parentId}:${payload.objectId}`),
        "F002_RECORD_REFERENCE_INVALID", "新结构父引用缺少对应的包含事实");
    }
  }
  const parentVisited = new Set();
  for (const id of objects.keys()) {
    const chain = new Set();
    let current = id;
    while (current && !parentVisited.has(current)) {
      checked(!chain.has(current), "F002_RECORD_PARENT_CYCLE", "对象父结构存在环");
      chain.add(current); current = objects.get(current).parentId;
    }
    for (const item of chain) parentVisited.add(item);
  }
  for (const payload of evidence.values()) {
    const material = materials.get(payload.materialId);
    checked(material && material.contentAvailable && material.contentDigest === payload.contentDigest, "F002_RECORD_REFERENCE_INVALID", "证据未绑定可读取材料的精确内容");
  }
  for (const payload of facts.values()) {
    checked(objects.has(payload.subjectId), "F002_RECORD_REFERENCE_INVALID", "事实主体不存在");
    if (payload.kind === "RELATION") checked(objects.has(payload.targetId), "F002_RECORD_REFERENCE_INVALID", "关系事实目标不存在");
    checked(payload.evidenceIds.length > 0, "F002_RECORD_EVIDENCE_REQUIRED", "事实必须保留至少一条证据");
    for (const id of payload.evidenceIds) checked(evidence.has(id), "F002_RECORD_REFERENCE_INVALID", "事实证据不存在");
    for (const id of payload.premiseFactIds) checked(facts.has(id), "F002_RECORD_REFERENCE_INVALID", "推导事实前提不存在");
    const subject = objects.get(payload.subjectId);
    if (profile?.extractionLimits?.javaSyntax === "ast-declarations-v1" && payload.ruleRef.id === "f002-java") {
      if (payload.predicate === "declaresParameter") {
        const parameter = objects.get(payload.targetId);
        checked(payload.basis === "DECLARED" && parameter?.kind === "JAVA_PARAMETER" && parameter.parentId === subject.objectId
          && subject.materialId === parameter.materialId, "F002_RECORD_REFERENCE_INVALID", "Java 参数声明没有绑定直接声明者");
      }
      if (payload.predicate === "parameterIndex") checked(Number.isInteger(payload.value.value) && payload.value.value >= 0,
        "F002_RECORD_DECLARATION_INVALID", "Java 参数位置必须为非负整数");
      if (payload.predicate === "signature") {
        const declarations = [...facts.values()].filter(p => p.ruleRef.id === "f002-java" && p.ruleRef.version === "2" && p.basis === "DECLARED");
        const declared = (id, predicate) => declarations.filter(p => p.subjectId === id && p.predicate === predicate);
        const names = declared(subject.objectId, "name");
        const parameters = [...objects.values()].filter(o => o.kind === "JAVA_PARAMETER" && o.parentId === subject.objectId).map(o => ({ object: o, indices: declared(o.objectId, "parameterIndex"), types: declared(o.objectId, "type") }));
        checked(names.length === 1 && parameters.every(p => p.indices.length === 1 && p.types.length === 1), "F002_RECORD_DECLARATION_INVALID", "Java 签名缺少唯一名称、参数位置或类型声明");
        parameters.sort((a, b) => a.indices[0].value.value - b.indices[0].value.value);
        checked(parameters.every((p, index) => p.indices[0].value.value === index) && payload.value.value === `${names[0].value.value}(${parameters.map(p => p.types[0].value.value).join(",")})`,
          "F002_RECORD_DECLARATION_INVALID", "Java 签名未满足其参数顺序及类型声明");
      }
      if (payload.predicate === "staticCalls" && !(profile.extractionLimits?.javaBindings === "component-static-zero-v1" && payload.premiseFactIds.length !== 5)) {
        const target = objects.get(payload.targetId), owner = objects.get(target.parentId), premises = payload.premiseFactIds.map(id => facts.get(id));
        const declared = (id, predicate, value) => premises.filter(p => p.subjectId === id && p.predicate === predicate && p.basis === "DECLARED"
          && p.ruleRef.id === "f002-java" && p.ruleRef.version === "2" && (value === undefined || p.value?.value === value));
        checked(payload.basis === "DERIVED" && payload.premiseFactIds.length === 5 && target.kind === "JAVA_METHOD" && subject.kind === "JAVA_METHOD"
          && owner?.kind === "JAVA_TYPE" && subject.parentId === owner.objectId && target.materialId === subject.materialId,
          "F002_RECORD_PREMISE_REQUIRED", "Java 静态调用缺少同材料同声明者的五项前提");
        const names = premises.filter(p => p.predicate === "name" && p.basis === "DECLARED" && objects.get(p.subjectId)?.kind === "JAVA_CALL"
          && objects.get(p.subjectId).parentId === subject.objectId);
        checked(names.length === 1 && declared(target.objectId, "name", names[0].value.value).length === 1
          && declared(target.objectId, "staticModifier", true).length === 1 && declared(owner.objectId, "hasInheritance", false).length === 1,
          "F002_RECORD_PREMISE_REQUIRED", "Java 调用名称、static 或受限继承前提不成立");
        const occurrence = objects.get(names[0].subjectId);
        checked(declared(occurrence.objectId, "argumentCount", 0).length === 1 && occurrence.materialId === subject.materialId,
          "F002_RECORD_PREMISE_REQUIRED", "Java 调用缺少确切零参数位置前提");
        const declarations = [...facts.values()].filter(p => p.basis === "DECLARED" && p.ruleRef.id === "f002-java" && p.ruleRef.version === "2");
        const targets = declarations.filter(p => p.predicate === "name" && p.value?.value === names[0].value.value && objects.get(p.subjectId)?.kind === "JAVA_METHOD"
          && objects.get(p.subjectId).parentId === owner.objectId);
        const parameters = [...objects.values()].filter(o => o.kind === "JAVA_PARAMETER" && o.parentId === target.objectId);
        const receiver = declarations.filter(p => p.subjectId === occurrence.objectId && p.predicate === "receiverName");
        checked(targets.length === 1 && parameters.length === 0 && receiver.length === 1 && ["", owner.name].includes(receiver[0].value?.value),
          "F002_RECORD_PREMISE_REQUIRED", "Java 调用目标重载、参数或接收者不能唯一成立");
        checked(payload.evidenceIds.some(id => evidence.get(id).materialId === occurrence.materialId
          && canonicalDigest("ANCHOR", evidence.get(id).anchor) === canonicalDigest("ANCHOR", occurrence.anchor)),
          "F002_RECORD_REFERENCE_INVALID", "Java 调用证据未绑定该语法位置");
      }
    }
    if (profile?.extractionLimits?.expressStatic === "top-level-literals-v1" && ["mountsRouter", "effectivePath", "handlesRoute"].includes(payload.predicate)
      && payload.ruleRef.id === "f002-javascript") {
      const premises = payload.premiseFactIds.map(id => facts.get(id));
      const declared = (id, predicate) => premises.filter(p => p.subjectId === id && p.predicate === predicate && p.basis === "DECLARED" && p.value?.datatype === "string");
      const validIdentity = object => object?.kind === "EXPRESS_ROUTER" && object.materialId === subject.materialId
        && declared(object.objectId, "name").some(p => p.value.value === object.name)
        && declared(object.objectId, "routerKind").some(p => ["application", "router"].includes(p.value.value));
      if (payload.predicate === "mountsRouter") {
        const target = objects.get(payload.targetId);
        const prefixes = premises.filter(p => p.predicate === "path" && p.basis === "DECLARED" && p.value?.datatype === "string"
          && objects.get(p.subjectId)?.kind === "EXPRESS_MOUNT" && objects.get(p.subjectId).parentId === subject.objectId && objects.get(p.subjectId).materialId === subject.materialId);
        checked(validIdentity(subject) && validIdentity(target) && declared(target.objectId, "routerKind").some(p => p.value.value === "router") && prefixes.length === 1,
          "F002_RECORD_PREMISE_REQUIRED", "挂载缺少同材料父子构造绑定或唯一前缀声明");
        const mount = objects.get(prefixes[0].subjectId);
        checked(payload.evidenceIds.some(id => evidence.get(id).materialId === subject.materialId && canonicalDigest("ANCHOR", evidence.get(id).anchor) === canonicalDigest("ANCHOR", mount.anchor)),
          "F002_RECORD_REFERENCE_INVALID", "挂载证据没有绑定对应声明位置");
      } else if (payload.predicate === "handlesRoute") {
        const target = objects.get(payload.targetId), router = objects.get(target.parentId);
        checked(target.materialId === subject.materialId && validIdentity(router) && declared(subject.objectId, "bindingName").length === 1
          && declared(target.objectId, "path").length === 1 && declared(target.objectId, "httpMethod").length === 1,
          "F002_RECORD_PREMISE_REQUIRED", "处理器绑定缺少函数名、路由或构造声明前提");
      } else {
        const paths = declared(subject.objectId, "path"), applications = premises.filter(p => p.predicate === "routerKind" && p.basis === "DECLARED" && p.value?.value === "application");
        checked(paths.length === 1 && applications.length === 1 && validIdentity(objects.get(applications[0].subjectId)),
          "F002_RECORD_PREMISE_REQUIRED", "拼接路径缺少唯一路由声明与应用上下文");
        let current = applications[0].subjectId, prefix = "";
        const chain = premises.filter(p => p.predicate === "mountsRouter" && p.basis === "DERIVED"), visited = new Set([current]);
        const remaining = new Set(chain);
        checked(chain.length <= (profile.extractionLimits.maxExpressMountDepth ?? 16), "F002_RECORD_PREMISE_REQUIRED", "拼接挂载链越界");
        while (remaining.size) {
          const next = [...remaining].filter(p => p.subjectId === current);
          checked(next.length === 1 && !visited.has(next[0].targetId), "F002_RECORD_PREMISE_REQUIRED", "拼接前提不是唯一无环挂载链");
          const edge = next[0], declarations = edge.premiseFactIds.map(id => facts.get(id));
          const mountPaths = declarations.filter(p => p.predicate === "path" && p.basis === "DECLARED" && p.value?.datatype === "string" && objects.get(p.subjectId)?.kind === "EXPRESS_MOUNT"
            && objects.get(p.subjectId).parentId === current);
          checked(mountPaths.length === 1, "F002_RECORD_PREMISE_REQUIRED", "挂载链缺少唯一前缀");
          prefix = prefix ? prefix.replace(/\/$/, "") + mountPaths[0].value.value : mountPaths[0].value.value;
          current = edge.targetId; visited.add(current); remaining.delete(edge);
        }
        const expected = prefix ? prefix.replace(/\/$/, "") + paths[0].value.value : paths[0].value.value;
        checked(current === subject.parentId && payload.value?.datatype === "string" && payload.value.value === expected,
          "F002_RECORD_PREMISE_REQUIRED", "拼接路径未满足精确挂载前提或目标路由所属关系");
      }
    }
    if (profile?.extractionLimits?.javascriptBindings === "lexical-bindings-v1" && payload.predicate === "staticCalls" && payload.ruleRef.id === "f002-javascript") {
      checked(payload.ruleRef.version === "2" && payload.basis === "DERIVED" && payload.premiseFactIds.length >= 2,
        "F002_RECORD_PREMISE_REQUIRED", "词法调用必须列出调用标识符和目标声明前提");
      const target = objects.get(payload.targetId), sourceMaterial = materials.get(subject.materialId), targetMaterial = materials.get(target.materialId);
      checked(sourceMaterial.componentId === targetMaterial.componentId, "F002_RECORD_REFERENCE_INVALID", "调用目标不能由同名跨组件对象替代");
      const premises = payload.premiseFactIds.map(id => facts.get(id));
      const declarations = premises.filter(p => p.basis === "DECLARED" && p.kind === "PROPERTY" && p.value?.datatype === "string"
        && p.ruleRef.id === "f002-javascript" && p.ruleRef.version === "2");
      const occurrenceNames = declarations.filter(p => p.predicate === "name" && objects.get(p.subjectId)?.kind === "JAVASCRIPT_CALL"
        && objects.get(p.subjectId).parentId === subject.objectId && objects.get(p.subjectId).materialId === subject.materialId);
      checked(occurrenceNames.length === 1, "F002_RECORD_PREMISE_REQUIRED", "调用缺少其实际词法位置和名称前提");
      const occurrence = objects.get(occurrenceNames[0].subjectId), calledName = occurrenceNames[0].value.value;
      checked(payload.evidenceIds.some(id => { const e = evidence.get(id); return e.materialId === subject.materialId && canonicalDigest("ANCHOR", e.anchor) === canonicalDigest("ANCHOR", occurrence.anchor); }),
        "F002_RECORD_REFERENCE_INVALID", "调用证据没有绑定该调用位置");
      const importNames = declarations.filter(p => p.predicate === "importedName" && objects.get(p.subjectId)?.kind === "IMPORT"
        && objects.get(p.subjectId).materialId === subject.materialId);
      if (importNames.length === 0) {
        checked(subject.materialId === target.materialId, "F002_RECORD_REFERENCE_INVALID", "跨材料调用缺少显式 import 前提");
        checked(declarations.some(p => p.subjectId === target.objectId && p.predicate === "bindingName" && p.value.value === calledName),
          "F002_RECORD_PREMISE_REQUIRED", "本地调用目标缺少同名绑定声明前提");
      } else {
        checked(importNames.length === 1, "F002_RECORD_PREMISE_REQUIRED", "导入目标前提必须唯一");
        const imported = importNames[0], importId = imported.subjectId;
        checked(declarations.some(p => p.subjectId === importId && p.predicate === "name" && p.value.value === calledName)
          && declarations.some(p => p.subjectId === target.objectId && p.predicate === "exportedName" && p.value.value === imported.value.value),
          "F002_RECORD_PREMISE_REQUIRED", "导入别名或目标导出名称前提缺失");
        const paths = declarations.filter(p => p.subjectId === importId && p.predicate === "path");
        checked(paths.length === 1, "F002_RECORD_PREMISE_REQUIRED", "调用缺少唯一显式模块路径");
        const specifier = paths[0].value.value;
        checked(/^\.\.?\//.test(specifier) && !/[\u0000-\u001f\u007f\\?#]/.test(specifier), "F002_RECORD_REFERENCE_INVALID", "模块引用越界或不支持");
        let sourcePath;
        try { sourcePath = new TextDecoder("utf-8", { fatal: true }).decode(decodePathBytes(sourceMaterial.pathBytes)); }
        catch { checked(false, "F002_RECORD_REFERENCE_INVALID", "模块来源路径不是可证明的 UTF8 路径"); }
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
        checked(base !== ".." && !base.startsWith("../"), "F002_RECORD_REFERENCE_INVALID", "模块引用不能越过组件根");
        const candidates = (path.posix.extname(base) ? [base] : [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`]).map(p => Buffer.from(p));
        const matched = [...materials.values()].filter(m => m.componentId === sourceMaterial.componentId && candidates.some(p => decodePathBytes(m.pathBytes).equals(p)));
        checked(matched.length === 1 && matched[0].materialId === targetMaterial.materialId, "F002_RECORD_REFERENCE_INVALID", "目标模块路径缺失或存在歧义");
      }
    }
    if (profile && ["DOCUMENT_LINK", "DOCUMENT_IMAGE"].includes(subject.kind) && payload.predicate === "refersTo") {
      checked(profile.extractionLimits?.documentSyntax === "static-document-v1" && payload.ruleRef.id === "f002-markdown" && payload.ruleRef.version === "2"
        && payload.basis === "DERIVED" && payload.premiseFactIds.length > 0,
        "F002_RECORD_PREMISE_REQUIRED", "文档绑定必须列出原始引用声明前提");
      const paths = payload.premiseFactIds.map(id => facts.get(id)).filter(premise => premise.subjectId === subject.objectId && premise.predicate === "path"
        && premise.basis === "DECLARED" && premise.value?.datatype === "string");
      checked(paths.length === 1,
        "F002_RECORD_PREMISE_REQUIRED", "文档绑定缺少其显式路径声明");
      const target = objects.get(payload.targetId), sourceMaterial = materials.get(subject.materialId), targetMaterial = materials.get(target.materialId);
      checked(sourceMaterial.componentId === targetMaterial.componentId, "F002_RECORD_REFERENCE_INVALID", "文档引用不能由同名路径跨组件替代");
      const declaredPath = paths[0].value.value; let pathname, fragment;
      try { const split = declaredPath.indexOf("#"); pathname = decodeURIComponent(split < 0 ? declaredPath : declaredPath.slice(0, split)); fragment = split < 0 ? null : decodeURIComponent(declaredPath.slice(split + 1)); }
      catch { checked(false, "F002_RECORD_REFERENCE_INVALID", "文档引用路径编码无效"); }
      checked(!pathname.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(pathname) && !/[\u0000-\u001f\u007f\\?]/.test(pathname), "F002_RECORD_REFERENCE_INVALID", "文档路径越界或不支持");
      const sourcePath = new TextDecoder("utf-8", { fatal: true }).decode(decodePathBytes(sourceMaterial.pathBytes));
      const resolved = pathname ? path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), pathname)) : sourcePath;
      checked(resolved !== ".." && !resolved.startsWith("../") && decodePathBytes(targetMaterial.pathBytes).equals(Buffer.from(resolved)),
        "F002_RECORD_REFERENCE_INVALID", "文档目标没有满足其精确原始路径前提");
      if (fragment === null) checked(target.objectId === targetMaterial.rootObjectId, "F002_RECORD_REFERENCE_INVALID", "无章节片段不能猜目标对象");
      else {
        checked(target.kind === "DOCUMENT_SECTION", "F002_RECORD_REFERENCE_INVALID", "章节引用目标不是章节对象");
        const slug = name => name.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").trim().replace(/[ \t]+/g, "-");
        const candidates = [...objects.values()].filter(object => object.materialId === targetMaterial.materialId && object.kind === "DOCUMENT_SECTION" && slug(object.name) === fragment);
        checked(candidates.length === 1 && candidates[0].objectId === target.objectId, "F002_RECORD_REFERENCE_INVALID", "章节前提缺失或存在歧义");
        checked(payload.premiseFactIds.some(id => { const premise = facts.get(id); return premise.subjectId === target.objectId && premise.predicate === "name"
          && premise.basis === "DECLARED" && premise.value?.datatype === "string" && premise.value.value === target.name; }), "F002_RECORD_PREMISE_REQUIRED", "章节绑定缺少其目标名称声明前提");
      }
    }
    if (payload.kind === "RELATION" && ["contains", "declares", "imports"].includes(payload.predicate)) {
      const parent = objects.get(payload.subjectId), child = objects.get(payload.targetId);
      checked(parent.materialId === child.materialId && child.parentId === parent.objectId,
        "F002_RECORD_REFERENCE_INVALID", "结构关系与同材料直接父引用不一致");
    }
  }
  if (profile) {
    for (const payload of facts.values()) {
      const predicate = predicateDefinitions.get(payload.predicate);
      const subject = objects.get(payload.subjectId);
      checked(!predicate.domain || predicate.domain.includes(subject.kind), "F002_RECORD_VOCABULARY_INVALID", "事实主体不属于谓词允许对象域");
      if (payload.kind === "RELATION") {
        const target = objects.get(payload.targetId);
        checked(predicate.range.includes(target.kind), "F002_RECORD_VOCABULARY_INVALID", "关系事实目标不属于谓词允许对象域");
      } else {
        checked(!predicate.valueDatatypes || predicate.valueDatatypes.includes(payload.value.datatype),
          "F002_RECORD_VOCABULARY_INVALID", "属性事实值类型不属于谓词允许值域");
        if (subject.kind === "CONFIG_KEY" && ["type", "literalValue"].includes(payload.predicate)) checked(payload.value.datatype === "string"
          && (payload.predicate !== "type" || payload.value.value === "string"), "F002_RECORD_VOCABULARY_INVALID", "配置声明不能冒充运行时类型或值");
        if (subject.kind === "DOCUMENT_PARAGRAPH" && payload.predicate === "literalValue") checked(payload.value.datatype === "string", "F002_RECORD_VOCABULARY_INVALID", "文档原文必须为声明字符串");
        if (subject.kind === "EXPRESS_ROUTER" && payload.predicate === "routerKind") checked(payload.value.datatype === "string"
          && ["application", "router"].includes(payload.value.value), "F002_RECORD_VOCABULARY_INVALID", "Express 构造声明类别不受支持");
      }
    }
  }
  const visiting = new Set();
  if (profile?.extractionLimits?.springMappings === "ast-literals-v1") verifySpringMappings({ objects, facts, evidence, materials, profile });
  if (profile?.extractionLimits?.testAssets === "framework-declarations-v1") verifyTestAssets({ objects, facts, evidence, materials, profile });
  if (profile?.extractionLimits?.testReports === "literal-reports-v1") verifyReports({ objects, facts, evidence, materials, gaps: byKind.get("GAP"), profile, bundleId });
  if (profile?.extractionLimits?.endpointContracts === "component-path-shape-v1") verifyEndpointContracts({ objects, facts, evidence, materials, gaps: byKind.get("GAP"), profile });
  if (profile?.extractionLimits?.javaBindings === "component-static-zero-v1") verifyJavaBindings({ objects, facts, evidence, materials, gaps: byKind.get("GAP"), profile });
  const visited = new Set();
  const visitPremises = (id) => {
    if (visited.has(id)) return;
    checked(!visiting.has(id), "F002_RECORD_PREMISE_CYCLE", "推导事实前提存在环");
    visiting.add(id);
    for (const premiseId of facts.get(id).premiseFactIds) visitPremises(premiseId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of facts.keys()) visitPremises(id);
  for (const [id, payload] of facts) exactIdentity(id, createFactId({ subjectId: payload.subjectId, predicate: payload.predicate,
    ...(payload.kind === "RELATION" ? { targetId: payload.targetId } : { typedValue: payload.value }), basis: payload.basis,
    evidenceIds: payload.evidenceIds, ruleRef: payload.ruleRef, premiseFactIds: payload.premiseFactIds }));
  for (const payload of byKind.get("GAP").values()) {
    if (payload.materialId) checked(materials.has(payload.materialId), "F002_RECORD_REFERENCE_INVALID", "缺口材料不存在");
    if (payload.objectId) checked(objects.has(payload.objectId), "F002_RECORD_REFERENCE_INVALID", "缺口对象不存在");
  }
}

export function assertScopeRecordBudget(profile, count) {
  if (profile?.extractionLimits?.scopeRecordBudget !== "atomic-material-v1") return;
  requireF002(Number.isSafeInteger(profile.extractionLimits.maxRecords) && count <= profile.extractionLimits.maxRecords,
    "F002_SCOPE_RECORD_BUDGET_TOO_SMALL", "完整材料目录及全部来源缺口超过固定配置的范围记录上限；请缩小范围或选择另一个已批准配置", { status: 422 });
}

export function normalizeCanonicalRecords(records, context = {}) {
  requireF002(Array.isArray(records) && records.length <= 500_000, "F002_RECORDS_INVALID", "规范记录列表无效", { status: 422 });
  assertScopeRecordBudget(context.profile, records.length);
  const normalized = records.map((record) => validateRecord(record, context)).sort((left, right) => utf8Compare(left.kind, right.kind) || utf8Compare(left.id, right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    requireF002(normalized[index - 1].kind !== normalized[index].kind || normalized[index - 1].id !== normalized[index].id,
      "F002_RECORD_DUPLICATE", "规范记录身份重复", { status: 422 });
  }
  validateClosure(normalized, context);
  return normalized;
}

export function verifyPublication({ workspaceId, bundleId, scopeId, profile, records }) {
  installedF002Rules.assertProfile(profile);
  const canonicalRecords = normalizeCanonicalRecords(records, { workspaceId, bundleId, profile });
  const recordDigest = canonicalDigest("FACT_SET_RECORDS", { records: canonicalRecords });
  const ruleConfig = {
    profileId: profile.id,
    schemaVersion: profile.schemaVersion,
    ruleVersions: profile.ruleVersions,
    canonicalizationVersion: profile.canonicalizationVersion,
    recordDigest,
  };
  return {
    records: canonicalRecords,
    recordDigest,
    graphVersionId: createGraphVersionId({ workspaceId, bundleId, scopeId, schemaVersion: profile.schemaVersion, ruleConfig,
      records: canonicalRecords }),
  };
}
