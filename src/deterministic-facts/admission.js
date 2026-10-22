import { F002Error, requireF002 } from "./errors.js";
import { createScopeId, normalizeScope } from "./identity.js";
import { decodePathBytes } from "../source-truth/identity.js";

function sealedReference(reference) {
  requireF002(reference && typeof reference === "object"
    && /^[a-f0-9]{64}$/.test(reference.bundleId ?? "")
    && typeof reference.receiptId === "string" && reference.receiptId.length > 0,
  "F002_SOURCE_REFERENCE_INVALID", "技术证据只能选择精确的冻结 Bundle 与 Receipt", { status: 422 });
  return { bundleId: reference.bundleId, receiptId: reference.receiptId };
}

function readReference(runId, sourceInput) {
  requireF002(sourceInput && typeof sourceInput === "object"
    && /^[a-f0-9]{64}$/.test(sourceInput.sourceBundleSnapshotId ?? "")
    && typeof sourceInput.receiptId === "string",
  "F002_ADMISSION_CORRUPT", "已持久的来源准入绑定不完整", { status: 409 });
  return {
    analysisRunId: runId,
    bundleId: sourceInput.sourceBundleSnapshotId,
    receiptId: sourceInput.receiptId,
  };
}

function sameOperation(existing, workspaceId, reference, request) {
  requireF002(existing.sourceInput?.bundleId === reference.bundleId && existing.sourceInput?.receiptId === reference.receiptId
    && existing.profileId === request.profile?.id && Array.isArray(request.scopes),
  "F002_OPERATION_CONFLICT", "操作键已绑定不同的来源、配置或范围", { status: 409 });
  let requested;
  try {
    requested = request.scopes.map((scope) => {
      const selections = normalizeScope(scope?.selections);
      return { label: scope?.label ?? null, scopeId: createScopeId({ workspaceId, bundleId: reference.bundleId, profileId: request.profile.id, selections }), selections };
    }).sort((left, right) => Buffer.compare(Buffer.from(left.scopeId, "ascii"), Buffer.from(right.scopeId, "ascii")));
  } catch {
    throw new F002Error("F002_OPERATION_CONFLICT", "操作键已绑定不同的来源、配置或范围", { status: 409 });
  }
  requireF002(requested.length === existing.scopes.length && requested.every((scope, index) => {
    const persisted = existing.scopes[index];
    return scope.scopeId === persisted.scopeId && scope.label === persisted.label
      && JSON.stringify(scope.selections) === JSON.stringify(persisted.selections);
  }), "F002_OPERATION_CONFLICT", "操作键已绑定不同的来源、配置或范围", { status: 409 });
}

// This service is the only entry that creates a new F002 source binding. It
// intentionally accepts a sealed F001 reference, never a caller-provided
// qualifiedAt/sourceInput object; F001 owns qualification and its clock.
export class F002AdmissionService {
  constructor(repository, sourceAdmission) {
    requireF002(repository && typeof repository.createAdmittedRun === "function" && typeof repository.findRunByOperation === "function" && typeof repository.sourceBinding === "function",
      "F002_REPOSITORY_REQUIRED", "F002 准入需要持久化仓库", { status: 503 });
    requireF002(sourceAdmission && typeof sourceAdmission.qualify === "function" && typeof sourceAdmission.forAdmittedAnalysis === "function",
      "F002_SOURCE_ADMISSION_REQUIRED", "F002 准入需要 F001 受控来源服务", { status: 503 });
    this.repository = repository;
    this.sourceAdmission = sourceAdmission;
    this.admitted = sourceAdmission.forAdmittedAnalysis((actor, workspaceId, analysisRunId, tx) =>
      this.repository.sourceBinding(workspaceId, analysisRunId, tx));
  }

