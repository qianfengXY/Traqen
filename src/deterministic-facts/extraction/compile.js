import { createHash } from "node:crypto";
import path from "node:path";

import { parse as parseJavaScript } from "acorn";
import { ancestor, simple } from "acorn-walk";
import { parse as parseJava, registerDynamicLanguage } from "@ast-grep/napi";
import javaLanguage from "@ast-grep/lang-java";

import {
  createEvidenceId,
  createFactId,
  createGapId,
  createMaterialId,
  createObjectId,
} from "../identity.js";
import { decodePathBytes } from "../../source-truth/identity.js";
import { installedF002Rules } from "../rules.js";
import { extractJavaScriptStructure } from "./javascript-structure.js";
import { extractJavaScriptBindings, resolveJavaScriptModules } from "./javascript-bindings.js";
import { extractExpressStatic } from "./express-static.js";
import { extractJavaDeclarations } from "./java-declarations.js";
import { resolveJavaBindings } from "./java-bindings.js";
import { extractJsonStructure } from "./json-structure.js";
import { extractPropertyStructure } from "./properties-structure.js";
import { isDotenvPath } from "./dotenv-syntax.js";
import { extractDocumentStructure, resolveDocumentLinks } from "./document-structure.js";
import { extractJavaScriptTests, resolveTestReferences } from "./test-assets.js";
import { extractJunitReports } from "./test-reports.js";
import { resolveEndpointContracts } from "./endpoint-contracts.js";

registerDynamicLanguage({ java: javaLanguage });

const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
import { containsPrivateKey, isSensitiveKey } from "../sensitive-content.js";
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function utf8Text(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  return Buffer.from(text, "utf8").equals(Buffer.from(bytes)) ? text : null;
}

function textAnchor(text, start, end) {
  const position = (index) => {
    const before = text.slice(0, index);
    let line = 1, lineStart = 0;
    for (let offset = 0; offset < before.length; offset += 1) {
      if (before[offset] === "\r") {
        if (before[offset + 1] === "\n") offset += 1;
        line += 1; lineStart = offset + 1;
      } else if (before[offset] === "\n") {
        line += 1; lineStart = offset + 1;
      }
    }
    return { line, column: [...text.slice(lineStart, index)].length + 1 };
  };
  const first = position(start), last = position(end);
  return {
    kind: "TEXT",
    byteStart: Buffer.byteLength(text.slice(0, start), "utf8"),
    byteEnd: Buffer.byteLength(text.slice(0, end), "utf8"),
    lineStart: first.line,
    columnStart: first.column,
    lineEnd: last.line,
    columnEnd: last.column,
  };
}

function mediaKind(displayPath, mediaType, limits) {
  const ext = path.posix.extname(displayPath).toLowerCase();
  if (limits?.dotenvSyntax === "node-static-v1" && isDotenvPath(displayPath)) return "PROPERTIES";
  if (ext === ".svg" || mediaType === "image/svg+xml") return "UNSUPPORTED";
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "JAVASCRIPT";
  if (ext === ".java") return "JAVA";
  if (ext === ".md" || mediaType === "text/markdown") return "MARKDOWN";
  if (ext === ".json" || mediaType === "application/json") return "JSON";
  if ([".yaml", ".yml"].includes(ext) || mediaType === "application/yaml") return "YAML";
  if ([".properties", ".env"].includes(ext)) return "PROPERTIES";
  if (ext === ".xml" && (limits?.testReports === "literal-reports-v1" || /(?:junit|test|report)/i.test(displayPath))) return "JUNIT_XML";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext) || mediaType.startsWith("image/")) return "IMAGE";
  if (limits?.documentSyntax === "static-document-v1" && ext === ".txt") return "MARKDOWN";
  return "UNSUPPORTED";
}

function lineEntries(text) {
  const result = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n" && text[index] !== "\r") continue;
    const end = index;
    result.push({ start, end, text: text.slice(start, end) });
    if (text[index] === "\r" && text[index + 1] === "\n") index += 1;
    start = index + 1;
  }
  return result;
}

function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

function member(node) {
  if (node?.type !== "MemberExpression" || node.computed || node.property?.type !== "Identifier") return null;
  return { object: node.object, property: node.property.name };
}

