export type LocalWorkspaceInputFile = {
  path: string;
  content: string;
  size: number;
  lastModified?: number;
};

export type LocalFeatureTreeMode = "BUSINESS" | "API";

export type LocalModelClassification = {
  profileId: string;
  evidencePolicyVersion: number;
  businessFeature: boolean;
  businessKey: string;
  businessModule: string;
  businessSubmodule: string;
  domain: string;
  group: "BUSINESS_CAPABILITY" | "BACKGROUND_INTEGRATION" | "DATA_INTEGRATION" | "PROJECT_OPERATION" | "API_SERVICE";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  rationale: string;
};

export type LocalFeatureCandidate = {
  id: string;
  name: string;
  displayName?: string;
  kind: "ENDPOINT" | "CODE_SYMBOL" | "COMMAND";
  method: string | null;
  modulePath: string;
  sourcePath: string;
  startLine: number;
  description: string;
  code: string;
  apiDesign?: { protocol: string; method: string; path: string; handler: string | null; source: string };
  implementationBlocks?: Array<{ path: string; symbol: string; startLine: number; relation: "HANDLER" | "CALLS" | "MATCHED_IMPLEMENTATION"; code: string }>;
  modelClassification?: LocalModelClassification;
  evidenceCandidateIds?: string[];
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
  kind: "WORKSPACE" | "MODULE" | "DOMAIN" | "GROUP" | "FEATURE";
  featureId?: string;
  featureCount: number;
  detail?: string;
  badge?: string;
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

export const localWorkspaceScannerVersion = 4;
export const localWorkspaceEvidencePolicyVersion = 2;

export function planLocalWorkspaceCheckpointResume(
  files: Array<{ path: string; size: number; lastModified: number }>,
  checkpointRecords: LocalWorkspaceFileRecord[],
) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const reusableRecords = checkpointRecords.filter((record) => {
    const file = filesByPath.get(record.path);
    return Boolean(file
      && record.scannerVersion === localWorkspaceScannerVersion
      && record.size === file.size
      && record.lastModified === file.lastModified);
  });
  const reusablePaths = new Set(reusableRecords.map((record) => record.path));
  return {
    reusableRecords,
    remainingPaths: files.filter((file) => !reusablePaths.has(file.path)).map((file) => file.path),
    exactMatch: checkpointRecords.length === files.length && reusableRecords.length === files.length,
  };
}

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
  const title = symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return title.replace(/^./, (character) => character.toUpperCase());
}

function isFeatureSupportFile(path: string) {
  return isTestFile(path)
    || /(^|\/)(?:__mocks__|__fixtures__|fixtures?|testdata|samples?)(\/|$)/i.test(path)
    || /\.(?:stories|story)\.[^.]+$/i.test(path);
}