  async start(actor, workspaceId, request) {
    requireF002(request && typeof request === "object", "F002_RUN_INPUT_INVALID", "生成技术证据请求无效", { status: 422 });
    requireF002(!Object.hasOwn(request, "sourceInput") && !Object.hasOwn(request, "qualifiedAt"),
      "F002_SOURCE_INPUT_FORBIDDEN", "客户端不得提交来源准入结果或准入时间", { status: 422 });
    const reference = sealedReference(request.reference);
    const existing = await this.repository.findRunByOperation(actor, workspaceId, request.operationId);
    if (existing) {
      sameOperation(existing, workspaceId, reference, request);
      await this.inventory(actor, workspaceId, existing.id, { limit: 1 });
      return existing;
    }
    const sourceInput = await this.sourceAdmission.qualify(actor, workspaceId, reference);
    await this.#assertScopesInInventory(actor, workspaceId, reference, sourceInput, request.scopes);
    return this.repository.createAdmittedRun(actor, workspaceId, {
      operationId: request.operationId,
      sourceInput,
      profile: request.profile,
      scopes: request.scopes,
    });
  }

  async inventory(actor, workspaceId, runId, options) {
    return this.admitted.inventory(actor, workspaceId, await this.#reference(workspaceId, runId), options);
  }

  async inheritedGaps(actor, workspaceId, runId, options) {
    return this.admitted.inheritedGaps(actor, workspaceId, await this.#reference(workspaceId, runId), options);
  }

  async *readFile(actor, workspaceId, runId, locator) {
    yield* this.admitted.readFile(actor, workspaceId, await this.#reference(workspaceId, runId), locator);
  }

  async readMaterial(actor, workspaceId, runId, locator, options) {
    return this.admitted.readMaterial(actor, workspaceId, await this.#reference(workspaceId, runId), locator, options);
  }

  async #reference(workspaceId, runId) {
    requireF002(typeof runId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(runId), "F002_RUN_REFERENCE_INVALID", "分析运行引用无效", { status: 422 });
    const binding = await this.repository.sourceBinding(workspaceId, runId);
    requireF002(binding, "F002_RUN_NOT_FOUND", "分析运行不存在", { status: 404 });
    return readReference(runId, binding.sourceInput);
  }

  async #assertScopesInInventory(actor, workspaceId, reference, sourceInput, scopes) {
    requireF002(Array.isArray(scopes) && scopes.length > 0, "F002_SCOPE_OUT_OF_INVENTORY", "范围必须来自冻结材料清单", { status: 422 });
    const entries = new Map();
    const components = new Set((sourceInput.components ?? []).map((component) => component.componentSnapshotId));
    let cursor = null;
    const seenCursors = new Set();
    do {
      const page = await this.sourceAdmission.inventory(actor, workspaceId, reference, { limit: 1000, cursor });
      for (const item of page.items) entries.set(`${item.componentId}\u0000${item.entry.pathBytes}`, Buffer.from(item.entry.pathBytes, "base64url"));
      cursor = page.nextCursor;
      requireF002(!cursor || !seenCursors.has(cursor), "F002_SCOPE_OUT_OF_INVENTORY", "冻结材料清单分页异常", { status: 409 });
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    const belongs = (componentId, pathBytes) => entries.has(`${componentId}\u0000${pathBytes}`);
    for (const scope of scopes) for (const selection of scope?.selections ?? []) {
      const candidates = [...entries.entries()].filter(([key]) => key.startsWith(`${selection?.componentId}\u0000`));
      requireF002(components.has(selection?.componentId), "F002_SCOPE_OUT_OF_INVENTORY", "范围组件不属于冻结材料清单", { status: 422 });
      if (selection.kind === "COMPONENT") continue;
      let selected;
      try { selected = decodePathBytes(selection.pathBytes); } catch { throw new F002Error("F002_SCOPE_OUT_OF_INVENTORY", "范围路径不是冻结材料清单中的原始路径", { status: 422 }); }
      if (selection.kind === "ENTRY") requireF002(belongs(selection.componentId, selection.pathBytes), "F002_SCOPE_OUT_OF_INVENTORY", "范围条目不属于冻结材料清单", { status: 422 });
      else if (selection.kind === "DIRECTORY") {
        const hasDescendant = candidates.some(([, path]) => path.equals(selected)
          || (path.length > selected.length && path.subarray(0, selected.length).equals(selected) && path[selected.length] === 47));
        requireF002(hasDescendant, "F002_SCOPE_OUT_OF_INVENTORY", "范围目录不属于冻结材料清单", { status: 422 });
      }
    }
  }
}

export { F002Error };
