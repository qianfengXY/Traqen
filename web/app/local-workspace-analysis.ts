export type LocalWorkspaceInputFile = {
  path: string;
  content: string;
  size: number;
  lastModified?: number;
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

export type LocalWorkspaceFileRecord = {
  scannerVersion: number;
  path: string;
  size: number;
  lastModified: number;
  supported: boolean;
  candidates: Array<Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">>;
  configuration: { path: string; key: string; value: string } | null;
  test: ({ path: string; title: string; code: string } & { keys: string[] }) | null;
};

export const localWorkspaceScannerVersion = 2;

const supportedExtensions = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "go", "cs", "rs", "vue", "json", "md", "yaml", "yml", "sql", "properties", "env", "xml", "gradle", "kts",
]);
const ignoredSegments = new Set([".git", "node_modules", "dist", "build", "target", "out", ".gradle", ".next", ".vinext", "coverage", "vendor"]);
const sourceExtensions = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "go", "cs", "rs", "vue"]);
const configurationExtensions = new Set(["json", "yaml", "yml", "properties", "env", "xml", "gradle", "kts"]);
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

type RawFeatureCandidate = Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">;
type JavaAnnotation = { name: string; arguments: string; start: number; end: number };
type JavaMethod = { name: string; offset: number; declaration: string; visibility: "public" | "protected" | "private" | "package" };
type JavaClass = { name: string; kind: "class" | "interface" | "record"; offset: number; annotations: JavaAnnotation[] };

function javaAnnotations(content: string) {
  const annotations: JavaAnnotation[] = [];
  const pattern = /@(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)/g;
  for (const match of content.matchAll(pattern)) {
    let end = (match.index ?? 0) + match[0].length;
    while (/\s/.test(content[end] ?? "")) end += 1;
    let argumentsText = "";
    if (content[end] === "(") {
      const argumentStart = end + 1;
      let depth = 1;
      let quote = "";
      for (end += 1; end < content.length && depth > 0; end += 1) {
        const character = content[end];
        if (quote) {
          if (character === "\\") end += 1;
          else if (character === quote) quote = "";
        } else if (character === "\"" || character === "'") quote = character;
        else if (character === "(") depth += 1;
        else if (character === ")") depth -= 1;
      }
      argumentsText = content.slice(argumentStart, Math.max(argumentStart, end - 1));
    }
    annotations.push({ name: match[1], arguments: argumentsText, start: match.index ?? 0, end });
  }
  return annotations;
}

function javaMethods(content: string) {
  const methods: JavaMethod[] = [];
  const declarationPattern = /^[\t ]*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>{};\n]+>\s+)?(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?(?:\s*<[^;{}()]*>)?(?:\s*\[\s*\])?\s+)+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^;{]+)?\s*(?:\{|;)/gm;
  for (const match of content.matchAll(declarationPattern)) {
    const declaration = match[0];
    const visibility = /\bpublic\b/.test(declaration) ? "public" : /\bprotected\b/.test(declaration) ? "protected" : /\bprivate\b/.test(declaration) ? "private" : "package";
    methods.push({ name: match[1], offset: match.index ?? 0, declaration, visibility });
  }
  return methods;
}

function nextJavaDeclaration(annotation: JavaAnnotation, methods: JavaMethod[], classes: Array<Omit<JavaClass, "annotations">>) {
  const method = methods.find((item) => item.offset >= annotation.end && item.offset - annotation.end < 2_500);
  const javaClass = classes.find((item) => item.offset >= annotation.end && item.offset - annotation.end < 2_500);
  if (javaClass && (!method || javaClass.offset < method.offset)) return { kind: "class" as const, value: javaClass };
  return method ? { kind: "method" as const, value: method } : null;
}