function annotationNames(text) { return [...text.matchAll(/@([A-Za-z_$][\w$]*)/g)].map((match) => match[1]); }
function mappingValue(text, name) {
  const match = new RegExp(`@${name}(?:\\s*\\(([\\s\\S]*?)\\))?`).exec(text);
  if (!match) return null;
  if (match[1] === undefined) return { kind: "DEFAULT", value: "" };
  const argument = match[1].trim();
  const literal = /^(?:(?:value|path)\s*=\s*)?["']([^"']*)["'](?:\s*,\s*(?:(?:value|path)\s*=\s*)?["'][^"']*["'])*$/.exec(argument);
  return literal ? { kind: "LITERAL", value: literal[1] } : { kind: "UNRESOLVED", value: null };
}

function patternBindings(node, bindings) {
  if (node?.type === "Identifier") bindings.add(node.name);
  else if (node?.type === "AssignmentPattern") patternBindings(node.left, bindings);
  else if (node?.type === "RestElement") patternBindings(node.argument, bindings);
  else if (node?.type === "ArrayPattern") node.elements.forEach((item) => patternBindings(item, bindings));
  else if (node?.type === "ObjectPattern") node.properties.forEach((item) => patternBindings(item.value ?? item.argument, bindings));
}

function scopeDeclaresName(scope, name) {
  const bindings = new Set();
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(scope?.type)) scope.params.forEach((param) => patternBindings(param, bindings));
  const body = scope?.type === "Program" || scope?.type === "BlockStatement" ? scope.body : [];
  for (const statement of body ?? []) {
    const declared = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declared?.type === "FunctionDeclaration" || declared?.type === "ClassDeclaration") patternBindings(declared.id, bindings);
    if (declared?.type === "VariableDeclaration") declared.declarations.forEach((declaration) => patternBindings(declaration.id, bindings));
    if (declared?.type === "ImportDeclaration") declared.specifiers.forEach((specifier) => patternBindings(specifier.local, bindings));
  }
  return bindings.has(name);
}

function shadowedInNestedScope(ancestors, name) {
  return ancestors.some((ancestor) => ancestor.type !== "Program" && scopeDeclaresName(ancestor, name));
}

