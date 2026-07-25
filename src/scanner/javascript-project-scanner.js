import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "acorn";
import { ancestor, simple } from "acorn-walk";
import { parse as parseSyntaxTree, registerDynamicLanguage } from "@ast-grep/napi";
import javaLanguage from "@ast-grep/lang-java";

import { canonicalJson, createFactBundle, deepFreeze, stableFactNodeId } from "../domain/index.js";

registerDynamicLanguage({ java: javaLanguage });

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "target", "out", ".gradle", "coverage", ".next", ".cache", "vendor"]);
const supportedExtensions = new Set([".js", ".mjs", ".cjs", ".java", ".json", ".sql", ".yaml", ".yml", ".properties", ".xml", ".gradle", ".kts"]);
const unsupportedSourceExtensions = new Set([
  ".ts", ".tsx", ".jsx", ".kt", ".go", ".py", ".rb", ".php", ".cs", ".fs",
]);
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function lineCount(content) {
  return Math.max(1, content.split("\n").length);
}

function source(relativePath, contentHash, startLine = 1, endLine = startLine) {
  return { artifact: relativePath, startLine, endLine, contentHash };
}

function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? null;
  }
  return null;
}

function memberName(node) {
  if (node?.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  return literalString(node.property);
}

function calleeName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") {
    const object = calleeName(node.object);
    const property = memberName(node);
    return object && property ? `${object}.${property}` : property;
  }
  return null;
}

function boundedSourceText(content, node, maximum = 512) {
  if (!node || !Number.isInteger(node.start) || !Number.isInteger(node.end)) return null;
  const text = content.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function conditionClassifications(text) {
  const result = [];
  if (/\b(?:status|state|phase|stage)\b/i.test(text)) result.push("STATE_GUARD");
  if (/\b(?:role|permission|authori[sz]e|allowedRoles?|actorRole)\b/i.test(text)) result.push("PERMISSION_GUARD");
  if (/\b(?:featureFlag|feature[_-]?flag|enabled)\b/i.test(text)) result.push("CONFIGURATION_GUARD");
  return result;
}

function isTestArtifact(relativePath) {
  return /(^|\/)test(s)?\/|\.test\.[cm]?js$|\.spec\.[cm]?js$/.test(relativePath);
}

function resolveLocalArtifact(fromArtifact, specifier, artifactPaths) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromArtifact), specifier));
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}/index.js`];
  return candidates.find((candidate) => artifactPaths.has(candidate)) ?? null;
}

async function collectFiles(rootPath, limits) {
  const rootMetadata = await lstat(rootPath);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError("Scanner rootPath must be a non-symbolic-link directory");
  }
  const files = [];
  const diagnostics = [];
  let totalBytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
      if (relativePath === "package-lock.json" || relativePath.endsWith(".min.js")) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(extension) && !entry.name.startsWith(".env")) {
        if (unsupportedSourceExtensions.has(extension)) {
          diagnostics.push({
            severity: "ERROR",
            artifact: relativePath,
            message: `Source type ${extension} is outside this scanner's declared capability`,
          });
        }
        continue;
      }
      const metadata = await lstat(absolutePath);
      if (metadata.size > limits.maxFileBytes) {
        diagnostics.push({
          severity: "ERROR",
          artifact: relativePath,
          message: `File exceeds maxFileBytes (${metadata.size} > ${limits.maxFileBytes})`,
        });
        continue;
      }
      totalBytes += metadata.size;
      if (totalBytes > limits.maxTotalBytes) throw new RangeError("Scanner input exceeds maxTotalBytes");
      files.push({ absolutePath, relativePath, size: metadata.size });
      if (files.length > limits.maxFiles) throw new RangeError("Scanner input exceeds maxFiles");
    }
  }
  await visit(rootPath);
  return { files, diagnostics };
}

export class JavaScriptProjectScanner {
  #extractor;
  #clock;
  #limits;

  constructor({
    extractor = { id: "javascript-node-scanner", version: "0.1.0" },
    clock = () => new Date(),
    maxFiles = 250_000,
    maxFileBytes = 1024 * 1024,
    maxTotalBytes = 4 * 1024 * 1024 * 1024,
  } = {}) {
    for (const [name, value] of Object.entries({ maxFiles, maxFileBytes, maxTotalBytes })) {
      if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
    }
    this.#extractor = Object.freeze({ ...extractor });
    this.#clock = clock;
    this.#limits = { maxFiles, maxFileBytes, maxTotalBytes };
  }