function annotationPaths(argumentsText: string) {
  if (!argumentsText.trim()) return [""];
  const pathAssignment = argumentsText.match(/(?:^|,)\s*(?:value|path)\s*=\s*(\{[\s\S]*?\}|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
  const positionalPath = /^\s*(?:["']|\{)/.test(argumentsText) ? argumentsText.split(/,(?=\s*[A-Za-z_$][\w$]*\s*=)/, 1)[0] : "";
  const pathSource = pathAssignment?.[1] ?? positionalPath;
  if (!pathSource) return [""];
  const values = [...pathSource.matchAll(/["']((?:\\.|[^"'\\])*)["']/g)].map((match) => match[1]);
  return values.length > 0 ? values : [""];
}

function endpointPath(base: string, child: string) {
  const joined = `${base.replace(/\/$/, "")}/${child.replace(/^\//, "")}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return joined === "" ? "/" : joined.startsWith("/") ? joined : `/${joined}`;
}

function javaModulePath(file: LocalWorkspaceInputFile) {
  const normalized = file.path.replace(/\\/g, "/");
  const sourceRoot = normalized.indexOf("/src/");
  const projectModule = sourceRoot > 0 ? normalized.slice(0, sourceRoot).split("/").at(-1) ?? "" : "";
  const packageName = file.content.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1] ?? "";
  const packageParts = packageName.split(".").filter(Boolean);
  if (/^(?:controller|resource|service|repository|handler|usecase|facade|manager|client|gateway|consumer|listener|job|scheduler|config|model|entity|dto)$/i.test(packageParts.at(-1) ?? "")) packageParts.pop();
  const packageModule = packageParts.slice(0, 5).join(".");
  return [projectModule, packageModule].filter(Boolean).join(" · ") || modulePath(file.path);
}

function discoverJavaCandidates(file: LocalWorkspaceInputFile) {
  const content = file.content;
  const annotations = javaAnnotations(content);
  const methods = javaMethods(content);
  const rawClasses = [...content.matchAll(/\b(class|interface|record)\s+([A-Za-z_$][\w$]*)/g)].map((match) => ({
    name: match[2],
    kind: match[1] as "class" | "interface" | "record",
    offset: match.index ?? 0,
  }));
  const classAnnotations = new Map<number, JavaAnnotation[]>();
  const methodAnnotations = new Map<number, JavaAnnotation[]>();
  for (const annotation of annotations) {
    const declaration = nextJavaDeclaration(annotation, methods, rawClasses);
    if (!declaration) continue;
    const target = declaration.kind === "class" ? classAnnotations : methodAnnotations;
    const offset = declaration.value.offset;
    target.set(offset, [...(target.get(offset) ?? []), annotation]);
  }
  const classes: JavaClass[] = rawClasses.map((javaClass) => ({ ...javaClass, annotations: classAnnotations.get(javaClass.offset) ?? [] }));
  const javaModule = javaModulePath(file);
  const candidates: RawFeatureCandidate[] = [];
  const endpointMethodOffsets = new Set<number>();
  const classForMethod = (method: JavaMethod) => [...classes].reverse().find((javaClass) => javaClass.offset < method.offset);
  const addEndpoint = (method: JavaMethod, protocol: string, httpMethod: string, path: string, annotation: JavaAnnotation) => {
    const identity = `${file.path}:${protocol}:${httpMethod}:${path}:${method.name}:${method.offset}`;
    candidates.push({
      id: stableId(identity),
      name: `${httpMethod} ${path}`,
      kind: "ENDPOINT",
      method: httpMethod,
      modulePath: javaModule,
      sourcePath: file.path,
      startLine: lineNumber(content, annotation.start),
      description: `Discovered Java ${protocol} endpoint ${httpMethod} ${path}, implemented by ${method.name}.`,
      code: excerpt(content, annotation.start),
    });
    endpointMethodOffsets.add(method.offset);
  };

  const springMethods: Record<string, string[]> = {
    GetMapping: ["GET"], PostMapping: ["POST"], PutMapping: ["PUT"], PatchMapping: ["PATCH"], DeleteMapping: ["DELETE"],
  };
  for (const method of methods) {
    const javaClass = classForMethod(method);
    const attached = methodAnnotations.get(method.offset) ?? [];
    const baseMappings = javaClass?.annotations.filter((annotation) => annotation.name === "RequestMapping") ?? [];
    const basePaths = baseMappings.flatMap((annotation) => annotationPaths(annotation.arguments));
    const effectiveBases = basePaths.length > 0 ? basePaths : [""];
    for (const annotation of attached.filter((item) => item.name in springMethods || item.name === "RequestMapping")) {
      const verbs = springMethods[annotation.name] ?? [...annotation.arguments.matchAll(/RequestMethod\s*\.\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)/g)].map((match) => match[1]);
      for (const verb of verbs.length > 0 ? verbs : ["REQUEST"]) {
        for (const base of effectiveBases) for (const child of annotationPaths(annotation.arguments)) addEndpoint(method, "Spring", verb, endpointPath(base, child), annotation);
      }
    }

    const jaxVerbAnnotations = attached.filter((annotation) => ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(annotation.name));
    if (jaxVerbAnnotations.length > 0) {
      const classPaths = javaClass?.annotations.filter((annotation) => annotation.name === "Path").flatMap((annotation) => annotationPaths(annotation.arguments)) ?? [];
      const methodPaths = attached.filter((annotation) => annotation.name === "Path").flatMap((annotation) => annotationPaths(annotation.arguments));
      for (const annotation of jaxVerbAnnotations) {
        for (const base of classPaths.length > 0 ? classPaths : [""]) for (const child of methodPaths.length > 0 ? methodPaths : [""]) addEndpoint(method, "JAX-RS", annotation.name, endpointPath(base, child), annotation);
      }
    }
  }

  const componentRoles = new Set(["RestController", "Controller", "Service", "Repository", "Component", "Configuration"]);
  const listenerRoles = new Set(["Scheduled", "KafkaListener", "RabbitListener", "EventListener", "JmsListener"]);
  const trivialMethod = /^(?:get|set|is)[A-Z_]|^(?:equals|hashCode|toString|canEqual)$/;
  for (const method of methods) {
    if (endpointMethodOffsets.has(method.offset) || method.visibility === "private") continue;
    const javaClass = classForMethod(method);
    const attached = methodAnnotations.get(method.offset) ?? [];
    const component = javaClass?.annotations.find((annotation) => componentRoles.has(annotation.name));
    const listener = attached.find((annotation) => listenerRoles.has(annotation.name));
    const pathRole = /(?:^|\/)(?:controller|resource|service|repository|handler|usecase|facade|manager|client|gateway|consumer|listener|job|scheduler)(?:\/|$)/i.test(file.path);
    const callable = method.visibility === "public" || method.visibility === "protected" || javaClass?.kind === "interface" || Boolean(component) || pathRole || Boolean(listener);
    if (!callable || (trivialMethod.test(method.name) && !component && !pathRole)) continue;
    const role = listener?.name ?? component?.name ?? (javaClass?.kind === "interface" ? "interface" : "backend");
    const identity = `${file.path}:java:${role}:${method.name}:${method.offset}`;
    candidates.push({
      id: stableId(identity),
      name: listener ? `${titleFromSymbol(listener.name)} · ${titleFromSymbol(method.name)}` : titleFromSymbol(method.name),
      kind: "CODE_SYMBOL",
      method: null,
      modulePath: javaModule,
      sourcePath: file.path,
      startLine: lineNumber(content, listener?.start ?? method.offset),
      description: `Discovered Java ${role} capability ${method.name}.`,
      code: excerpt(content, listener?.start ?? method.offset),
    });
  }
  return candidates;
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
  if (language === "cs") {
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

function testRecord(file: LocalWorkspaceInputFile) {
  const test = { path: file.path, title: file.path.split("/").at(-1) ?? file.path, code: file.content.slice(0, 4_000) };
  const identifiers = file.content.match(/[A-Za-z_$][\w$-]{2,}/g) ?? [];
  const keys = new Set([file.path.split("/").at(-1)?.replace(/\.[^.]+$/, "").toLowerCase() ?? "", ...identifiers.slice(0, 300).map((item) => item.toLowerCase())]);
  return { ...test, keys: [...keys].filter(Boolean) };
}

function indexTest(testIndex: Map<string, RelatedTest[]>, test: RelatedTest & { keys: string[] }) {
  for (const key of test.keys) {
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

function configurationsForFeature(feature: { sourcePath: string }, configurations: Array<{ path: string; key: string; value: string }>) {
  const sourceModule = modulePath(feature.sourcePath);
  return configurations.filter((configuration) => {
    const segments = configuration.path.split("/").filter(Boolean);
    const globalConfiguration = segments.length === 1
      || ["config", "configs"].includes(segments[0]?.toLowerCase() ?? "")
      || (segments[0]?.toLowerCase() === "src" && ["config", "configs"].includes(segments[1]?.toLowerCase() ?? ""));
    return globalConfiguration || modulePath(configuration.path) === sourceModule;
  }).slice(0, 12);
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

export function scanLocalWorkspaceFile(file: LocalWorkspaceInputFile): LocalWorkspaceFileRecord {
  const supported = eligible(file) && file.size <= maxFileBytes;
  if (!supported) return { scannerVersion: localWorkspaceScannerVersion, path: file.path, size: file.size, lastModified: file.lastModified ?? 0, supported: false, candidates: [], configuration: null, test: null };
  const type = extension(file.path);
  const candidates = [
    ...(type === "java" ? discoverJavaCandidates(file) : sourceExtensions.has(type) ? discoverSourceCandidates(file) : []),
    ...discoverOpenApiCandidates(file),
    ...discoverCommands(file),
  ];
  const configuration = configurationExtensions.has(type) && !file.path.endsWith("package-lock.json")
    ? { path: file.path, key: file.path.split("/").at(-1) ?? file.path, value: redactConfiguration(file.content.slice(0, 500)) }
    : null;
  return { scannerVersion: localWorkspaceScannerVersion, path: file.path, size: file.size, lastModified: file.lastModified ?? 0, supported: true, candidates, configuration, test: isTestFile(file.path) ? testRecord(file) : null };
}

export function analyzeLocalWorkspaceRecords(input: { workspaceName: string; projectId: string; records: LocalWorkspaceFileRecord[]; now?: Date }): LocalWorkspaceAnalysis {
  const workspaceName = input.workspaceName.trim();
  const projectId = input.projectId.trim();
  if (!workspaceName) throw new TypeError("Workspace name is required");
  if (!projectId) throw new TypeError("Project ID is required");
  if (input.records.length === 0) throw new TypeError("Select a source directory first");
  const rawCandidates = new Map<string, Omit<LocalFeatureCandidate, "configurations" | "tests" | "dimensions" | "gaps">>();
  const testIndex = new Map<string, RelatedTest[]>();
  for (const record of input.records) {
    for (const candidate of record.candidates) rawCandidates.set(candidate.id, candidate);
    if (record.test) indexTest(testIndex, record.test);
  }
  const configurations = input.records.flatMap((record) => record.configuration ? [record.configuration] : []);
  const features: LocalFeatureCandidate[] = [...rawCandidates.values()].map((feature) => {
    const tests = indexedTests(feature, testIndex);
    return {
      ...feature,
      configurations: configurationsForFeature(feature, configurations),
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
    fileCount: input.records.length,
    supportedFileCount: input.records.filter((record) => record.supported).length,
    skippedFileCount: input.records.filter((record) => !record.supported).length,
    features,
    tree: buildTree(workspaceName, projectId, features),
  };
}

export function createLocalWorkspaceAnalysisAccumulator(input: { workspaceName: string; projectId: string; now?: Date }) {
  const records: LocalWorkspaceFileRecord[] = [];
  return {
    addFiles(files: LocalWorkspaceInputFile[]) {
      records.push(...files.map(scanLocalWorkspaceFile));
    },
    finish(): LocalWorkspaceAnalysis {
      return analyzeLocalWorkspaceRecords({ workspaceName: input.workspaceName, projectId: input.projectId, records, now: input.now });
    },
    records() { return records; },
  };
}