function imageAnchor(bytes, contentDigest) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.length >= 24) {
    return { kind: "IMAGE", digest: contentDigest, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
    return { kind: "IMAGE", digest: contentDigest, width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  return { kind: "BINARY", digest: contentDigest };
}

export function compileDeterministicFacts({ workspaceId, bundleId, profile, materials, ruleRegistry = installedF002Rules }) {
  if (typeof workspaceId !== "string" || !/^[a-f0-9]{64}$/.test(bundleId) || !/^[a-f0-9]{64}$/.test(profile?.id ?? "") || !Array.isArray(materials)) {
    throw new TypeError("compileDeterministicFacts requires Workspace, Bundle, profile, and materials");
  }
  if (!ruleRegistry || typeof ruleRegistry.assertProfile !== "function" || typeof ruleRegistry.materialRule !== "function") {
    throw new TypeError("compileDeterministicFacts requires a server rule registry");
  }
  ruleRegistry.assertProfile(profile);
  const objects = [], evidence = [], facts = [], gaps = [], objectById = new Map(), materialByLocation = new Map(), linkCandidates = [], jsExports = [], jsImportedCalls = [];
  const structuredObjects = new Map(), evidenceIdsSeen = new Set(), factIdsSeen = new Set(), gapIdsSeen = new Set();
  const documentLinks = [], documentSections = [], javascriptModules = [], testReferences = [];
  const addObject = (material, kind, name, anchor) => {
    const objectId = createObjectId({ materialId: material.materialId, objectKind: kind, anchor });
    if (!objectById.has(objectId)) {
      const object = { objectId, materialId: material.materialId, kind, name, anchor,
        ...(material.ruleRef?.version === "2" && material.root ? { parentId: material.root.objectId } : {}) };
      objects.push(object); objectById.set(objectId, object);
      if (material.ruleRef?.version === "2") {
        if (!structuredObjects.has(material.materialId)) structuredObjects.set(material.materialId, []);
        structuredObjects.get(material.materialId).push(object);
      }
    }
    return objectById.get(objectId);
  };
  const addEvidence = (material, anchor, evidenceKind) => {
    const evidenceId = createEvidenceId({ materialId: material.materialId, contentDigest: material.contentDigest, anchor, evidenceKind });
    if (!evidenceIdsSeen.has(evidenceId)) { evidenceIdsSeen.add(evidenceId); evidence.push({ evidenceId, materialId: material.materialId, contentDigest: material.contentDigest, anchor, evidenceKind }); }
    return evidenceId;
  };
  const addFact = ({ subject, predicate, target = null, value = null, basis = "DECLARED", material, anchor, evidenceKind = "SOURCE_TEXT", premiseFactIds = [] }) => {
    const evidenceIds = [addEvidence(material, anchor, evidenceKind)];
    const ruleRef = material.ruleRef;
    const factId = createFactId({ subjectId: subject.objectId, predicate, ...(target ? { targetId: target.objectId } : { typedValue: value }), basis, evidenceIds, ruleRef, premiseFactIds });
    if (!factIdsSeen.has(factId)) {
      factIdsSeen.add(factId);
      facts.push({ factId, kind: target ? "RELATION" : "PROPERTY", subjectId: subject.objectId, predicate,
        ...(target ? { targetId: target.objectId } : { value }), basis, evidenceIds, ruleRef, premiseFactIds });
    }
    return factId;
  };
  const addGap = (material, capability, code, anchor = null, extraReason = {}) => {
    const reason = { category: code, ...extraReason };
    const gapId = createGapId({ origin: "F002", materialId: material.materialId, capability, code, location: anchor, reason });
    if (!gapIdsSeen.has(gapId)) { gapIdsSeen.add(gapId); gaps.push({ gapId, origin: "F002", materialId: material.materialId, capability, code, anchor, reason }); }
  };
  const normalized = materials.map((input) => {
    const bytes = Buffer.from(input.bytes ?? []);
    const rawPath = decodePathBytes(input.pathBytes);
    const displayPath = utf8Text(rawPath);
    const contentAvailable = input.contentAvailable !== false;
    const contentDigest = contentAvailable ? digest(bytes) : input.contentDigest ?? null;
    const materialId = createMaterialId({ workspaceId, bundleId, componentId: input.componentId, pathBytes: input.pathBytes });
    const kind = displayPath ? mediaKind(displayPath, input.mediaType ?? "application/octet-stream", profile.extractionLimits) : "UNSUPPORTED";
    return { ...input, bytes, rawPath, displayPath, suppliedContentDigest: input.contentDigest ?? null, contentAvailable, contentDigest, materialId,
      kind, ruleRef: ruleRegistry.materialRule(profile, kind) };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.componentId, "ascii"), Buffer.from(right.componentId, "ascii")) || Buffer.compare(left.rawPath, right.rawPath));

  for (const material of normalized) {
    const rootAnchor = { kind: "BINARY", digest: material.contentDigest };
    material.root = addObject(material, "MATERIAL", material.displayPath ?? "[non-utf8-path]", rootAnchor);
    materialByLocation.set(`${material.componentId}\u0000${material.displayPath ?? ""}`, material);
    if (!material.contentAvailable) {
      addGap(material, "source", material.unavailableCode ?? "SOURCE_CONTENT_UNAVAILABLE");
      continue;
    }
    if (material.contentDigest !== inputDigest(material)) {
      addGap(material, "inventory", "CONTENT_DIGEST_MISMATCH");
      continue;
    }
    const text = utf8Text(material.bytes);
    if (containsPrivateKey(text)) {
      addGap(material, material.kind.toLowerCase(), "PRIVATE_KEY_MATERIAL_RESTRICTED");
      continue;
    }
    if (["JAVASCRIPT", "JAVA", "MARKDOWN", "JSON", "YAML", "PROPERTIES", "JUNIT_XML"].includes(material.kind) && text === null) {
      addGap(material, material.kind.toLowerCase(), "TEXT_ENCODING_UNSUPPORTED");
      continue;
    }
    if (["JAVASCRIPT", "JAVA", "MARKDOWN", "JSON", "YAML", "PROPERTIES", "JUNIT_XML", "IMAGE"].includes(material.kind) && material.ruleRef === null) {
      addGap(material, material.kind.toLowerCase(), "RULE_CAPABILITY_UNAVAILABLE");
      continue;
    }
    if (material.kind === "JAVASCRIPT") extractJavaScript({ material, text, addObject, addFact, addGap, jsExports, jsImportedCalls, limits: profile.extractionLimits ?? {}, javascriptModules, testReferences });
    else if (material.kind === "JAVA") extractJava({ material, text, addObject, addFact, addGap, limits: profile.extractionLimits ?? {}, testReferences });
    else if (material.kind === "MARKDOWN") {
      if (material.ruleRef.version === "2" && profile.extractionLimits?.documentSyntax === "static-document-v1") extractDocumentStructure({ material, text,
        limits: profile.extractionLimits, textAnchor, addObject, addFact, addGap, documentLinks, documentSections });
      else extractMarkdown({ material, text, addObject, addFact, addGap, linkCandidates });
    }
    else if (material.kind === "JSON") {
      if (material.ruleRef.version === "2") extractJsonStructure({ material: { ...material, reportBundleId: bundleId }, text, limits: profile.extractionLimits, textAnchor, addObject, addFact, addGap });
      else extractJson({ material, text, addObject, addFact, addGap });
    }
    else if (material.kind === "YAML") extractYaml({ material, text, addObject, addFact, addGap });
    else if (material.kind === "PROPERTIES") {
      if (material.ruleRef.version === "2") extractPropertyStructure({ material, text, limits: profile.extractionLimits, textAnchor, addObject, addFact, addGap });
      else extractProperties({ material, text, addObject, addFact });
    }
    else if (material.kind === "JUNIT_XML") {
      if (material.ruleRef.version === "2" && profile.extractionLimits?.testReports === "literal-reports-v1") extractJunitReports({ material: { ...material, reportBundleId: bundleId }, text, limits: profile.extractionLimits, textAnchor, addObject, addFact, addGap });
      else extractJunitXml({ material, text, addObject, addFact, addGap });
    }
    else if (material.kind === "IMAGE") addEvidence(material, imageAnchor(material.bytes, material.contentDigest), "IMAGE_METADATA");
    else addGap(material, "format", "FORMAT_UNSUPPORTED");
    if (material.ruleRef?.version === "2") for (const child of structuredObjects.get(material.materialId) ?? []) {
      if (child.parentId) addFact({ subject: objectById.get(child.parentId), predicate: "contains", target: child, material, anchor: child.anchor });
    }
  }
  for (const link of linkCandidates) {
    if (link.target.startsWith("/") || /^[a-z]+:/i.test(link.target)) { addGap(link.material, "markdown", "DOCUMENT_LINK_OUT_OF_SCOPE", link.anchor); continue; }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(link.material.displayPath), link.target));
    if (resolved === ".." || resolved.startsWith("../")) { addGap(link.material, "markdown", "DOCUMENT_LINK_OUT_OF_SCOPE", link.anchor); continue; }
    const target = materialByLocation.get(`${link.material.componentId}\u0000${resolved}`);
    if (!target) { addGap(link.material, "markdown", "DOCUMENT_LINK_UNRESOLVED", link.anchor); continue; }
    addFact({ subject: link.material.root, predicate: "refersTo", target: target.root, material: link.material, anchor: link.anchor });
  }
  resolveDocumentLinks({ documentLinks, documentSections, materialByLocation, addFact, addGap });
  resolveJavaScriptModules({ modules: javascriptModules, materialByLocation, addFact, addGap });
  const exportIndex = new Map(jsExports.map((item) => [`${item.material.componentId}\u0000${item.material.displayPath}\u0000${item.exportedName}`, item.object]));
  for (const call of jsImportedCalls) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(call.material.displayPath), call.specifier));
    const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`];
    const target = candidates.map((candidate) => exportIndex.get(`${call.material.componentId}\u0000${candidate}\u0000${call.importedName}`)).find(Boolean);
    if (target) addFact({ subject: call.caller, predicate: "staticCalls", target, material: call.material, anchor: call.anchor, basis: "DERIVED" });
    else addGap(call.material, "javascript", "JAVASCRIPT_IMPORT_UNRESOLVED", call.anchor);
  }
  const order = (field) => (left, right) => byteCompare(left[field], right[field]);
  resolveJavaBindings({ objects, facts, materialById: new Map(normalized.map(m => [m.materialId,m])), limits: profile.extractionLimits, addFact, addGap });
  resolveTestReferences({ references: testReferences, facts, objects, evidence, addFact });
  resolveEndpointContracts({ objects, facts, materialById: new Map(normalized.map(m => [m.materialId, m])), limits: profile.extractionLimits, addFact, addGap });
  return { materials: normalized.map(({ bytes, rawPath, root, ...material }) => ({ ...material, rootObjectId: root.objectId })),
    objects: objects.sort(order("objectId")), evidence: evidence.sort(order("evidenceId")), facts: facts.sort(order("factId")), gaps: gaps.sort(order("gapId")) };
}

function inputDigest(material) { return material.suppliedContentDigest ?? digest(material.bytes); }

function extractJavaScript({ material, text, addObject, addFact, addGap, jsExports, jsImportedCalls, limits, javascriptModules, testReferences }) {
  let ast;
  try { ast = parseJavaScript(text, { ecmaVersion: "latest", sourceType: "module", locations: false }); }
  catch {
    try { ast = parseJavaScript(text, { ecmaVersion: "latest", sourceType: "script", locations: false }); }
    catch { addGap(material, "javascript", "JAVASCRIPT_PARSE_FAILED"); return; }
  }
  const functionByNode = new Map(), globalByName = new Map(), routerNames = new Set(), testBindings = new Set(), importsByLocalName = new Map(), expressBindings = new Set();
  const addFunction = (name, node) => {
    const object = addObject(material, "FUNCTION", name, textAnchor(text, node.start, node.end));
    addFact({ subject: object, predicate: "name", value: { datatype: "string", value: name }, material, anchor: object.anchor });
    functionByNode.set(node, object);
    if (node.type === "VariableDeclarator" && node.init) functionByNode.set(node.init, object);
    return object;
  };
  for (const exported of ast.body) {
    const statement = exported.type === "ExportNamedDeclaration" ? exported.declaration : exported;
    if (!statement) continue;
    if (statement.type === "FunctionDeclaration" && statement.id?.name) globalByName.set(statement.id.name, addFunction(statement.id.name, statement));
    if (statement.type === "VariableDeclaration") for (const declaration of statement.declarations) {
      if (declaration.id?.type === "Identifier" && ["ArrowFunctionExpression", "FunctionExpression"].includes(declaration.init?.type)) globalByName.set(declaration.id.name, addFunction(declaration.id.name, declaration));
      const initMember = member(declaration.init?.callee);
      if (declaration.id?.type === "Identifier" && initMember?.object.type === "Identifier" && initMember.property === "Router" && expressBindings.has(initMember.object.name)) routerNames.add(declaration.id.name);
    }
    if (statement.type === "ImportDeclaration" && literalString(statement.source) === "express") {
      for (const specifier of statement.specifiers) {
        if (["ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(specifier.type) && specifier.local?.name) expressBindings.add(specifier.local.name);
      }
    }
    if (statement.type === "ImportDeclaration" && ["node:test", "vitest", "@jest/globals"].includes(literalString(statement.source))) {
      for (const specifier of statement.specifiers) {
        const imported = specifier.imported?.name ?? (specifier.type === "ImportDefaultSpecifier" ? "test" : null);
        if (["test", "it"].includes(imported) && specifier.local?.name) testBindings.add(specifier.local.name);
      }
    }
    if (statement.type === "ImportDeclaration" && literalString(statement.source)?.startsWith(".")) {
      for (const specifier of statement.specifiers) {
        const importedName = specifier.type === "ImportSpecifier" ? (specifier.imported.name ?? literalString(specifier.imported))
          : specifier.type === "ImportDefaultSpecifier" ? "default" : null;
        if (importedName && specifier.local?.name) importsByLocalName.set(specifier.local.name, { specifier: literalString(statement.source), importedName });
      }
    }
  }
  for (const statement of ast.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaredName = statement.declaration?.id?.name;
    if (declaredName && globalByName.has(declaredName)) jsExports.push({ material, exportedName: declaredName, object: globalByName.get(declaredName) });
    for (const specifier of statement.specifiers) {
      const localName = specifier.local?.name ?? literalString(specifier.local);
      const exportedName = specifier.exported?.name ?? literalString(specifier.exported);
      if (localName && exportedName && globalByName.has(localName)) jsExports.push({ material, exportedName, object: globalByName.get(localName) });
    }
  }
  // Router declarations depend on imports, which are collected above.
  for (const statement of ast.body) {
    const declared = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declared?.type !== "VariableDeclaration") continue;
    for (const declaration of declared.declarations) {
      const initMember = member(declaration.init?.callee);
      if (declaration.id?.type === "Identifier" && initMember?.object.type === "Identifier" && initMember.property === "Router" && expressBindings.has(initMember.object.name)) routerNames.add(declaration.id.name);
    }
  }
  if (material.ruleRef.version === "2") extractJavaScriptStructure({ ast, material, text, textAnchor, addObject, addFact, functionByNode });
  const lexicalBindings = material.ruleRef.version === "2" && limits.javascriptBindings === "lexical-bindings-v1";
  const bindings = lexicalBindings ? extractJavaScriptBindings({ ast, material, text, limits, textAnchor, addObject, addFact, addGap, functionByNode, modules: javascriptModules }) : null;
  const staticExpress = material.ruleRef.version === "2" && limits.expressStatic === "top-level-literals-v1";
  if (staticExpress) extractExpressStatic({ ast, material, text, limits, bindings, textAnchor, addObject, addFact, addGap });
  const testAssets = material.ruleRef.version === "2" && limits.testAssets === "framework-declarations-v1";
  if (testAssets) extractJavaScriptTests({ material, text, limits, bindings, functionByNode, textAnchor, addObject, addFact, addGap, references: testReferences });
  ancestor(ast, {
    CallExpression(node, _state, ancestors) {
      const caller = [...ancestors].reverse().map((candidate) => functionByNode.get(candidate)).find(Boolean);
      if (!lexicalBindings && caller && node.callee.type === "Identifier") {
        const nested = ancestors.filter((candidate) => candidate.type !== "Program");
        const isShadowed = shadowedInNestedScope(nested, node.callee.name);
        const target = globalByName.get(node.callee.name);
        const anchor = textAnchor(text, node.start, node.end);
        if (target && !isShadowed) addFact({ subject: caller, predicate: "staticCalls", target, material, anchor, basis: "DERIVED" });
        else if (!isShadowed && importsByLocalName.has(node.callee.name)) jsImportedCalls.push({ material, caller, anchor, ...importsByLocalName.get(node.callee.name) });
      }
      const called = member(node.callee);
      if (!testAssets && node.callee.type === "Identifier" && testBindings.has(node.callee.name) && typeof literalString(node.arguments[0]) === "string") {
        const enclosing = [...ancestors].reverse().find((candidate) => functionByNode.has(candidate));
        const params = enclosing?.params?.flatMap((item) => item.type === "Identifier" ? [item.name] : []) ?? [];
        if (!params.includes(node.callee.name)) {
          const name = literalString(node.arguments[0]);
          const testCase = addObject(material, "TEST_CASE", name, textAnchor(text, node.start, node.end));
          if (material.ruleRef.version === "2" && caller) testCase.parentId = caller.objectId;
          addFact({ subject: testCase, predicate: "testName", value: { datatype: "string", value: name }, material, anchor: testCase.anchor });
        }
      }
      if (staticExpress || !called || called.object?.type !== "Identifier" || !routerNames.has(called.object.name)
        || shadowedInNestedScope(ancestors.filter((candidate) => candidate.type !== "Program"), called.object.name) || !httpMethods.has(called.property)) return;
      const endpointPath = literalString(node.arguments[0]);
      const handler = node.arguments.at(-1);
      if (!endpointPath?.startsWith("/")) { addGap(material, "express", "EXPRESS_ROUTE_DYNAMIC", textAnchor(text, node.start, node.end)); return; }
      const route = addObject(material, "ROUTE", `${called.property.toUpperCase()} ${endpointPath}`, textAnchor(text, node.start, node.end));
      if (material.ruleRef.version === "2" && caller) route.parentId = caller.objectId;
      addFact({ subject: route, predicate: "httpMethod", value: { datatype: "string", value: called.property.toUpperCase() }, material, anchor: route.anchor });
      addFact({ subject: route, predicate: "path", value: { datatype: "string", value: endpointPath }, material, anchor: route.anchor });
      if (handler?.type === "Identifier" && globalByName.has(handler.name)) addFact({ subject: globalByName.get(handler.name), predicate: "handlesRoute", target: route, material, anchor: route.anchor, basis: "DERIVED" });
      else addGap(material, "express", "EXPRESS_HANDLER_UNRESOLVED", route.anchor);
    },
  });
}

function extractMarkdown({ material, text, addObject, addFact, linkCandidates }) {
  let fenced = false;
  const structured = material.ruleRef.version === "2", sections = [];
  let fence = null;
  for (const line of lineEntries(text)) {
    if (structured) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
      if (marker && !fence && !(marker[1][0] === "`" && marker[2].includes("`"))) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
      if (fence) { if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null; continue; }
    } else if (/^\s*```/.test(line.text)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line.text);
    if (heading) {
      const start = line.start + heading.index + heading[1].length + 1;
      const section = addObject(material, "DOCUMENT_SECTION", heading[2], textAnchor(text, start, start + heading[2].length));
      if (structured) {
        while (sections.length && sections.at(-1).level >= heading[1].length) sections.pop();
        section.parentId = sections.at(-1)?.object.objectId ?? material.root.objectId;
        sections.push({ level: heading[1].length, object: section });
      }
      addFact({ subject: section, predicate: "name", value: { datatype: "string", value: heading[2] }, material, anchor: section.anchor });
    }
    for (const match of line.text.matchAll(/\[[^\]]+\]\(([^)#?]+)(?:#[^)]+)?\)/g)) {
      linkCandidates.push({ material, target: match[1].trim(), anchor: textAnchor(text, line.start + match.index, line.start + match.index + match[0].length) });
    }
  }
}