  async fingerprint({ rootPath }) {
    const resolvedRoot = path.resolve(rootPath);
    const collected = await collectFiles(resolvedRoot, this.#limits);
    const fileRecords = [];
    for (const file of collected.files) {
      const content = await readFile(file.absolutePath, "utf8");
      fileRecords.push({ path: file.relativePath, contentHash: digest(content) });
    }
    return deepFreeze({
      sourceDigest: digest(canonicalJson(fileRecords.sort((left, right) => left.path.localeCompare(right.path)))),
      fileCount: fileRecords.length,
      diagnostics: collected.diagnostics,
    });
  }

  async scan({ projectId, snapshotManifestId, sourceComponentId, rootPath }) {
    const resolvedRoot = path.resolve(rootPath);
    const collected = await collectFiles(resolvedRoot, this.#limits);
    const files = collected.files;
    const observedAt = this.#clock().toISOString();
    const diagnostics = [...collected.diagnostics];
    const nodes = new Map();
    const edges = new Map();
    const fileRecords = [];
    const localReferences = [];
    const javascriptModuleExports = new Map();
    const javascriptSymbolReferences = [];
    const javaCallReferences = [];

    const addNode = (type, naturalKey, name, attributes, factSource) => {
      const id = stableFactNodeId(projectId, type, naturalKey);
      if (!nodes.has(id)) nodes.set(id, { type, naturalKey, name, attributes, source: factSource });
      return id;
    };
    const addEdge = (subjectId, predicate, objectId, attributes, factSource) => {
      if (subjectId === objectId) return;
      const key = canonicalJson({ subjectId, predicate, objectId });
      if (!edges.has(key)) edges.set(key, { subjectId, predicate, objectId, attributes, source: factSource });
    };

    let packageInfo = null;
    let moduleId = null;
    for (const file of files) {
      const content = await readFile(file.absolutePath, "utf8");
      const contentHash = digest(content);
      fileRecords.push({ path: file.relativePath, contentHash });
      const artifactId = addNode(
        "ARTIFACT",
        `artifact:${file.relativePath}`,
        file.relativePath,
        { extension: path.extname(file.relativePath), size: file.size },
        source(file.relativePath, contentHash, 1, lineCount(content)),
      );

      if (file.relativePath === "package.json") {
        try {
          packageInfo = JSON.parse(content);
          const moduleName = packageInfo.name ?? path.basename(resolvedRoot);
          moduleId = addNode(
            "MODULE",
            `npm:${moduleName}`,
            moduleName,
            { version: packageInfo.version ?? null, scripts: packageInfo.scripts ?? {} },
            source(file.relativePath, contentHash, 1, lineCount(content)),
          );
          addEdge(moduleId, "CONTAINS", artifactId, {}, source(file.relativePath, contentHash));
          for (const [name, version] of Object.entries({
            ...(packageInfo.dependencies ?? {}),
            ...(packageInfo.devDependencies ?? {}),
          })) {
            const dependencyId = addNode(
              "EXTERNAL_DEPENDENCY",
              `npm:${name}`,
              name,
              { version, ecosystem: "npm" },
              source(file.relativePath, contentHash),
            );
            addEdge(moduleId, "DEPENDS_ON", dependencyId, {}, source(file.relativePath, contentHash));
          }
          for (const [name, command] of Object.entries(packageInfo.scripts ?? {})) {
            const configurationId = addNode(
              "CONFIGURATION",
              `npm-script:${name}`,
              name,
              { value: command, category: "build-script" },
              source(file.relativePath, contentHash),
            );
            addEdge(moduleId, "CONTROLLED_BY", configurationId, {}, source(file.relativePath, contentHash));
          }
        } catch (error) {
          diagnostics.push({ severity: "ERROR", artifact: file.relativePath, message: error.message });
        }
      }

      if (["openapi.json", "swagger.json"].includes(path.basename(file.relativePath).toLowerCase())) {
        this.#scanOpenApi({ content, contentHash, relativePath: file.relativePath, addNode, addEdge, artifactId, diagnostics });
      }
      if (
        ["openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml"].includes(
          path.basename(file.relativePath).toLowerCase(),
        )
      ) {
        diagnostics.push({
          severity: "ERROR",
          artifact: file.relativePath,
          message: "OpenAPI YAML extraction is outside this scanner version's declared capability",
        });
      }
      if (path.extname(file.relativePath).toLowerCase() === ".sql") {
        this.#scanSql({ content, contentHash, relativePath: file.relativePath, addNode, addEdge, artifactId });
      }
      if ([".js", ".mjs", ".cjs"].includes(path.extname(file.relativePath).toLowerCase())) {
        this.#scanJavaScript({
          content,
          contentHash,
          relativePath: file.relativePath,
          addNode,
          addEdge,
          artifactId,
          diagnostics,
          localReferences,
          javascriptModuleExports,
          javascriptSymbolReferences,
        });
      }
      if (path.extname(file.relativePath).toLowerCase() === ".java") {
        this.#scanJava({
          content,
          contentHash,
          relativePath: file.relativePath,
          addNode,
          addEdge,
          artifactId,
          diagnostics,
          javaCallReferences,
        });
      }
      if (isTestArtifact(file.relativePath)) {
        const testAssetId = addNode(
          "TEST_ASSET",
          `test:${file.relativePath}`,
          file.relativePath,
          { framework: packageInfo?.scripts?.test ? "node-test" : "unknown" },
          source(file.relativePath, contentHash, 1, lineCount(content)),
        );
        addEdge(artifactId, "CONTAINS", testAssetId, {}, source(file.relativePath, contentHash));
      }
      if (file.relativePath.startsWith(".env") || [".yaml", ".yml", ".properties"].includes(path.extname(file.relativePath))) {
        this.#scanConfiguration({ content, contentHash, relativePath: file.relativePath, addNode, addEdge, artifactId });
      }
    }

    const artifactPaths = new Set(fileRecords.map((record) => record.path));
    const javascriptSymbolsByArtifact = new Map();
    for (const [id, node] of nodes.entries()) {
      if (node.type !== "CODE_SYMBOL" || node.attributes?.language !== "javascript") continue;
      const symbolsByName = javascriptSymbolsByArtifact.get(node.source.artifact) ?? new Map();
      const symbols = symbolsByName.get(node.name) ?? [];
      symbols.push({ id, node });
      symbolsByName.set(node.name, symbols);
      javascriptSymbolsByArtifact.set(node.source.artifact, symbolsByName);
    }
    const resolvedImportTargets = new Map();
    for (const reference of localReferences) {
      const targetArtifact = resolveLocalArtifact(reference.fromArtifact, reference.specifier, artifactPaths);
      if (!targetArtifact) continue;
      const sourceArtifactId = stableFactNodeId(projectId, "ARTIFACT", `artifact:${reference.fromArtifact}`);
      const targetArtifactId = stableFactNodeId(projectId, "ARTIFACT", `artifact:${targetArtifact}`);
      addEdge(sourceArtifactId, "DEPENDS_ON", targetArtifactId, {}, reference.source);
      const resolvedSymbols = [];
      const exportedBindings = javascriptModuleExports.get(targetArtifact) ?? [];
      for (const binding of reference.bindings ?? []) {
        const exportedLocalNames = [
          ...new Set(
            exportedBindings
              .filter((candidate) => candidate.exportedName === binding.importedName)
              .map((candidate) => candidate.localName),
          ),
        ];
        if (exportedLocalNames.length !== 1) continue;
        const candidates =
          javascriptSymbolsByArtifact.get(targetArtifact)?.get(exportedLocalNames[0]) ?? [];
        if (candidates.length !== 1) continue;
        const resolved = {
          ...candidates[0],
          importedName: binding.importedName,
          localName: binding.localName,
          importKind: binding.kind,
          targetArtifact,
        };
        resolvedSymbols.push(resolved);
        const key = canonicalJson({
          fromArtifact: reference.fromArtifact,
          localName: binding.localName,
        });
        const targets = resolvedImportTargets.get(key) ?? new Map();
        targets.set(resolved.id, resolved);
        resolvedImportTargets.set(key, targets);
      }
      if (!isTestArtifact(reference.fromArtifact)) continue;
      const testAssetId = stableFactNodeId(projectId, "TEST_ASSET", `test:${reference.fromArtifact}`);
      if (resolvedSymbols.length === 0) {
        addEdge(testAssetId, "EXERCISES", targetArtifactId, { basis: "STATIC_IMPORT" }, reference.source);
      } else {
        for (const symbol of resolvedSymbols) {
          addEdge(
            testAssetId,
            "EXERCISES",
            symbol.id,
            { basis: "ESM_STATIC_IMPORT", importKind: symbol.importKind },
            reference.source,
          );
        }
      }
    }
    for (const reference of javascriptSymbolReferences) {
      const key = canonicalJson({
        fromArtifact: reference.fromArtifact,
        localName: reference.localName,
      });
      const targets = [...(resolvedImportTargets.get(key)?.values() ?? [])];
      if (targets.length !== 1) continue;
      const target = targets[0];
      addEdge(
        reference.subjectId,
        reference.predicate,
        target.id,
        {
          basis: "JAVASCRIPT_ESM_IMPORT",
          importedName: target.importedName,
          localName: target.localName,
          importKind: target.importKind,
          targetArtifact: target.targetArtifact,
        },
        reference.source,
      );
    }

    const javaMethods = [...nodes.entries()]
      .filter(([, node]) => node.type === "CODE_SYMBOL" && node.attributes?.language === "java" && node.attributes?.symbolKind === "method")
      .map(([id, node]) => ({ node, id }));
    for (const reference of javaCallReferences) {
      const candidates = javaMethods.filter((candidate) => candidate.node.attributes.methodName === reference.methodName);
      const samePackage = candidates.filter((candidate) => candidate.node.attributes.packageName === reference.packageName);
      const selected = samePackage.length === 1 ? samePackage[0] : candidates.length === 1 ? candidates[0] : null;
      if (selected && selected.id !== reference.callerId) {
        addEdge(reference.callerId, "CALLS", selected.id, { basis: "JAVA_AST_METHOD_INVOCATION", qualifier: reference.qualifier }, reference.source);
      }
    }

    if (moduleId) {
      for (const node of nodes.values()) {
        if (["ARTIFACT", "CODE_SYMBOL", "ENDPOINT", "DATA_OBJECT", "TEST_ASSET"].includes(node.type)) {
          addEdge(moduleId, "CONTAINS", stableFactNodeId(projectId, node.type, node.naturalKey), {}, node.source);
        }
      }
    }

    const sourceDigest = digest(canonicalJson(fileRecords.sort((left, right) => left.path.localeCompare(right.path))));
    return createFactBundle({
      projectId,
      snapshotManifestId,
      sourceComponentId,
      sourceDigest,
      extractor: this.#extractor,
      observedAt,
      complete: true,
      diagnostics,
      nodes: [...nodes.values()].sort((left, right) => left.naturalKey.localeCompare(right.naturalKey)),
      edges: [...edges.values()].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    });
  }

  #scanJavaScript({
    content,
    contentHash,
    relativePath,
    addNode,
    addEdge,
    artifactId,
    diagnostics,
    localReferences,
    javascriptModuleExports,
    javascriptSymbolReferences,
  }) {
    let ast;
    try {
      ast = parse(content, { ecmaVersion: "latest", sourceType: "module", locations: true });
    } catch (error) {
      try {
        ast = parse(content, { ecmaVersion: "latest", sourceType: "script", locations: true });
      } catch (fallbackError) {
        diagnostics.push({ severity: "ERROR", artifact: relativePath, message: fallbackError.message });
        return;
      }
    }
    const symbolByNode = new Map();
    const naturalKeyBySymbolId = new Map();
    const exportedBindings = [];
    const importedLocalNames = new Set();
    const addSymbol = (name, kind, node, extraAttributes = {}) => {
      const naturalKey = `javascript:${relativePath}:${name}`;
      const symbolId = addNode(
        "CODE_SYMBOL",
        naturalKey,
        name,
        { language: "javascript", kind, ...extraAttributes },
        source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
      );
      symbolByNode.set(node, symbolId);
      naturalKeyBySymbolId.set(symbolId, naturalKey);
      addEdge(artifactId, "CONTAINS", symbolId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
      return symbolId;
    };
    simple(ast, {
      FunctionDeclaration: (node) => {
        if (node.id?.name) addSymbol(node.id.name, "function", node);
      },
      ClassDeclaration: (node) => {
        if (!node.id?.name) return;
        const suffixKind = /Controller$/i.test(node.id.name)
          ? "controller"
          : /Service$/i.test(node.id.name)
            ? "service"
            : /(?:Repository|Mapper)$/i.test(node.id.name)
              ? "repository"
              : /DTO$/i.test(node.id.name)
                ? "dto"
                : "class";
        const classId = addSymbol(node.id.name, suffixKind, node);
        for (const method of node.body.body) {
          const name = method.key?.name ?? literalString(method.key);
          if (!name) continue;
          const methodId = addSymbol(`${node.id.name}#${name}`, "method", method);
          if (method.value) symbolByNode.set(method.value, methodId);
          addEdge(classId, "CONTAINS", methodId, {}, source(relativePath, contentHash, method.loc.start.line, method.loc.end.line));
        }
      },
      VariableDeclarator: (node) => {
        if (node.id?.type === "Identifier" && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) {
          const symbolId = addSymbol(node.id.name, "function", node);
          symbolByNode.set(node.init, symbolId);
        } else if (node.id?.type === "Identifier" && calleeName(node.init?.callee) === "enumValues") {
          const values = node.init.arguments?.[0]?.type === "ArrayExpression"
            ? node.init.arguments[0].elements.map(literalString).filter((value) => value !== null)
            : [];
          addSymbol(node.id.name, "enum", node, { values });
        }
      },
      ImportDeclaration: (node) => {
        const specifier = literalString(node.source);
        if (!specifier) return;
        if (specifier.startsWith(".")) {
          const bindings = node.specifiers
            .map((item) => {
              if (item.type === "ImportSpecifier") {
                const importedName = item.imported.name ?? literalString(item.imported);
                return importedName
                  ? { importedName, localName: item.local.name, kind: "NAMED" }
                  : null;
              }
              if (item.type === "ImportDefaultSpecifier") {
                return { importedName: "default", localName: item.local.name, kind: "DEFAULT" };
              }
              return null;
            })
            .filter(Boolean);
          for (const binding of bindings) importedLocalNames.add(binding.localName);
          localReferences.push({
            fromArtifact: relativePath,
            specifier,
            bindings,
            source: source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
          });
          return;
        }
        if (specifier.startsWith("/")) return;
        const dependencyId = addNode(
          "EXTERNAL_DEPENDENCY",
          `module:${specifier}`,
          specifier,
          { ecosystem: specifier.startsWith("node:") ? "node-platform" : "npm-import" },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
        addEdge(artifactId, "DEPENDS_ON", dependencyId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
      },
      ExportNamedDeclaration: (node) => {
        if (node.source) return;
        if (node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ClassDeclaration") {
          if (node.declaration.id?.name) {
            exportedBindings.push({
              exportedName: node.declaration.id.name,
              localName: node.declaration.id.name,
            });
          }
          return;
        }
        if (node.declaration?.type === "VariableDeclaration") {
          for (const declaration of node.declaration.declarations) {
            if (declaration.id?.type === "Identifier") {
              exportedBindings.push({
                exportedName: declaration.id.name,
                localName: declaration.id.name,
              });
            }
          }
          return;
        }
        for (const specifier of node.specifiers) {
          const exportedName = specifier.exported.name ?? literalString(specifier.exported);
          const localName = specifier.local.name ?? literalString(specifier.local);
          if (exportedName && localName) exportedBindings.push({ exportedName, localName });
        }
      },
      ExportDefaultDeclaration: (node) => {
        const declaration = node.declaration;
        const localName =
          declaration?.type === "Identifier" ||
          declaration?.type === "FunctionDeclaration" ||
          declaration?.type === "ClassDeclaration"
            ? declaration.id?.name ?? declaration.name
            : null;
        if (localName) exportedBindings.push({ exportedName: "default", localName });
      },
    });
    javascriptModuleExports.set(relativePath, exportedBindings);

    const localBindingsByScope = new Map();
    const functionScopeTypes = new Set([
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
    ]);
    const blockScopeTypes = new Set([
      "Program",
      "BlockStatement",
      "StaticBlock",
      "SwitchStatement",
      "ForStatement",
      "ForInStatement",
      "ForOfStatement",
      "CatchClause",
    ]);
    const patternNames = (pattern) => {
      if (!pattern) return [];
      if (pattern.type === "Identifier") return [pattern.name];
      if (pattern.type === "RestElement") return patternNames(pattern.argument);
      if (pattern.type === "AssignmentPattern") return patternNames(pattern.left);
      if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(patternNames);
      if (pattern.type === "ObjectPattern") {
        return pattern.properties.flatMap((property) =>
          property.type === "RestElement" ? patternNames(property.argument) : patternNames(property.value),
        );
      }
      return [];
    };
    const nearestDeclarationScope = (ancestors, { functionScoped = false } = {}) => {
      for (let index = ancestors.length - 2; index >= 0; index -= 1) {
        const candidate = ancestors[index];
        if (candidate.type === "Program" || functionScopeTypes.has(candidate.type)) return candidate;
        if (!functionScoped && blockScopeTypes.has(candidate.type)) return candidate;
      }
      return ast;
    };
    const bindLocal = (scope, name, symbolId = null) => {
      const bindings = localBindingsByScope.get(scope) ?? new Map();
      bindings.set(name, symbolId);
      localBindingsByScope.set(scope, bindings);
    };
    const bindParameters = (node) => {
      for (const name of node.params.flatMap(patternNames)) bindLocal(node, name);
    };
    ancestor(ast, {
      FunctionDeclaration: (node, _state, ancestors) => {
        if (node.id?.name) {
          bindLocal(nearestDeclarationScope(ancestors), node.id.name, symbolByNode.get(node));
        }
        bindParameters(node);
      },
      FunctionExpression: (node) => {
        if (node.id?.name) bindLocal(node, node.id.name, symbolByNode.get(node));
        bindParameters(node);
      },
      ArrowFunctionExpression: (node) => {
        bindParameters(node);
      },
      ClassDeclaration: (node, _state, ancestors) => {
        if (node.id?.name) {
          bindLocal(nearestDeclarationScope(ancestors), node.id.name, symbolByNode.get(node));
        }
      },
      VariableDeclarator: (node, _state, ancestors) => {
        const declaration = ancestors.at(-2);
        const scope = nearestDeclarationScope(ancestors, {
          functionScoped: declaration?.type === "VariableDeclaration" && declaration.kind === "var",
        });
        for (const name of patternNames(node.id)) {
          bindLocal(scope, name, node.id?.type === "Identifier" ? symbolByNode.get(node) : null);
        }
      },
      CatchClause: (node) => {
        for (const name of patternNames(node.param)) bindLocal(node, name);
      },
    });
    const resolveLocalBinding = (name, ancestors) => {
      for (let index = ancestors.length - 2; index >= 0; index -= 1) {
        const bindings = localBindingsByScope.get(ancestors[index]);
        if (bindings?.has(name)) return { found: true, symbolId: bindings.get(name) };
      }
      return { found: false, symbolId: null };
    };
    const findCallingSymbol = (ancestors) => {
      for (let index = ancestors.length - 2; index >= 0; index -= 1) {
        const symbolId = symbolByNode.get(ancestors[index]);
        if (symbolId) return symbolId;
      }
      return null;
    };
    ancestor(ast, {
      IfStatement: (node, _state, ancestors) => {
        const callingSymbolId = findCallingSymbol(ancestors);
        const condition = boundedSourceText(content, node.test);
        const classifications = conditionClassifications(condition ?? "");
        const owner = naturalKeyBySymbolId.get(callingSymbolId) ?? `javascript:${relativePath}:artifact`;
        const branchId = addNode(
          "CODE_SYMBOL",
          `${owner}:branch:${digest(condition ?? String(node.loc.start.line))}:${node.loc.start.line}`,
          `condition @ line ${node.loc.start.line}`,
          { language: "javascript", kind: "condition-branch", condition, classifications },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
        addEdge(
          callingSymbolId ?? artifactId,
          "CONTAINS",
          branchId,
          { relation: classifications.length > 0 ? "SEMANTIC_GUARD" : "CONTROL_FLOW" },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
      },
      AssignmentExpression: (node, _state, ancestors) => {
        const field = memberName(node.left);
        const toState = literalString(node.right);
        if (!field || !toState || !/^(?:status|state|phase|stage)$/i.test(field)) return;
        const callingSymbolId = findCallingSymbol(ancestors);
        const owner = naturalKeyBySymbolId.get(callingSymbolId) ?? `javascript:${relativePath}:artifact`;
        const transitionId = addNode(
          "CODE_SYMBOL",
          `${owner}:state-transition:${field}:${toState}:${node.loc.start.line}`,
          `${field} → ${toState}`,
          { language: "javascript", kind: "state-transition", field, toState },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
        addEdge(callingSymbolId ?? artifactId, "CONTAINS", transitionId, { relation: "STATE_TRANSITION" }, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
      },
      ThrowStatement: (node, _state, ancestors) => {
        const callingSymbolId = findCallingSymbol(ancestors);
        const owner = naturalKeyBySymbolId.get(callingSymbolId) ?? `javascript:${relativePath}:artifact`;
        const errorType = node.argument?.type === "NewExpression" ? calleeName(node.argument.callee) : null;
        const message = node.argument?.type === "NewExpression" ? literalString(node.argument.arguments?.[0]) : null;
        const exceptionId = addNode(
          "CODE_SYMBOL",
          `${owner}:exception:${errorType ?? "throw"}:${node.loc.start.line}`,
          `${errorType ?? "throw"} @ line ${node.loc.start.line}`,
          { language: "javascript", kind: "exception-path", errorType, message },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
        addEdge(callingSymbolId ?? artifactId, "CONTAINS", exceptionId, { relation: "EXCEPTION_PATH" }, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
      },
      CallExpression: (node, _state, ancestors) => {
        const callingSymbolId = findCallingSymbol(ancestors);
        const method = memberName(node.callee)?.toLowerCase();
        const endpointPath = literalString(node.arguments?.[0]);
        if (method && httpMethods.has(method) && endpointPath?.startsWith("/")) {
          const endpointId = addNode(
            "ENDPOINT",
            `http:${method.toUpperCase()} ${endpointPath}`,
            `${method.toUpperCase()} ${endpointPath}`,
            { protocol: "HTTP", method: method.toUpperCase(), path: endpointPath, source: "javascript-ast" },
            source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
          );
          const handler = node.arguments.at(-1);
          if (handler?.type === "Identifier") {
            const localHandler = resolveLocalBinding(handler.name, ancestors);
            if (localHandler.symbolId) {
              addEdge(endpointId, "IMPLEMENTED_BY", localHandler.symbolId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
            } else if (!localHandler.found && importedLocalNames.has(handler.name)) {
              javascriptSymbolReferences.push({
                fromArtifact: relativePath,
                localName: handler.name,
                subjectId: endpointId,
                predicate: "IMPLEMENTED_BY",
                source: source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
              });
            }
          } else if (["ArrowFunctionExpression", "FunctionExpression"].includes(handler?.type)) {
            const handlerId = addSymbol(`${method.toUpperCase()} ${endpointPath} handler`, "route-handler", handler);
            symbolByNode.set(handler, handlerId);
            addEdge(endpointId, "IMPLEMENTED_BY", handlerId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
          }
        }
        const calledName = calleeName(node.callee);
        const localCall = node.callee?.type === "Identifier"
          ? resolveLocalBinding(node.callee.name, ancestors)
          : { found: false, symbolId: null };
        if (callingSymbolId && localCall.symbolId) {
          addEdge(callingSymbolId, "CALLS", localCall.symbolId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
        } else if (
          callingSymbolId &&
          !localCall.found &&
          node.callee?.type === "Identifier" &&
          importedLocalNames.has(node.callee.name)
        ) {
          javascriptSymbolReferences.push({
            fromArtifact: relativePath,
            localName: node.callee.name,
            subjectId: callingSymbolId,
            predicate: "CALLS",
            source: source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
          });
        }
        if (callingSymbolId && calledName && /(?:require|check|assert|enforce).*(?:role|permission)|authori[sz]e|canAccess/i.test(calledName)) {
          const permissionId = addNode(
            "CODE_SYMBOL",
            `${naturalKeyBySymbolId.get(callingSymbolId)}:permission-check:${calledName}:${node.loc.start.line}`,
            `${calledName} permission check`,
            {
              language: "javascript",
              kind: "permission-check",
              operation: calledName,
              declaredArguments: node.arguments.map((argument) => literalString(argument)).filter((value) => value !== null),
            },
            source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
          );
          addEdge(callingSymbolId, "CONTAINS", permissionId, { relation: "PERMISSION_GUARD" }, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
        }

        if (calledName === "require") {
          const specifier = literalString(node.arguments?.[0]);
          if (specifier?.startsWith(".")) {
            localReferences.push({
              fromArtifact: relativePath,
              specifier,
              bindings: [],
              source: source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
            });
          }
          if (specifier && !specifier.startsWith(".") && !specifier.startsWith("/")) {
            const dependencyId = addNode(
              "EXTERNAL_DEPENDENCY",
              `module:${specifier}`,
              specifier,
              { ecosystem: specifier.startsWith("node:") ? "node-platform" : "npm-import" },
              source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
            );
            addEdge(artifactId, "DEPENDS_ON", dependencyId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
          }
        }

        if (callingSymbolId && memberName(node.callee) === "query") {
          const statement = literalString(node.arguments?.[0]);
          const match = statement && /\b(SELECT\s+.+?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z_][\w.]*)/is.exec(statement);
          if (match) {
            const tableName = match[2];
            const tableId = addNode(
              "DATA_OBJECT",
              `table:${tableName}`,
              tableName,
              { kind: "table", inferredFrom: "sql-query" },
              source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
            );
            const predicate = /^SELECT/i.test(match[1]) ? "READS" : "WRITES";
            addEdge(callingSymbolId, predicate, tableId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
            const transition = /^UPDATE\s+[a-zA-Z_][\w.]*\s+SET\s+(?:[^;]*?,\s*)?(status|state|phase|stage)\s*=\s*'([^']+)'/is.exec(statement);
            if (transition) {
              const transitionId = addNode(
                "CODE_SYMBOL",
                `${naturalKeyBySymbolId.get(callingSymbolId)}:sql-state-transition:${transition[1]}:${transition[2]}:${node.loc.start.line}`,
                `${transition[1]} → ${transition[2]}`,
                { language: "sql", kind: "state-transition", field: transition[1], toState: transition[2], table: tableName },
                source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
              );
              addEdge(callingSymbolId, "CONTAINS", transitionId, { relation: "STATE_TRANSITION" }, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
            }
          }
        }
      },
      MemberExpression: (node, _state, ancestors) => {
        if (
          node.object?.type !== "MemberExpression" ||
          calleeName(node.object) !== "process.env"
        ) {
          return;
        }
        const key = memberName(node);
        if (!key) return;
        const configurationId = addNode(
          "CONFIGURATION",
          `env:${key}`,
          key,
          { category: "environment", referencedBy: relativePath },
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
        const callingSymbolId = findCallingSymbol(ancestors);
        addEdge(
          callingSymbolId ?? artifactId,
          callingSymbolId ? "CONTROLLED_BY" : "CONTAINS",
          configurationId,
          {},
          source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
        );
      },
    });
  }

  #scanJava({ content, contentHash, relativePath, addNode, addEdge, artifactId, diagnostics, javaCallReferences }) {
    let root;
    try {
      root = parseSyntaxTree("java", content).root();
    } catch (error) {
      diagnostics.push({ severity: "ERROR", artifact: relativePath, message: `Java AST parse failed: ${error.message}` });
      return;
    }
    const packageName = root.find({ rule: { kind: "package_declaration" } })?.text()
      .replace(/^\s*package\s+/, "").replace(/\s*;\s*$/, "") ?? "";
    const classNodes = ["class_declaration", "interface_declaration", "record_declaration", "enum_declaration"]
      .flatMap((kind) => root.findAll({ rule: { kind } }));
    const classInfo = new Map();
    const methodByAstId = new Map();
    const annotationNames = (text) => [...text.matchAll(/@([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
    const annotationValue = (text, name) => {
      const match = new RegExp(`@${name}\\s*(?:\\(\\s*(?:value\\s*=\\s*|path\\s*=\\s*)?[\"']([^\"']*)[\"'][\\s\\S]*?\\))?`).exec(text);
      return match?.[1] ?? "";
    };
    const lineSource = (node) => {
      const range = node.range();
      return source(relativePath, contentHash, range.start.line + 1, range.end.line + 1);
    };
    const classRole = (name, annotations, artifact) => {
      const context = `${name} ${annotations.join(" ")} ${artifact}`;
      if (/(?:RestController|Controller|Resource)/i.test(context)) return "controller";
      if (/(?:Service|UseCase|Facade|Manager)/i.test(context)) return "service";
      if (/(?:Repository|Mapper|Dao)/i.test(context)) return "repository";
      if (/(?:Entity|Document)/i.test(context)) return "entity";
      if (/(?:Dto|Request|Response)$/i.test(name)) return "dto";
      return "class";
    };
    for (const classNode of classNodes) {
      const name = classNode.field("name")?.text();
      if (!name) continue;
      const modifiers = classNode.children().find((child) => child.kind() === "modifiers")?.text() ?? classNode.text().slice(0, 500);
      const annotations = annotationNames(modifiers);
      const role = classRole(name, annotations, relativePath);
      const naturalKey = `java:${packageName}:${name}`;
      const classId = addNode(
        "CODE_SYMBOL",
        naturalKey,
        name,
        { language: "java", symbolKind: "class", kind: role, packageName, annotations },
        lineSource(classNode),
      );
      addEdge(artifactId, "CONTAINS", classId, {}, lineSource(classNode));
      classInfo.set(classNode.id(), { id: classId, name, role, annotations, naturalKey, node: classNode });
      if (["entity", "dto"].includes(role) || classNode.kind() === "record_declaration") {
        const dataId = addNode(
          "DATA_OBJECT",
          `java-type:${packageName}:${name}`,
          name,
          { kind: role === "entity" ? "entity" : "dto", language: "java", packageName },
          lineSource(classNode),
        );
        addEdge(classId, "CONTAINS", dataId, { relation: "JAVA_DATA_TYPE" }, lineSource(classNode));
      }
    }

    const methods = root.findAll({ rule: { kind: "method_declaration" } });
    for (const methodNode of methods) {
      const methodName = methodNode.field("name")?.text();
      if (!methodName) continue;
      const ownerNode = methodNode.ancestors().find((ancestorNode) => classInfo.has(ancestorNode.id()));
      const owner = ownerNode ? classInfo.get(ownerNode.id()) : null;
      const modifiers = methodNode.children().find((child) => child.kind() === "modifiers")?.text() ?? "";
      const annotations = annotationNames(modifiers);
      const visibility = /\bpublic\b/.test(modifiers) ? "public" : /\bprotected\b/.test(modifiers) ? "protected" : /\bprivate\b/.test(modifiers) ? "private" : "package";
      const returnType = methodNode.field("type")?.text() ?? "void";
      const parameters = methodNode.field("parameters")?.text() ?? "()";
      const naturalKey = `java:${packageName}:${owner?.name ?? "Unknown"}#${methodName}:${parameters}`;
      const methodId = addNode(
        "CODE_SYMBOL",
        naturalKey,
        `${owner?.name ?? "Java"}#${methodName}`,
        {
          language: "java",
          symbolKind: "method",
          kind: owner?.role === "service" ? "service" : owner?.role === "controller" ? "handler" : owner?.role ?? "method",
          owner: owner?.name ?? null,
          methodName,
          visibility,
          returnType,
          parameters,
          packageName,
          annotations,
        },
        lineSource(methodNode),
      );
      methodByAstId.set(methodNode.id(), methodId);
      if (owner) addEdge(owner.id, "CONTAINS", methodId, {}, lineSource(methodNode));
      else addEdge(artifactId, "CONTAINS", methodId, {}, lineSource(methodNode));

      const classText = owner?.node.children().find((child) => child.kind() === "modifiers")?.text() ?? "";
      const basePath = annotationValue(classText, "RequestMapping") || annotationValue(classText, "Path");
      const endpointAnnotations = [
        ["GetMapping", "GET"], ["PostMapping", "POST"], ["PutMapping", "PUT"], ["PatchMapping", "PATCH"], ["DeleteMapping", "DELETE"],
        ["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"],
      ];
      for (const [annotation, httpMethod] of endpointAnnotations) {
        if (!annotations.includes(annotation)) continue;
        const childPath = annotationValue(modifiers, annotation) || annotationValue(modifiers, "Path");
        const endpointPath = `/${basePath}/${childPath}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
        const endpointId = addNode(
          "ENDPOINT",
          `http:${httpMethod} ${endpointPath}`,
          `${httpMethod} ${endpointPath}`,
          {
            protocol: annotations.some((name) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(name)) ? "JAX-RS" : "Spring",
            method: httpMethod,
            path: endpointPath,
            handler: `${owner?.name ?? "Java"}#${methodName}`,
            returnType,
            parameters,
            validationAnnotations: annotationNames(parameters).filter((name) => /Valid|Not|Size|Min|Max|Pattern/i.test(name)),
            securityAnnotations: [...new Set([...annotationNames(classText), ...annotations])].filter((name) => /PreAuthorize|Secured|RolesAllowed|PermitAll|DenyAll/i.test(name)),
          },
          lineSource(methodNode),
        );
        addEdge(endpointId, "IMPLEMENTED_BY", methodId, {}, lineSource(methodNode));
      }
      if (annotations.includes("RequestMapping")) {
        const annotationText = modifiers.match(/@RequestMapping\s*\([\s\S]*?\)/)?.[0] ?? "";
        const verbs = [...annotationText.matchAll(/RequestMethod\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g)].map((match) => match[1]);
        for (const httpMethod of verbs.length > 0 ? verbs : ["REQUEST"]) {
          const childPath = annotationValue(modifiers, "RequestMapping");
          const endpointPath = `/${basePath}/${childPath}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
          const endpointId = addNode("ENDPOINT", `http:${httpMethod} ${endpointPath}`, `${httpMethod} ${endpointPath}`, {
            protocol: "Spring", method: httpMethod, path: endpointPath, handler: `${owner?.name ?? "Java"}#${methodName}`, returnType, parameters,
          }, lineSource(methodNode));
          addEdge(endpointId, "IMPLEMENTED_BY", methodId, {}, lineSource(methodNode));
        }
      }

      const security = [...new Set([...annotationNames(classText), ...annotations])].filter((name) => /PreAuthorize|Secured|RolesAllowed|PermitAll|DenyAll/i.test(name));
      for (const annotation of security) {
        const permissionId = addNode("CODE_SYMBOL", `${naturalKey}:security:${annotation}`, `${annotation} on ${methodName}`, {
          language: "java", symbolKind: "guard", kind: "permission-check", annotation,
        }, lineSource(methodNode));
        addEdge(methodId, "CONTAINS", permissionId, { relation: "PERMISSION_GUARD" }, lineSource(methodNode));
      }
      for (const invocation of methodNode.findAll({ rule: { kind: "method_invocation" } })) {
        const calledName = invocation.field("name")?.text();
        if (!calledName) continue;
        javaCallReferences.push({
          callerId: methodId,
          methodName: calledName,
          qualifier: invocation.field("object")?.text() ?? null,
          packageName,
          source: lineSource(invocation),
        });
      }
      const methodText = methodNode.text();
      for (const match of methodText.matchAll(/(?:@Value\s*\(\s*["']\$\{([^}:]+)|getProperty\s*\(\s*["']([^"']+))/g)) {
        const key = match[1] ?? match[2];
        const configurationId = addNode("CONFIGURATION", `java-config:${key}`, key, { category: "java-configuration", referencedBy: relativePath }, lineSource(methodNode));
        addEdge(methodId, "CONTROLLED_BY", configurationId, {}, lineSource(methodNode));
      }
    }
  }

  #scanOpenApi({ content, contentHash, relativePath, addNode, addEdge, artifactId, diagnostics }) {
    try {
      const contract = JSON.parse(content);
      for (const [endpointPath, operations] of Object.entries(contract.paths ?? {})) {
        for (const [method, operation] of Object.entries(operations)) {
          if (!httpMethods.has(method.toLowerCase())) continue;
          const endpointId = addNode(
            "ENDPOINT",
            `http:${method.toUpperCase()} ${endpointPath}`,
            `${method.toUpperCase()} ${endpointPath}`,
            { protocol: "HTTP", method: method.toUpperCase(), path: endpointPath, operationId: operation.operationId ?? null, source: "openapi" },
            source(relativePath, contentHash, 1, lineCount(content)),
          );
          addEdge(artifactId, "CONTAINS", endpointId, {}, source(relativePath, contentHash));
        }
      }
    } catch (error) {
      diagnostics.push({ severity: "ERROR", artifact: relativePath, message: error.message });
    }
  }

  #scanSql({ content, contentHash, relativePath, addNode, addEdge, artifactId }) {
    const lines = content.split("\n");
    let currentTable = null;
    for (const [index, line] of lines.entries()) {
      const tableMatch = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w.]*)/i.exec(line);
      if (tableMatch) {
        currentTable = {
          id: addNode(
            "DATA_OBJECT",
            `table:${tableMatch[1]}`,
            tableMatch[1],
            { kind: "table" },
            source(relativePath, contentHash, index + 1, index + 1),
          ),
          name: tableMatch[1],
        };
        addEdge(artifactId, "CONTAINS", currentTable.id, {}, source(relativePath, contentHash, index + 1, index + 1));
        continue;
      }
      if (currentTable && /^\s*\);?\s*$/.test(line)) {
        currentTable = null;
        continue;
      }
      if (currentTable) {
        const columnMatch = /^\s*([a-zA-Z_][\w]*)\s+([a-zA-Z][\w]*(?:\([^)]*\))?)/.exec(line);
        if (columnMatch && !/^(?:primary|foreign|unique|check|constraint)$/i.test(columnMatch[1])) {
          const columnId = addNode(
            "DATA_OBJECT",
            `column:${currentTable.name}.${columnMatch[1]}`,
            `${currentTable.name}.${columnMatch[1]}`,
            { kind: "column", dataType: columnMatch[2] },
            source(relativePath, contentHash, index + 1, index + 1),
          );
          addEdge(currentTable.id, "CONTAINS", columnId, {}, source(relativePath, contentHash, index + 1, index + 1));
        }
      }
    }
  }

  #scanConfiguration({ content, contentHash, relativePath, addNode, addEdge, artifactId }) {
    for (const [index, line] of content.split("\n").entries()) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]/.exec(line);
      if (!match) continue;
      const configurationId = addNode(
        "CONFIGURATION",
        `config:${relativePath}:${match[1]}`,
        match[1],
        { artifact: relativePath },
        source(relativePath, contentHash, index + 1, index + 1),
      );
      addEdge(artifactId, "CONTAINS", configurationId, {}, source(relativePath, contentHash, index + 1, index + 1));
    }
  }
}
