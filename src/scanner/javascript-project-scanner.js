import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "acorn";
import { ancestor, simple } from "acorn-walk";

import { canonicalJson, createFactBundle, deepFreeze, stableFactNodeId } from "../domain/index.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);
const supportedExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".sql", ".yaml", ".yml", ".properties"]);
const unsupportedSourceExtensions = new Set([
  ".ts", ".tsx", ".jsx", ".java", ".kt", ".kts", ".go", ".py", ".rb", ".php", ".cs", ".fs",
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
    maxFiles = 10_000,
    maxFileBytes = 1024 * 1024,
    maxTotalBytes = 64 * 1024 * 1024,
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
    for (const reference of localReferences) {
      const targetArtifact = resolveLocalArtifact(reference.fromArtifact, reference.specifier, artifactPaths);
      if (!targetArtifact) continue;
      const sourceArtifactId = stableFactNodeId(projectId, "ARTIFACT", `artifact:${reference.fromArtifact}`);
      const targetArtifactId = stableFactNodeId(projectId, "ARTIFACT", `artifact:${targetArtifact}`);
      addEdge(sourceArtifactId, "DEPENDS_ON", targetArtifactId, {}, reference.source);
      if (!isTestArtifact(reference.fromArtifact)) continue;
      const testAssetId = stableFactNodeId(projectId, "TEST_ASSET", `test:${reference.fromArtifact}`);
      const exercisedSymbols = [...nodes.values()].filter(
        (node) =>
          node.type === "CODE_SYMBOL" &&
          node.source.artifact === targetArtifact &&
          reference.importedNames.includes(node.name),
      );
      if (exercisedSymbols.length === 0) {
        addEdge(testAssetId, "EXERCISES", targetArtifactId, { basis: "STATIC_IMPORT" }, reference.source);
      } else {
        for (const symbol of exercisedSymbols) {
          addEdge(
            testAssetId,
            "EXERCISES",
            stableFactNodeId(projectId, symbol.type, symbol.naturalKey),
            { basis: "NAMED_STATIC_IMPORT" },
            reference.source,
          );
        }
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
    const symbolByName = new Map();
    const symbolByNode = new Map();
    const addSymbol = (name, kind, node) => {
      const symbolId = addNode(
        "CODE_SYMBOL",
        `javascript:${relativePath}:${name}`,
        name,
        { language: "javascript", kind },
        source(relativePath, contentHash, node.loc.start.line, node.loc.end.line),
      );
      symbolByName.set(name, symbolId);
      symbolByNode.set(node, symbolId);
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
          addSymbol(node.id.name, "enum", node);
        }
      },
      ImportDeclaration: (node) => {
        const specifier = literalString(node.source);
        if (!specifier) return;
        if (specifier.startsWith(".")) {
          localReferences.push({
            fromArtifact: relativePath,
            specifier,
            importedNames: node.specifiers
              .filter((item) => item.type === "ImportSpecifier")
              .map((item) => item.imported.name ?? literalString(item.imported))
              .filter(Boolean),
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
    });

    const findCallingSymbol = (ancestors) => {
      for (let index = ancestors.length - 2; index >= 0; index -= 1) {
        const symbolId = symbolByNode.get(ancestors[index]);
        if (symbolId) return symbolId;
      }
      return null;
    };
    ancestor(ast, {
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
          if (handler?.type === "Identifier" && symbolByName.has(handler.name)) {
            addEdge(endpointId, "IMPLEMENTED_BY", symbolByName.get(handler.name), {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
          } else if (["ArrowFunctionExpression", "FunctionExpression"].includes(handler?.type)) {
            const handlerId = addSymbol(`${method.toUpperCase()} ${endpointPath} handler`, "route-handler", handler);
            symbolByNode.set(handler, handlerId);
            addEdge(endpointId, "IMPLEMENTED_BY", handlerId, {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
          }
        }
        const calledName = calleeName(node.callee);
        if (callingSymbolId && calledName && symbolByName.has(calledName)) {
          addEdge(callingSymbolId, "CALLS", symbolByName.get(calledName), {}, source(relativePath, contentHash, node.loc.start.line, node.loc.end.line));
        }

        if (calledName === "require") {
          const specifier = literalString(node.arguments?.[0]);
          if (specifier?.startsWith(".")) {
            localReferences.push({
              fromArtifact: relativePath,
              specifier,
              importedNames: [],
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
