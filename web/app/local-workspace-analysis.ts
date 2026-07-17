export type LocalWorkspaceInputFile = {
  path: string;
  content: string;
  size: number;
};

export type LocalFeatureCandidate = {
  id: string;
  name: string;
  kind: "ENDPOINT" | "CODE_SYMBOL" | "COMMAND";
  method: string | null;
  modulePath: string;
  sourcePath: string;
  startLine: number;
  description: string;
  code: string;
  configurations: Array<{ path: string; key: string; value: string }>;
  tests: Array<{ path: string; title: string; code: string }>;
  dimensions: {
    authority: "PENDING";
    conformance: "PARTIAL";
    verification: "NOT_RUN";
    freshness: "UNKNOWN";
    conflict: "NONE";
  };
  gaps: Array<{ type: string; severity: "BLOCKING" | "WARNING"; ownerRole: string }>;
};

export type LocalFeatureTreeNode = {
  id: string;
  label: string;
  kind: "WORKSPACE" | "MODULE" | "GROUP" | "FEATURE";
  featureId?: string;
  children: LocalFeatureTreeNode[];
};

export type LocalWorkspaceAnalysis = {
  workspaceName: string;
  projectId: string;
  scannedAt: string;
  fileCount: number;
  supportedFileCount: number;
  skippedFileCount: number;
  features: LocalFeatureCandidate[];
  tree: LocalFeatureTreeNode;
};

const supportedExtensions = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "go", "cs", "rs", "vue", "json", "md", "yaml", "yml", "sql", "properties", "env",
]);
const ignoredSegments = new Set([".git", "node_modules", "dist", "build", ".next", ".vinext", "coverage", "vendor"]);
const sourceExtensions = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "go", "cs", "rs", "vue"]);
const configurationExtensions = new Set(["json", "yaml", "yml", "properties", "env"]);
const maxFileBytes = 768 * 1024;