function callableSymbol(symbol: string) {
  return !symbol.startsWith("_") && !/(?:ForTests?|TestOnly)$/i.test(symbol);
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
      displayName: titleFromSymbol(method.name),
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

  const componentRoles = new Set(["RestController", "Controller", "Service", "Repository", "Component"]);
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
    if (!callable || (trivialMethod.test(method.name) && !listener)) continue;
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
  const routePattern = /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*([A-Za-z_$][\w$]*))?/gi;
  for (const match of file.content.matchAll(routePattern)) {
    const method = match[1].toUpperCase();
    const route = match[2];
    const handler = match[3] && !/^(?:async|function)$/i.test(match[3]) ? match[3] : undefined;
    const identity = `${file.path}:endpoint:${method}:${route}`;
    candidates.push({
      id: stableId(identity),
      name: `${method} ${route}`,
      displayName: handler ? titleFromSymbol(handler) : undefined,
      kind: "ENDPOINT",
      method,
      modulePath: modulePath(file.path),
      sourcePath: file.path,
      startLine: lineNumber(file.content, match.index ?? 0),
      description: `Discovered ${method} endpoint ${route} from the selected source tree.`,
      code: excerpt(file.content, match.index ?? 0),
    });
  }

  // Some TypeScript systems expose an RPC registry instead of HTTP-style
  // router calls. The descriptor is API design evidence; the matching handler
  // remains a separate source block that can be linked to the endpoint.
  if (/\bGatewayMethod(?:Descriptor|Spec)/.test(file.content)) {
    const descriptorPattern = /\{\s*name:\s*["'`]([A-Za-z][\w.-]*)["'`]\s*,\s*scope:\s*["'`]([^"'`]+)["'`]/g;
    for (const match of file.content.matchAll(descriptorPattern)) {
      const rpcMethod = match[1];
      const scope = match[2];
      candidates.push({
        id: stableId(`${file.path}:gateway-rpc:${rpcMethod}`),
        name: `RPC ${rpcMethod}`,
        displayName: titleFromSymbol(rpcMethod.replace(/\./g, " ")),
        kind: "ENDPOINT",
        method: "RPC",
        modulePath: modulePath(file.path),
        sourcePath: file.path,
        startLine: lineNumber(file.content, match.index ?? 0),
        description: `Discovered Gateway RPC descriptor ${rpcMethod} with authorization scope ${scope}.`,
        code: excerpt(file.content, match.index ?? 0),
      });
    }
  }
  if (/\bGatewayRequestHandlers\b/.test(file.content)) {
    const gatewayHandlerPattern = /^[\t ]*["'`]([A-Za-z][\w-]*(?:\.[\w-]+)+)["'`]\s*:\s*(?:async\s*)?(?:function\s*)?\(/gm;
    for (const match of file.content.matchAll(gatewayHandlerPattern)) {
      const rpcMethod = match[1];
      candidates.push({
        id: stableId(`${file.path}:gateway-rpc-handler:${rpcMethod}`),
        name: titleFromSymbol(rpcMethod.replace(/\./g, " ")),
        kind: "CODE_SYMBOL",
        method: null,
        modulePath: modulePath(file.path),
        sourcePath: file.path,
        startLine: lineNumber(file.content, match.index ?? 0),
        description: `Discovered Gateway RPC handler ${rpcMethod}.`,
        code: excerpt(file.content, match.index ?? 0),
      });
    }
  }

  const exportPatterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^\n;=]*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  ];
  const exportedSymbols = exportPatterns.flatMap((pattern) => [...file.content.matchAll(pattern)]).sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  for (const match of exportedSymbols) {
    const symbol = match[1];
    if (!callableSymbol(symbol)) continue;
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
      if (["if", "for", "while", "switch", "catch"].includes(symbol) || !callableSymbol(symbol) || (language === "go" && !/^[A-Z]/.test(symbol))) continue;
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
    for (const [method, operationValue] of Object.entries(operations ?? {})) {
      if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method.toLowerCase())) continue;
      const upperMethod = method.toUpperCase();
      const operation = operationValue && typeof operationValue === "object" && !Array.isArray(operationValue) ? operationValue as { summary?: unknown; operationId?: unknown } : {};
      const operationLabel = typeof operation.summary === "string" && operation.summary.trim()
        ? operation.summary.trim()
        : typeof operation.operationId === "string" && operation.operationId.trim() ? titleFromSymbol(operation.operationId.trim()) : undefined;
      const identity = `${file.path}:openapi:${upperMethod}:${route}`;
      result.push({
        id: stableId(identity),
        name: `${upperMethod} ${route}`,
        displayName: operationLabel,
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
  return /(^|\/)(test|tests|__tests__|spec)(\/|\.)|(?:^|[._-])(?:test|spec)(?:[._-](?:helpers?|support|utils?|fixtures?))?\.[^.]+$/i.test(path);
}

const weakAssociationKeys = new Set(["app", "application", "client", "common", "component", "config", "core", "data", "handler", "helper", "index", "main", "model", "route", "routes", "schema", "server", "service", "test", "tests", "type", "types", "util", "utils"]);

function associationKey(value: string) {
  return value.replace(/\.(?:test|spec)$/i, "").replace(/(?:Test|Tests|Spec|Specs)$/i, "").replace(/[^A-Za-z0-9_$-]+/g, "").toLowerCase();
}

function fileStem(path: string) {
  return (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");
}

function testRecord(file: LocalWorkspaceInputFile) {
  const test = { path: file.path, title: file.path.split("/").at(-1) ?? file.path, code: file.content.slice(0, 4_000) };
  const identifiers = file.content.match(/[A-Za-z_$][\w$-]{2,}/g) ?? [];
  const testFileKey = associationKey(fileStem(file.path));
  const symbolKeys = new Set(identifiers.slice(0, 500).map(associationKey).filter((key) => key.length >= 4 && !weakAssociationKeys.has(key)));
  return { ...test, keys: [...(testFileKey.length >= 4 && !weakAssociationKeys.has(testFileKey) ? [`file:${testFileKey}`] : []), ...[...symbolKeys].map((key) => `symbol:${key}`)] };
}

function indexTest(testIndex: Map<string, RelatedTest[]>, test: RelatedTest & { keys: string[] }) {
  for (const key of test.keys) {
    if (!key) continue;
    const records = testIndex.get(key) ?? [];
    if (records.length < 20 && !records.some((record) => record.path === test.path)) records.push(test);
    testIndex.set(key, records);
  }
}

function indexedTests(feature: { sourcePath: string; name: string; displayName?: string; modulePath: string }, testIndex: Map<string, RelatedTest[]>) {
  const sourceName = associationKey(fileStem(feature.sourcePath));
  const featureName = associationKey(feature.displayName ?? feature.name);
  const sourceModule = treeModuleIdentity(feature);
  const sourceMatches = testIndex.get(`file:${sourceName}`) ?? [];
  const symbolWordCount = feature.name.trim().split(/\s+/).filter(Boolean).length;
  const symbolMatches = symbolWordCount >= 2 && featureName.length >= 6 && !weakAssociationKeys.has(featureName) ? testIndex.get(`symbol:${featureName}`) ?? [] : [];
  return [...new Map([...sourceMatches, ...symbolMatches].filter((test) => {
    const testModule = treeModuleIdentity({ sourcePath: test.path, modulePath: modulePath(test.path) });
    return sourceModule === testModule;
  }).map((test) => [test.path, test])).values()].slice(0, 20);
}

function configurationsForFeature(feature: { sourcePath: string }, configurations: Array<{ path: string; key: string; value: string }>) {
  const sourcePath = feature.sourcePath.replace(/\\/g, "/");
  const sourceModule = treeModuleIdentity({ sourcePath, modulePath: modulePath(sourcePath) });
  const sourceDomain = treeDomainIdentity(sourcePath, sourceModule).identity;
  return configurations.filter((configuration) => {
    const configurationPath = configuration.path.replace(/\\/g, "/");
    const configurationModule = treeModuleIdentity({ sourcePath: configurationPath, modulePath: modulePath(configurationPath) });
    if (configurationModule !== sourceModule) return false;
    const configurationDomain = treeDomainIdentity(configurationPath, configurationModule).identity;
    const sameDomain = configurationDomain === sourceDomain;
    const sameDirectory = sourcePath.slice(0, sourcePath.lastIndexOf("/")) === configurationPath.slice(0, configurationPath.lastIndexOf("/"));
    const runtimeModuleConfiguration = /(?:^|\/)(?:application(?:-[^.]+)?\.(?:ya?ml|properties)|\.env\.(?:example|sample|template)|pom\.xml|[^/]+\.gradle(?:\.kts)?)$/i.test(configurationPath);
    return sameDomain || sameDirectory || runtimeModuleConfiguration;
  }).slice(0, 12);
}

function isConfigurationFile(file: LocalWorkspaceInputFile) {
  const type = extension(file.path);
  if (!configurationExtensions.has(type) || /(?:package-lock|pnpm-lock|yarn\.lock)(?:\.[^/]*)?$/i.test(file.path) || isFeatureSupportFile(file.path)) return false;
  const normalized = file.path.replace(/\\/g, "/");
  const name = normalized.split("/").at(-1) ?? normalized;
  if (name === "package.json") return false;
  return type === "env"
    || ["yaml", "yml"].includes(type)
    || ["properties", "gradle", "kts"].includes(type)
    || /^pom\.xml$/i.test(name)
    || /(?:^|\/)(?:config|configs)(?:\/|$)/i.test(normalized)
    || /(?:^|[._-])(?:config|settings|manifest)(?:[._-]|$)/i.test(name)
    || /^application(?:-[^.]+)?\.(?:ya?ml|properties)$/i.test(name);
}

function inferredCandidateDisplayName(feature: { kind: LocalFeatureCandidate["kind"]; description: string; code: string }) {
  if (feature.kind !== "ENDPOINT") return undefined;
  const javaMethod = feature.description.match(/implemented by\s+([A-Za-z_$][\w$]*)/i)?.[1];
  if (javaMethod) return titleFromSymbol(javaMethod);
  const routeHandler = feature.code.match(/["'`]\s*,\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (routeHandler && !/^(?:async|function)$/i.test(routeHandler)) return titleFromSymbol(routeHandler);
  try {
    const document = JSON.parse(feature.code) as Record<string, Record<string, { summary?: unknown; operationId?: unknown }>>;
    const operation = Object.values(document).flatMap((operations) => Object.values(operations ?? {}))[0];
    if (typeof operation?.summary === "string" && operation.summary.trim()) return operation.summary.trim();
    if (typeof operation?.operationId === "string" && operation.operationId.trim()) return titleFromSymbol(operation.operationId.trim());
  } catch {
    // Source excerpts are not expected to be JSON unless the candidate came from OpenAPI.
  }
  return undefined;
}

type FeatureTreeGroup = "API_SERVICE" | "BUSINESS_CAPABILITY" | "DATA_INTEGRATION" | "BACKGROUND_INTEGRATION" | "PROJECT_OPERATION";

function treeModuleIdentity(feature: Pick<LocalFeatureCandidate, "sourcePath" | "modulePath">) {
  const path = feature.sourcePath.replace(/\\/g, "/");
  const segments = path.split("/").filter(Boolean);
  const sourceIndex = segments.indexOf("src");
  if (sourceIndex > 0) return segments.slice(0, sourceIndex).join("/");
  if (["services", "packages", "modules", "apps"].includes(segments[0] ?? "") && segments[1]) return `${segments[0]}/${segments[1]}`;
  if (["src", "app", "lib"].includes(segments[0] ?? "") && segments[1]) return `${segments[0]}/${segments[1]}`;
  return feature.modulePath.split(" · ")[0] || feature.modulePath || "root";
}

function cleanDomainName(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/(?:[-_.](?:routes?|controller|service|handler|helpers?|types?|schema))$/i, "")
    .replace(/^\((.+)\)$/, "$1")
    || "core";
}

function treeDomainLabel(value: string) {
  return titleFromSymbol(value)
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .replace(/\b(?:Api|Ui|Mcp|Cli|Tts|Ime|A2a)\b/g, (acronym) => acronym.toUpperCase());
}

function treeDomainIdentity(sourcePath: string, moduleIdentity: string, modelDomain = "") {
  if (modelDomain.trim()) {
    const identity = cleanDomainName(modelDomain).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "core";
    return { identity, label: treeDomainLabel(cleanDomainName(modelDomain)) };
  }
  const path = sourcePath.replace(/\\/g, "/");
  const segments = path.split("/").filter(Boolean);
  const sourceIndex = segments.indexOf("src");
  const relative = sourceIndex >= 0 ? segments.slice(sourceIndex + 1) : segments.slice(moduleIdentity.split("/").filter(Boolean).length);
  const layer = (relative[0] ?? "").toLowerCase();
  let domain = "core";
  if (layer === "domains") domain = relative[1] ?? "core";
  else if (layer === "routes") domain = (relative[1] ?? "routes").split(/[-_.]/)[0];
  else if (layer === "components") domain = relative[1] && !relative[1].includes(".") ? relative[1] : "shared-ui";
  else if (["app", "games", "plugins", "marketplace"].includes(layer)) domain = relative[1] && !relative[1].includes(".") ? relative[1] : relative[0] ?? "core";
  else if (["infrastructure", "lib"].includes(layer)) domain = relative[1] ?? relative[0] ?? "core";
  else if (["services", "skills", "mcp", "hooks", "stores", "utils", "config", "scripts"].includes(layer)) domain = relative[0] ?? "core";
  else if (relative[0]) domain = relative.length > 1 ? relative[0] : "core";
  const identity = cleanDomainName(domain).toLowerCase();
  return { identity, label: treeDomainLabel(cleanDomainName(domain)) };
}

function treeModuleLabel(identity: string) {
  if (identity === "root") return "Root";
  const segments = identity.split("/").filter(Boolean);
  const name = segments.at(-1) ?? identity;
  if (/^api$/i.test(name)) return "API";
  const title = titleFromSymbol(name).replace(/\b[a-z]/g, (character) => character.toUpperCase());
  if (segments[0] === "services") return `${title} Service`;
  if (segments[0] === "packages") return `${title} Package`;
  if (segments[0] === "apps") return `${title} App`;
  if (segments[0] === "modules") return `${title} Module`;
  return title;
}

function treeGroup(feature: LocalFeatureCandidate): FeatureTreeGroup {
  if (feature.modelClassification) return feature.modelClassification.group;
  if (feature.kind === "ENDPOINT") return "API_SERVICE";
  if (feature.kind === "COMMAND" || /(?:^|\/)(?:scripts?|tools?|cli)(?:\/|$)/i.test(feature.sourcePath)) return "PROJECT_OPERATION";
  const context = `${feature.name} ${feature.description} ${feature.sourcePath}`;
  if (/(?:listener|consumer|subscriber|scheduled|scheduler|cron|batch|worker|queue|kafka|rabbit|jms|event)/i.test(context)) return "BACKGROUND_INTEGRATION";
  if (/(?:repository|\bdao\b|gateway|client|connector|adapter|integration)/i.test(context)) return "DATA_INTEGRATION";
  return "BUSINESS_CAPABILITY";
}

function buildEvidenceTree(workspaceName: string, projectId: string, features: LocalFeatureCandidate[]): LocalFeatureTreeNode {
  const groupOrder: FeatureTreeGroup[] = ["API_SERVICE", "BUSINESS_CAPABILITY", "DATA_INTEGRATION", "BACKGROUND_INTEGRATION", "PROJECT_OPERATION"];
  const modules = new Map<string, LocalFeatureCandidate[]>();
  for (const feature of features) {
    const identity = treeModuleIdentity(feature);
    modules.set(identity, [...(modules.get(identity) ?? []), feature]);
  }
  return {
    id: projectId,
    label: workspaceName,
    kind: "WORKSPACE",
    featureCount: features.length,
    children: [...modules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([moduleIdentity, items]) => {
      const domains = new Map<string, { label: string; items: LocalFeatureCandidate[] }>();
      for (const feature of items) {
        const domain = treeDomainIdentity(feature.sourcePath, moduleIdentity, feature.modelClassification?.domain);
        const current = domains.get(domain.identity) ?? { label: domain.label, items: [] };
        current.items.push(feature);
        domains.set(domain.identity, current);
      }
      return {
        id: `${projectId}:${moduleIdentity}`,
        label: treeModuleLabel(moduleIdentity),
        kind: "MODULE" as const,
        featureCount: items.length,
        detail: moduleIdentity,
        children: [...domains.entries()].sort(([, left], [, right]) => left.label.localeCompare(right.label)).map(([domainIdentity, domain]) => ({
          id: `${projectId}:${moduleIdentity}:domain:${domainIdentity}`,
          label: domain.label,
          kind: "DOMAIN" as const,
          featureCount: domain.items.length,
          detail: domainIdentity,
          children: groupOrder.map((group) => ({
            id: `${projectId}:${moduleIdentity}:domain:${domainIdentity}:${group}`,
            label: group,
            kind: "GROUP" as const,
            featureCount: domain.items.filter((item) => treeGroup(item) === group).length,
            children: domain.items.filter((item) => treeGroup(item) === group).sort((left, right) => (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)).map((feature) => ({
              id: feature.id,
              label: feature.displayName ?? feature.name,
              kind: "FEATURE" as const,
              featureId: feature.id,
              featureCount: 1,
              detail: feature.displayName && feature.displayName !== feature.name ? feature.name : `${feature.sourcePath}:${feature.startLine}`,
              badge: feature.method ?? undefined,
              children: [],
            })),
          })).filter((group) => group.children.length > 0),
        })),
      };
    }),
  };
}

export function localWorkspaceAnalysisForTreeMode(analysis: LocalWorkspaceAnalysis, mode: LocalFeatureTreeMode): LocalWorkspaceAnalysis {
  const classifiedFeatures = analysis.features.filter((feature) => mode === "API"
    ? feature.kind === "ENDPOINT" && feature.modelClassification?.evidencePolicyVersion === localWorkspaceEvidencePolicyVersion
    : isLocalBusinessFeature(feature));
  const features = mode === "BUSINESS" ? mergeAgentBusinessFeatures(classifiedFeatures) : classifiedFeatures;
  return {
    ...analysis,
    features,
    tree: buildAgentFeatureTree(analysis.workspaceName, analysis.projectId, features, mode),
  };
}

export function isLocalBusinessFeature(feature: LocalFeatureCandidate) {
  return feature.kind === "CODE_SYMBOL"
    && feature.modelClassification?.evidencePolicyVersion === localWorkspaceEvidencePolicyVersion
    && feature.modelClassification.businessFeature === true;
}

function buildAgentFeatureTree(workspaceName: string, projectId: string, features: LocalFeatureCandidate[], mode: LocalFeatureTreeMode): LocalFeatureTreeNode {
  const modules = new Map<string, LocalFeatureCandidate[]>();
  for (const feature of features) {
    const classification = feature.modelClassification;
    if (!classification) continue;
    const moduleName = classification.businessModule?.trim() || classification.domain?.trim() || (mode === "API" ? "API services" : "Business capabilities");
    modules.set(moduleName, [...(modules.get(moduleName) ?? []), feature]);
  }
  return {
    id: projectId,
    label: workspaceName,
    kind: "WORKSPACE",
    featureCount: features.length,
    children: [...modules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([moduleName, moduleFeatures]) => {
      const submodules = new Map<string, LocalFeatureCandidate[]>();
      for (const feature of moduleFeatures) {
        const classification = feature.modelClassification;
        if (!classification) continue;
        const submoduleName = classification.businessSubmodule?.trim() || classification.domain?.trim() || (mode === "API" ? "API endpoints" : "Core functions");
        submodules.set(submoduleName, [...(submodules.get(submoduleName) ?? []), feature]);
      }
      return {
        id: `${projectId}:agent-module:${stableId(moduleName)}`,
        label: moduleName,
        kind: "MODULE" as const,
        featureCount: moduleFeatures.length,
        detail: mode === "API" ? "Agent-confirmed API module" : "Agent-confirmed business module",
        children: [...submodules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([submoduleName, submoduleFeatures]) => ({
          id: `${projectId}:agent-module:${stableId(moduleName)}:submodule:${stableId(submoduleName)}`,
          label: submoduleName,
          kind: "DOMAIN" as const,
          featureCount: submoduleFeatures.length,
          detail: mode === "API" ? "Agent-confirmed API submodule" : "Agent-confirmed business submodule",
          children: submoduleFeatures.sort((left, right) => (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)).map((feature) => ({
            id: feature.id,
            label: feature.displayName ?? feature.name,
            kind: "FEATURE" as const,
            featureId: feature.id,
            featureCount: 1,
            detail: feature.description,
            badge: mode === "API" ? feature.method ?? undefined : feature.modelClassification?.confidence,
            children: [],
          })),
        })),
      };
    }),
  };
}

function mergeAgentBusinessFeatures(features: LocalFeatureCandidate[]): LocalFeatureCandidate[] {
  const groups = new Map<string, LocalFeatureCandidate[]>();
  for (const feature of features) {
    const classification = feature.modelClassification;
    if (!classification) continue;
    const identity = [
      classification.businessModule || classification.domain,
      classification.businessSubmodule || classification.domain,
      classification.businessKey || feature.displayName || feature.name,
    ].map((value) => value.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
    groups.set(identity, [...(groups.get(identity) ?? []), feature]);
  }
  const confidenceRank = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
  return [...groups.entries()].map(([identity, items]) => {
    const primary = items[0];
    const classifications = items.map((item) => item.modelClassification).filter((value): value is LocalModelClassification => Boolean(value));
    const confidence = classifications.reduce<LocalModelClassification["confidence"]>((lowest, classification) =>
      confidenceRank[classification.confidence] < confidenceRank[lowest] ? classification.confidence : lowest, classifications[0].confidence);
    const unique = <T,>(values: T[], key: (value: T) => string) => [...new Map(values.map((value) => [key(value), value])).values()];
    return {
      ...primary,
      id: stableId(`agent-business:${identity}`),
      name: primary.displayName ?? primary.name,
      evidenceCandidateIds: items.map((item) => item.id),
      description: [...new Set(items.map((item) => item.description.trim()).filter(Boolean))].join(" "),
      modelClassification: {
        ...classifications[0],
        confidence,
        rationale: [...new Set(classifications.map((classification) => classification.rationale.trim()).filter(Boolean))].join(" "),
      },
      implementationBlocks: unique(items.flatMap((item) => item.implementationBlocks ?? []), (block) => `${block.path}:${block.startLine}:${block.symbol}`),
      configurations: unique(items.flatMap((item) => item.configurations), (configuration) => `${configuration.path}:${configuration.key}`),
      tests: unique(items.flatMap((item) => item.tests), (test) => test.path),
      gaps: unique(items.flatMap((item) => item.gaps), (gap) => `${gap.type}:${gap.ownerRole}`),
    };
  }).sort((left, right) => (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name));
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
  const supportFile = isFeatureSupportFile(file.path);
  const candidates = supportFile ? [] : [
    ...(type === "java" ? discoverJavaCandidates(file) : sourceExtensions.has(type) ? discoverSourceCandidates(file) : []),
    ...discoverOpenApiCandidates(file),
    ...discoverCommands(file),
  ];
  const configuration = isConfigurationFile(file)
    ? { path: file.path, key: file.path.split("/").at(-1) ?? file.path, value: redactConfiguration(file.content.slice(0, 500)) }
    : null;
  return { scannerVersion: localWorkspaceScannerVersion, path: file.path, size: file.size, lastModified: file.lastModified ?? 0, supported: true, candidates, configuration, test: isTestFile(file.path) ? testRecord(file) : null };
}

export function applyLocalModelEnrichment(records: LocalWorkspaceFileRecord[], profileId: string, values: Array<{
  id: string;
  displayName: string;
  description: string;
  businessFeature: boolean;
  businessKey: string;
  businessModule: string;
  businessSubmodule: string;
  domain: string;
  group: LocalModelClassification["group"];
  confidence: LocalModelClassification["confidence"];
  rationale: string;
}>) {
  const enrichments = new Map(values.map((value) => [value.id, value]));
  return records.map((record) => ({
    ...record,
    candidates: record.candidates.map((candidate) => {
      const value = enrichments.get(candidate.id);
      if (!value) return candidate;
      return {
        ...candidate,
        displayName: value.displayName,
        description: value.description,
        modelClassification: {
          profileId,
          evidencePolicyVersion: localWorkspaceEvidencePolicyVersion,
          businessFeature: value.businessFeature,
          businessKey: value.businessKey,
          businessModule: value.businessModule,
          businessSubmodule: value.businessSubmodule,
          domain: value.domain,
          group: value.group,
          confidence: value.confidence,
          rationale: value.rationale,
        },
      };
    }),
  }));
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
    for (const candidate of record.candidates) {
      const legacyTrivialAccessor = candidate.kind === "CODE_SYMBOL" && /^(?:Get|Set|Is)\s+[A-Z0-9_]/.test(candidate.name);
      const legacyConfigurationFactory = candidate.kind === "CODE_SYMBOL" && /Java Configuration capability/i.test(candidate.description);
      if (!legacyTrivialAccessor && !legacyConfigurationFactory) rawCandidates.set(candidate.id, candidate);
    }
    if (record.test) indexTest(testIndex, record.test);
  }
  const configurations = input.records.flatMap((record) => record.configuration ? [record.configuration] : []);
  const candidateValues = [...rawCandidates.values()];
  const features: LocalFeatureCandidate[] = candidateValues.map((feature) => {
    const tests = indexedTests(feature, testIndex);
    const normalizedCode = associationKey(feature.code);
    const gatewayRpcMethod = feature.description.match(/Gateway RPC descriptor\s+([^\s]+)/i)?.[1];
    const implementationMatches = feature.kind === "ENDPOINT" ? candidateValues.filter((candidate) => {
      if (candidate.kind !== "CODE_SYMBOL" || candidate.id === feature.id) return false;
      if (treeModuleIdentity(candidate) !== treeModuleIdentity(feature)) return false;
      if (gatewayRpcMethod) return candidate.description === `Discovered Gateway RPC handler ${gatewayRpcMethod}.`;
      const symbolKey = associationKey(candidate.name);
      const displayKey = associationKey(candidate.displayName ?? candidate.name);
      return (symbolKey.length >= 4 && normalizedCode.includes(symbolKey))
        || (displayKey.length >= 4 && associationKey(feature.displayName ?? "") === displayKey);
    }).slice(0, 8) : [];
    const implementationBlocks = [
      { path: feature.sourcePath, symbol: feature.displayName ?? feature.name, startLine: feature.startLine, relation: "HANDLER" as const, code: feature.code },
      ...implementationMatches.map((candidate) => ({
        path: candidate.sourcePath,
        symbol: candidate.displayName ?? candidate.name,
        startLine: candidate.startLine,
        relation: (normalizedCode.includes(associationKey(candidate.name)) ? "CALLS" : "MATCHED_IMPLEMENTATION") as "CALLS" | "MATCHED_IMPLEMENTATION",
        code: candidate.code,
      })),
    ];
    const endpointIdentity = feature.kind === "ENDPOINT" ? /^(\S+)\s+(.+)$/.exec(feature.name) : null;
    return {
      ...feature,
      displayName: feature.displayName ?? inferredCandidateDisplayName(feature),
      apiDesign: endpointIdentity ? {
        protocol: /Gateway RPC/i.test(feature.description) ? "Gateway RPC" : /JAX-RS/i.test(feature.description) ? "JAX-RS" : /Spring/i.test(feature.description) ? "Spring" : /OpenAPI/i.test(feature.description) ? "OpenAPI" : "HTTP",
        method: endpointIdentity[1],
        path: endpointIdentity[2],
        handler: feature.displayName ?? inferredCandidateDisplayName(feature) ?? null,
        source: feature.sourcePath,
      } : undefined,
      implementationBlocks,
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
    tree: buildEvidenceTree(workspaceName, projectId, features),
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
