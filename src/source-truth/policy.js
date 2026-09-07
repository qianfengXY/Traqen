import { createHash } from "node:crypto";
import { canonicalEncode, pathBytes } from "./identity.js";
import { validateGitRef } from "./git-target.js";
import { requireValue } from "./errors.js";

export function capturePolicy(configuration = {}) {
  const payload = { version: 1, maxEntries: configuration.maxEntries ?? 200000,
    maxFileBytes: String(configuration.maxFileBytes ?? 1024 * 1024 * 1024),
    maxTotalBytes: String(configuration.maxTotalBytes ?? 64 * 1024 * 1024 * 1024),
    maxChunkBytes: configuration.maxChunkBytes ?? 4 * 1024 * 1024,
    maxBatchEntries: configuration.maxBatchEntries ?? 500,
    gitTargets: (configuration.gitTargets ?? []).map(({ origin, allowedAddresses = [] }) => ({ origin, allowedAddresses: [...allowedAddresses].sort() })).sort((a, b) => a.origin < b.origin ? -1 : 1),
    externalRules: ["GIT_LFS_EXTERNAL", "GIT_SUBMODULE_EXTERNAL"], automaticExecution: false };
  requireValue(Number.isSafeInteger(payload.maxEntries) && payload.maxEntries > 0 && payload.maxEntries <= 10000000
    && Number.isSafeInteger(payload.maxChunkBytes) && payload.maxChunkBytes > 0 && payload.maxChunkBytes <= 16 * 1024 * 1024
    && Number.isSafeInteger(payload.maxBatchEntries) && payload.maxBatchEntries > 0 && payload.maxBatchEntries <= 1000
    && /^\d+$/.test(payload.maxFileBytes) && BigInt(payload.maxFileBytes) <= BigInt(Number.MAX_SAFE_INTEGER)
    && /^\d+$/.test(payload.maxTotalBytes) && BigInt(payload.maxTotalBytes) >= BigInt(payload.maxFileBytes),
  "SOURCE_POLICY_INVALID", "平台采集资源限制无效", { status: 503 });
  const id = createHash("sha256").update(canonicalEncode({ domain: "source-truth-capture-policy", version: 1, payload })).digest("hex");
  return Object.freeze({ id, ...payload });
}

export function sourceInput(input, policy) {
  requireValue(input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).every((key) => ["sources", "baselineBundleId"].includes(key)), "SOURCE_INVALID_INPUT", "来源表单不能更改平台安全、分类或排除规则", { status: 400 });
  const baselineBundleId = input.baselineBundleId ?? null;
  requireValue(baselineBundleId === null || /^[a-f0-9]{64}$/.test(baselineBundleId), "SOURCE_INVALID_INPUT", "基线版本定位符无效", { status: 400 });
  requireValue(Array.isArray(input.sources) && input.sources.length >= 1 && input.sources.length <= 2,
    "SOURCE_INVALID_INPUT", "请选择 Git、目录或各一个；至少需要一种来源", { status: 400 });
  const kinds = new Set();
  const ids = new Set();
  const sources = input.sources.map((input) => {
    requireValue(input && ["GIT", "DIRECTORY_UPLOAD"].includes(input.kind) && !kinds.has(input.kind)
      && typeof input.sourceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input.sourceId) && !ids.has(input.sourceId),
    "SOURCE_INVALID_INPUT", "来源类型或登记 ID 无效，每种类型最多一个且不能合并路径", { status: 400 });
    kinds.add(input.kind); ids.add(input.sourceId);
    const mode = input.mode ?? "UPDATE";
    requireValue(["UPDATE", "REUSE"].includes(mode), "SOURCE_INVALID_INPUT", "请选择更新或沿用组件", { status: 400 });
    const label = input.label ?? (input.kind === "GIT" ? "Git 来源" : "上传目录");
    requireValue(typeof label === "string" && label.length > 0 && label.length <= 200 && label.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(label), "SOURCE_INVALID_INPUT", "来源名称无效", { status: 400 });
    if (mode === "REUSE") {
      requireValue(baselineBundleId && /^[a-f0-9]{64}$/.test(input.componentId), "SOURCE_INVALID_INPUT", "沿用必须指定已冻结基线中的精确组件", { status: 400 });
      return { kind: input.kind, sourceId: input.sourceId, mode, componentId: input.componentId, label };
    }
    if (input.kind === "DIRECTORY_UPLOAD") return { kind: input.kind, sourceId: input.sourceId, mode, componentId: null, label, scope: { kind: "UPLOADED_DIRECTORY" } };
    let url;
    try { url = new URL(input.url); } catch { /* rejected below */ }
    requireValue(typeof input.url === "string" && input.url.length <= 2048 && !/[\u0000-\u0020\u007f\\]/.test(input.url)
      && url?.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && policy.gitTargets.some((target) => target.origin === url.origin), "SOURCE_GIT_TARGET_BLOCKED", "需要平台授权的 HTTPS Git 地址；不要在地址中粘贴凭据", { status: 400 });
    const root = input.root ?? input.scope?.root ?? null;
    if (root !== null) pathBytes(root);
    requireValue(input.credentialRef === undefined || input.credentialRef === null || /^[A-Za-z0-9_-]{1,128}$/.test(input.credentialRef), "SOURCE_INVALID_INPUT", "只读连接引用无效", { status: 400 });
    return { kind: input.kind, sourceId: input.sourceId, mode, componentId: null, label,
      url: url.href, ref: validateGitRef(input.ref), credentialRef: input.credentialRef ?? null, scope: { kind: "GIT_TREE", root } };
  }).sort((a, b) => a.kind === b.kind ? 0 : a.kind === "GIT" ? -1 : 1);
  return { sources, baselineBundleId };
}