function extension(path: string) {
  const name = path.split("/").at(-1) ?? path;
  if (name.startsWith(".env")) return "env";
  return name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

function eligible(file: LocalWorkspaceInputFile) {
  const segments = file.path.split("/").filter(Boolean);
  const name = segments.at(-1)?.toLowerCase() ?? "";
  const actualEnvironmentFile = /^\.env(?:\.[^.]+)?$/.test(name) && !/\.(?:example|sample|template)$/.test(name);
  return !actualEnvironmentFile && !segments.some((segment) => ignoredSegments.has(segment)) && supportedExtensions.has(extension(file.path));
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `FEATURE-DISCOVERED-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function lineNumber(content: string, offset: number) {
  return content.slice(0, offset).split("\n").length;
}

function excerpt(content: string, offset: number, lines = 18) {
  const all = content.split("\n");
  const start = Math.max(0, lineNumber(content, offset) - 2);
  return all.slice(start, start + lines).join("\n");
}

function modulePath(path: string) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return "root";
  if (["src", "app", "lib", "packages", "services", "modules"].includes(segments[0]) && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

function titleFromSymbol(symbol: string) {
  return symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function discoverSourceCandidates(file: LocalWorkspaceInputFile) {
  const candidates: Array<Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">> = [];
  const routePattern = /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  for (const match of file.content.matchAll(routePattern)) {
    const method = match[1].toUpperCase();
    const route = match[2];
    const identity = `${file.path}:endpoint:${method}:${route}`;
    candidates.push({
      id: stableId(identity),
      name: `${method} ${route}`,
      kind: "ENDPOINT",
      method,
      modulePath: modulePath(file.path),
      sourcePath: file.path,
      startLine: lineNumber(file.content, match.index ?? 0),
      description: `Discovered ${method} endpoint ${route} from the selected source tree.`,
      code: excerpt(file.content, match.index ?? 0),
    });
  }

  const exportPattern = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of file.content.matchAll(exportPattern)) {
    const symbol = match[1];
    const identity = `${file.path}:symbol:${symbol}`;
    candidates.push({
      id: stableId(identity),
      name: titleFromSymbol(symbol),
      kind: "CODE_SYMBOL",
      method: null,
      modulePath: modulePath(file.path),
      sourcePath: file.path,
      startLine: lineNumber(file.content, match.index ?? 0),
      description: `Discovered exported capability ${symbol} from the selected source tree.`,
      code: excerpt(file.content, match.index ?? 0),
    });
  }
  const language = extension(file.path);
  const languagePatterns: RegExp[] = [];
  if (language === "py") languagePatterns.push(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm);
  if (language === "go") languagePatterns.push(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm);
  if (language === "rs") languagePatterns.push(/^\s*pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/gm);
  if (language === "java" || language === "cs") {
    languagePatterns.push(/^\s*(?:public|protected)\s+(?:static\s+)?(?:async\s+)?[\w<>,?\[\].]+\s+([A-Za-z_]\w*)\s*\(/gm);
  }
  for (const pattern of languagePatterns) {
    for (const match of file.content.matchAll(pattern)) {
      const symbol = match[1];
      if (["if", "for", "while", "switch", "catch"].includes(symbol)) continue;
      const identity = `${file.path}:symbol:${symbol}`;
      candidates.push({
        id: stableId(identity),
        name: titleFromSymbol(symbol),
        kind: "CODE_SYMBOL",
        method: null,
        modulePath: modulePath(file.path),
        sourcePath: file.path,
        startLine: lineNumber(file.content, match.index ?? 0),
        description: `Discovered ${language.toUpperCase()} capability ${symbol} from the selected source tree.`,
        code: excerpt(file.content, match.index ?? 0),
      });
    }
  }
  return candidates;
}

function discoverOpenApiCandidates(file: LocalWorkspaceInputFile) {
  if (!file.path.toLowerCase().endsWith(".json")) return [];
  let document: unknown;
  try {
    document = JSON.parse(file.content);
  } catch {
    return [];
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths;
  if (!paths || typeof paths !== "object") return [];
  const result: Array<Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">> = [];
  for (const [route, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations ?? {})) {
      if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method.toLowerCase())) continue;
      const upperMethod = method.toUpperCase();
      const identity = `${file.path}:openapi:${upperMethod}:${route}`;
      result.push({
        id: stableId(identity),
        name: `${upperMethod} ${route}`,
        kind: "ENDPOINT",
        method: upperMethod,
        modulePath: modulePath(file.path),
        sourcePath: file.path,
        startLine: 1,
        description: `Discovered ${upperMethod} endpoint ${route} from an OpenAPI document.`,
        code: JSON.stringify({ [route]: operations }, null, 2).slice(0, 6_000),
      });
    }
  }
  return result;
}

function discoverCommands(file: LocalWorkspaceInputFile) {
  if (!file.path.endsWith("package.json")) return [];
  try {
    const parsed = JSON.parse(file.content) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({
      id: stableId(`${file.path}:command:${name}`),
      name: `npm run ${name}`,
      kind: "COMMAND" as const,
      method: null,
      modulePath: modulePath(file.path),
      sourcePath: file.path,
      startLine: 1,
      description: `Discovered project command ${name}.`,
      code: command,
    }));
  } catch {
    return [];
  }
}

function configurationClues(files: LocalWorkspaceInputFile[]) {
  return files
    .filter((file) => configurationExtensions.has(extension(file.path)) && !file.path.endsWith("package-lock.json"))
    .slice(0, 12)
    .map((file) => ({ path: file.path, key: file.path.split("/").at(-1) ?? file.path, value: redactConfiguration(file.content.slice(0, 500)) }));
}

function redactConfiguration(content: string) {
  return content.split("\n").map((line) => {
    if (!/(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)/i.test(line)) return line;
    return line.replace(/([:=]\s*)([^,}\s]+|["'][^"']*["'])/, "$1<redacted>");
  }).join("\n");
}

type RelatedTest = { path: string; title: string; code: string };

function isTestFile(path: string) {
  return /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\.[^.]+$/i.test(path);
}

function indexTest(testIndex: Map<string, RelatedTest[]>, file: LocalWorkspaceInputFile) {
  const test = { path: file.path, title: file.path.split("/").at(-1) ?? file.path, code: file.content.slice(0, 4_000) };
  const identifiers = file.content.match(/[A-Za-z_$][\w$-]{2,}/g) ?? [];
  const keys = new Set([file.path.split("/").at(-1)?.replace(/\.[^.]+$/, "").toLowerCase() ?? "", ...identifiers.slice(0, 300).map((item) => item.toLowerCase())]);
  for (const key of keys) {
    if (!key) continue;
    const records = testIndex.get(key) ?? [];
    if (records.length < 20 && !records.some((record) => record.path === test.path)) records.push(test);
    testIndex.set(key, records);
  }
}

function indexedTests(feature: { sourcePath: string; name: string }, testIndex: Map<string, RelatedTest[]>) {
  const sourceName = feature.sourcePath.split("/").at(-1)?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
  const keys = new Set([sourceName, ...feature.name.toLowerCase().split(/[^a-z0-9_$-]+/).filter((item) => item.length > 2)]);
  return [...new Map([...keys].flatMap((key) => testIndex.get(key) ?? []).map((test) => [test.path, test])).values()].slice(0, 20);
}

function buildTree(workspaceName: string, projectId: string, features: LocalFeatureCandidate[]): LocalFeatureTreeNode {
  const modules = new Map<string, LocalFeatureCandidate[]>();
  for (const feature of features) modules.set(feature.modulePath, [...(modules.get(feature.modulePath) ?? []), feature]);
  return {
    id: projectId,
    label: workspaceName,
    kind: "WORKSPACE",
    children: [...modules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([module, items]) => ({
      id: `${projectId}:${module}`,
      label: module,
      kind: "MODULE",
      children: (["ENDPOINT", "CODE_SYMBOL", "COMMAND"] as const).map((kind) => ({
        id: `${projectId}:${module}:${kind}`,
        label: kind,
        kind: "GROUP" as const,
        children: items.filter((item) => item.kind === kind).sort((left, right) => left.name.localeCompare(right.name)).map((feature) => ({
          id: feature.id,
          label: feature.name,
          kind: "FEATURE" as const,
          featureId: feature.id,
          children: [],
        })),
      })).filter((group) => group.children.length > 0),
    })),
  };
}

export function analyzeLocalWorkspace(input: {
  workspaceName: string;
  projectId: string;
  files: LocalWorkspaceInputFile[];
  now?: Date;
}): LocalWorkspaceAnalysis {
  const accumulator = createLocalWorkspaceAnalysisAccumulator({ workspaceName: input.workspaceName, projectId: input.projectId, now: input.now });
  accumulator.addFiles(input.files);
  return accumulator.finish();
}

export function createLocalWorkspaceAnalysisAccumulator(input: { workspaceName: string; projectId: string; now?: Date }) {
  const workspaceName = input.workspaceName.trim();
  const projectId = input.projectId.trim();
  if (!workspaceName) throw new TypeError("Workspace name is required");
  if (!projectId) throw new TypeError("Project ID is required");
  const rawCandidates = new Map<string, Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">>();
  const configurationFiles: LocalWorkspaceInputFile[] = [];
  const testIndex = new Map<string, RelatedTest[]>();
  let fileCount = 0;
  let supportedFileCount = 0;
  let skippedFileCount = 0;
  return {
    addFiles(files: LocalWorkspaceInputFile[]) {
      fileCount += files.length;
      for (const file of files) {
        if (!eligible(file) || file.size > maxFileBytes) {
          skippedFileCount += 1;
          continue;
        }
        supportedFileCount += 1;
        const type = extension(file.path);
        const discovered = [
          ...(sourceExtensions.has(type) ? discoverSourceCandidates(file) : []),
          ...discoverOpenApiCandidates(file),
          ...discoverCommands(file),
        ];
        for (const feature of discovered) rawCandidates.set(feature.id, feature);
        if (configurationFiles.length < 12 && configurationExtensions.has(type) && !file.path.endsWith("package-lock.json")) configurationFiles.push(file);
        if (isTestFile(file.path)) indexTest(testIndex, file);
      }
    },
    finish(): LocalWorkspaceAnalysis {
      if (fileCount === 0) throw new TypeError("Select a source directory first");
      const configurations = configurationClues(configurationFiles);
      const features: LocalFeatureCandidate[] = [...rawCandidates.values()].map((feature) => {
        const tests = indexedTests(feature, testIndex);
        return {
          ...feature,
          configurations,
          tests,
          dimensions: { authority: "PENDING", conformance: "PARTIAL", verification: "NOT_RUN", freshness: "UNKNOWN", conflict: "NONE" },
          gaps: [
            { type: "MISSING_AUTHORITY", severity: "BLOCKING", ownerRole: "product-owner" },
            { type: "IMPLEMENTATION_UNREVIEWED", severity: "BLOCKING", ownerRole: "technical-owner" },
            ...(tests.length === 0 ? [{ type: "NO_TEST_SPEC", severity: "BLOCKING" as const, ownerRole: "quality-owner" }] : []),
            { type: "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT", severity: "BLOCKING", ownerRole: "quality-owner" },
          ],
        };
      });
      return {
        workspaceName,
        projectId,
        scannedAt: (input.now ?? new Date()).toISOString(),
        fileCount,
        supportedFileCount,
        skippedFileCount,
        features,
        tree: buildTree(workspaceName, projectId, features),
      };
    },
  };
}