function extractProperties({ material, text, addObject, addFact }) {
  for (const line of lineEntries(text)) {
    const match = /^\s*([^#!\s][^:=\s]*)\s*[:=]/.exec(line.text);
    if (!match) continue;
    const key = match[1];
    const config = addObject(material, "CONFIG_KEY", key, textAnchor(text, line.start + match.index, line.start + match.index + key.length));
    addFact({ subject: config, predicate: "name", value: { datatype: "string", value: isSensitiveKey(key) ? "[REDACTED_KEY]" : key }, material, anchor: config.anchor });
  }
}

function extractYaml({ material, text, addObject, addFact, addGap }) {
  const parents = [];
  for (const line of lineEntries(text)) {
    if (/^\s*(?:---|\.\.\.|[?&*!]|[^#]*\s[&*!][\w-]+)/.test(line.text) || /[|>]/.test(line.text)) {
      addGap(material, "yaml", "YAML_COMPLEX_STRUCTURE_UNSUPPORTED", textAnchor(text, line.start, line.end));
      continue;
    }
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line.text);
    if (!match || /^\s*(?:#|$)/.test(line.text)) continue;
    const indent = Buffer.byteLength(match[1], "utf8");
    while (parents.length && parents.at(-1).indent >= indent) parents.pop();
    const key = [...parents.map((item) => item.key), match[2]].join(".");
    const keyStart = line.start + match[1].length;
    const config = addObject(material, "CONFIG_KEY", key, textAnchor(text, keyStart, keyStart + match[2].length));
    addFact({ subject: config, predicate: "name", value: { datatype: "string", value: isSensitiveKey(key) ? "[REDACTED_KEY]" : key }, material, anchor: config.anchor });
    if (match[3] === "") parents.push({ indent, key: match[2] });
  }
}

function extractJson({ material, text, addObject, addFact, addGap }) {
  let value;
  try { value = JSON.parse(text); }
  catch { addGap(material, "json", "JSON_PARSE_FAILED"); return; }
  if (Array.isArray(value?.tests)) {
    for (const report of value.tests) {
      if (typeof report?.name !== "string" || typeof report?.status !== "string") continue;
      const at = text.indexOf(JSON.stringify(report.name));
      const result = addObject(material, "TEST_RESULT", report.name, textAnchor(text, Math.max(0, at), Math.max(0, at) + JSON.stringify(report.name).length));
      addFact({ subject: result, predicate: "testName", value: { datatype: "string", value: report.name }, material, anchor: result.anchor });
      addFact({ subject: result, predicate: "reportsResult", value: { datatype: "string", value: report.status }, material, anchor: result.anchor });
    }
  }
  if (typeof value?.openapi !== "string" || value?.paths === null || typeof value?.paths !== "object") return;
  for (const [endpointPath, operations] of Object.entries(value.paths)) for (const [method, operation] of Object.entries(operations ?? {})) {
    if (!httpMethods.has(method.toLowerCase()) || operation === null || typeof operation !== "object") continue;
    const pathAt = text.indexOf(JSON.stringify(endpointPath));
    const methodAt = text.indexOf(JSON.stringify(method), Math.max(0, pathAt + JSON.stringify(endpointPath).length));
    const route = addObject(material, "OPENAPI_OPERATION", `${method.toUpperCase()} ${endpointPath}`,
      textAnchor(text, Math.max(0, methodAt), Math.max(0, methodAt) + JSON.stringify(method).length));
    addFact({ subject: route, predicate: "httpMethod", value: { datatype: "string", value: method.toUpperCase() }, material, anchor: route.anchor });
    addFact({ subject: route, predicate: "path", value: { datatype: "string", value: endpointPath }, material, anchor: route.anchor });
    for (const status of Object.keys(operation.responses ?? {}).sort(byteCompare)) addFact({ subject: route, predicate: "declaresResponse", value: { datatype: "string", value: status }, material, anchor: route.anchor });
  }
}

function extractJunitXml({ material, text, addObject, addFact, addGap }) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) { addGap(material, "junit", "JUNIT_XML_UNSAFE"); return; }
  for (const match of text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attribute = (name) => new RegExp(`\\b${name}=["']([^"']*)["']`).exec(match[1])?.[1] ?? null;
    const name = attribute("name");
    if (!name) continue;
    const result = addObject(material, "TEST_RESULT", name, textAnchor(text, match.index, match.index + match[0].length));
    const status = /<(?:failure|error|skipped)\b/i.test(match[0]) ? (/<(?:failure|error)\b/i.test(match[0]) ? "FAIL" : "SKIP") : "PASS";
    addFact({ subject: result, predicate: "testName", value: { datatype: "string", value: name }, material, anchor: result.anchor });
    addFact({ subject: result, predicate: "reportsResult", value: { datatype: "string", value: status }, material, anchor: result.anchor });
  }
}

function extractJava({ material, text, addObject, addFact, addGap, limits, testReferences }) {
  let root;
  try { root = parseJava("java", text).root(); }
  catch { addGap(material, "java", "JAVA_PARSE_FAILED"); return; }
  if (material.ruleRef.version === "2" && limits.javaSyntax === "ast-declarations-v1") return extractJavaDeclarations({ root, material, text, limits, textAnchor, addObject, addFact, addGap, testReferences });
  const classes = new Map(), structuredNodes = new Map();
  const springMvc = /import\s+org\.springframework\.web\.bind\.annotation(?:\.\*|\.[A-Za-z_$][\w$]*)\s*;/.test(text);
  for (const node of ["class_declaration", "interface_declaration", "record_declaration", "enum_declaration"].flatMap((kind) => root.findAll({ rule: { kind } }))) {
    const name = node.field("name")?.text();
    if (!name) continue;
    const range = node.range();
    const object = addObject(material, "JAVA_TYPE", name, textAnchor(text, range.start.index, range.end.index));
    addFact({ subject: object, predicate: "name", value: { datatype: "string", value: name }, material, anchor: object.anchor });
    classes.set(node.id(), { node, object });
    structuredNodes.set(node.id(), { node, object });
  }
  const methodNodes = root.findAll({ rule: { kind: "method_declaration" } });
  if (material.ruleRef.version === "2") methodNodes.push(...root.findAll({ rule: { kind: "constructor_declaration" } }));
  for (const node of methodNodes) {
    const name = node.field("name")?.text();
    if (!name) continue;
    const owner = node.ancestors().map((candidate) => classes.get(candidate.id())).find(Boolean);
    const range = node.range();
    const method = addObject(material, node.kind() === "constructor_declaration" ? "JAVA_CONSTRUCTOR" : "JAVA_METHOD", `${owner?.object.name ?? "Java"}#${name}`, textAnchor(text, range.start.index, range.end.index));
    structuredNodes.set(node.id(), { node, object: method });
    addFact({ subject: method, predicate: "name", value: { datatype: "string", value: name }, material, anchor: method.anchor });
    const modifiers = node.children().find((child) => child.kind() === "modifiers")?.text() ?? "";
    const classModifiers = owner?.node.children().find((child) => child.kind() === "modifiers")?.text() ?? "";
    const base = mappingValue(classModifiers, "RequestMapping");
    for (const [annotation, httpMethod] of [["GetMapping", "GET"], ["PostMapping", "POST"], ["PutMapping", "PUT"], ["PatchMapping", "PATCH"], ["DeleteMapping", "DELETE"]]) {
      if (!annotationNames(modifiers).includes(annotation)) continue;
      const child = mappingValue(modifiers, annotation);
      if (!springMvc || !child || base?.kind === "UNRESOLVED" || child.kind === "UNRESOLVED") {
        addGap(material, "java", "SPRING_MAPPING_UNRESOLVED", method.anchor);
        continue;
      }
      const endpointPath = `/${base?.value ?? ""}/${child.value}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
      const route = addObject(material, "ROUTE", `${httpMethod} ${endpointPath}`, method.anchor);
      if (material.ruleRef.version === "2") route.parentId = method.objectId;
      addFact({ subject: method, predicate: "handlesRoute", target: route, material, anchor: method.anchor, basis: "DERIVED" });
    }
    for (const invocation of node.findAll({ rule: { kind: "method_invocation" } })) addGap(material, "java", "JAVA_INVOCATION_UNRESOLVED", textAnchor(text, invocation.range().start.index, invocation.range().end.index));
  }
  if (material.ruleRef.version === "2") {
    for (const { node, object } of structuredNodes.values()) {
      const parent = node.ancestors().map(candidate => structuredNodes.get(candidate.id())?.object).find(Boolean) ?? material.root;
      object.parentId = parent.objectId;
      addFact({ subject: parent, predicate: "declares", target: object, material, anchor: object.anchor });
    }
    for (const node of root.findAll({ rule: { kind: "import_declaration" } })) {
      const range = node.range(), name = node.text().replace(/^import\s+/, "").replace(/;\s*$/, "").trim();
      const declaration = addObject(material, "IMPORT", name, textAnchor(text, range.start.index, range.end.index));
      addFact({ subject: declaration, predicate: "name", value: { datatype: "string", value: name }, material, anchor: declaration.anchor });
      addFact({ subject: material.root, predicate: "imports", target: declaration, material, anchor: declaration.anchor });
    }
  }
}
