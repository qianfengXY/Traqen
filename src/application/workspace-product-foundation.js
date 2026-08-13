import {
  commitChildBatchResult,
  createAnalysisBatch,
  createCapabilityTemplateRevision,
  createProjectCapabilityRevision,
  createWorkspace,
  createWorkspaceCapabilityDraftRevision,
  createWorkspacePolicyRevision,
  createWorkspaceCapabilityConfig,
  createWorkspaceLifecycleEvent,
  createWorkspaceViewPreference,
  evolveWorkspace,
  fanOutAnalysisBatch,
  issueScopedSecretGrants,
  openAnalysisBatchBarrier,
  activateWorkspaceCapabilityDraft,
  resolveWorkspaceCapabilityCatalog,
  resolveWorkspaceExecutionProfile,
  validateWorkspaceCapabilityDraft,
} from "../domain/index.js";

export class WorkspaceProductFoundation {
  constructor({ store, clock = () => new Date() }) {
    if (!store) throw new TypeError("store is required");
    this.store = store;
    this.clock = clock;
  }

  async #events(workspaceId) {
    return [...(await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_EVENT"))]
      .sort((left, right) => left.version - right.version);
  }

  async getWorkspace(workspaceId, userId = null) {
    const foundation = await this.store.getProjectFoundation(workspaceId);
    if (!foundation) return null;
    const events = await this.#events(workspaceId);
    const createdEvent = events.find(({ type }) => type === "WORKSPACE_CREATED");
    let workspace = createWorkspace({
      id: foundation.project.id,
      tenantId: foundation.tenant.id,
      name: foundation.project.name,
    }, () => new Date(createdEvent?.occurredAt ?? foundation.project.createdAt ?? "1970-01-01T00:00:00.000Z"));
    for (const event of events) {
      if (event.type !== "WORKSPACE_CREATED") workspace = evolveWorkspace(workspace, event);
    }
    let hidden = false;
    if (userId) {
      const preferences = (await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_VIEW_PREFERENCE"))
        .filter((record) => record.userId === userId)
        .sort((left, right) => right.version - left.version);
      hidden = preferences[0]?.hidden === true;
    }
    return Object.freeze({ ...workspace, hidden });
  }

  async listWorkspaces(userId = null, { includeDeleted = false } = {}) {
    const workspaces = [];
    for (const foundation of await this.store.listProjectFoundations()) {
      const workspace = await this.getWorkspace(foundation.project.id, userId);
      if (workspace && (includeDeleted || workspace.lifecycleState !== "DELETED")) workspaces.push(workspace);
    }
    return Object.freeze(workspaces.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
  }

  async recordWorkspaceCreated(workspaceId, actorId = "SYSTEM") {
    const existing = await this.#events(workspaceId);
    if (existing.length > 0) return existing[0];
    const event = createWorkspaceLifecycleEvent({
      workspaceId,
      type: "WORKSPACE_CREATED",
      version: 1,
      actorId,
      payload: {},
    }, this.clock);
    return this.store.appendUnderstandingRecord(workspaceId, "WORKSPACE_EVENT", event);
  }

  async transitionWorkspace(workspaceId, type, actorId, payload = {}) {
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) return null;
    const event = createWorkspaceLifecycleEvent({
      workspaceId,
      type,
      version: workspace.lifecycleVersion + 1,
      actorId,
      payload,
    }, this.clock);
    evolveWorkspace(workspace, event);
    await this.store.appendUnderstandingRecord(workspaceId, "WORKSPACE_EVENT", event);
    return this.getWorkspace(workspaceId);
  }

  async setWorkspaceVisibility(workspaceId, userId, hidden) {
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) return null;
    const prior = (await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_VIEW_PREFERENCE"))
      .filter((record) => record.userId === userId)
      .sort((left, right) => right.version - left.version)[0];
    const preference = createWorkspaceViewPreference({
      workspaceId,
      userId,
      hidden,
      version: (prior?.version ?? 0) + 1,
    }, this.clock);
    await this.store.appendUnderstandingRecord(workspaceId, "WORKSPACE_VIEW_PREFERENCE", preference);
    return preference;
  }

  async registerCapabilityTemplate(input) {
    const template = createCapabilityTemplateRevision(input, this.clock);
    return this.store.appendCapabilityTemplateRevision(template);
  }

  async listCapabilityTemplates() {
    return this.store.listCapabilityTemplateRevisions();
  }

  async listBuiltinCapabilities() {
    const latest = new Map();
    for (const entry of await this.store.listCapabilityTemplateRevisions()) {
      if (!['SKILL', 'MCP'].includes(entry.kind)) continue;
      const normalizedName = entry.logicalName.trim().toLowerCase();
      const key = `${entry.kind}\u0000${normalizedName}`;
      if (!latest.has(key)) latest.set(key, Object.freeze({ ...entry, normalizedName, source: 'BUILTIN' }));
    }
    return Object.freeze([...latest.values()]);
  }

  async listProjectCapabilities(workspaceId, { includeDeleted = false } = {}) {
    if (!await this.getWorkspace(workspaceId)) return null;
    const latest = new Map();
    for (const entry of await this.store.listUnderstandingRecords(workspaceId, 'PROJECT_CAPABILITY_REVISION')) {
      const key = `${entry.kind}\u0000${entry.normalizedName}`;
      const prior = latest.get(key);
      if (!prior || entry.revision > prior.revision) latest.set(key, entry);
    }
    return Object.freeze([...latest.values()].filter((entry) => includeDeleted || !entry.deleted)
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.normalizedName.localeCompare(right.normalizedName)));
  }

  async saveProjectCapability(workspaceId, input) {
    if (!await this.getWorkspace(workspaceId)) return null;
    const existing = await this.listProjectCapabilities(workspaceId, { includeDeleted: true });
    const normalizedName = String(input.normalizedName ?? input.name ?? input.logicalName ?? '').trim().toLowerCase();
    const kind = String(input.kind ?? '').toUpperCase();
    const prior = existing.find((entry) => entry.kind === kind && entry.normalizedName === normalizedName);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new TypeError('expectedVersion is required');
    if (input.expectedVersion !== (prior?.revision ?? 0)) throw new TypeError(`Project capability version conflict: expected ${input.expectedVersion}, current ${prior?.revision ?? 0}`);
    const capability = createProjectCapabilityRevision({ ...input, workspaceId, kind, normalizedName, revision: (prior?.revision ?? 0) + 1 }, this.clock);
    return this.store.appendUnderstandingRecordWithCas(workspaceId, 'PROJECT_CAPABILITY_REVISION', capability, {
      headKey: `PROJECT_CAPABILITY_REVISION:${kind}:${normalizedName}`,
      expectedVersion: input.expectedVersion,
    });
  }

  async deleteProjectCapability(workspaceId, kind, normalizedName, expectedVersion) {
    const existing = await this.listProjectCapabilities(workspaceId, { includeDeleted: true });
    if (!existing) return null;
    const prior = existing.find((entry) => entry.kind === String(kind).toUpperCase() && entry.normalizedName === String(normalizedName).trim().toLowerCase());
    if (!prior || prior.deleted) return null;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TypeError('expectedVersion is required');
    if (expectedVersion !== prior.revision) throw new TypeError(`Project capability version conflict: expected ${expectedVersion}, current ${prior.revision}`);
    const tombstone = Object.freeze({
      ...prior,
      id: `${prior.id}-DELETED-${prior.revision + 1}`,
      revision: prior.revision + 1,
      deleted: true,
      createdAt: this.clock().toISOString(),
    });
    return this.store.appendUnderstandingRecordWithCas(workspaceId, 'PROJECT_CAPABILITY_REVISION', tombstone, {
      headKey: `PROJECT_CAPABILITY_REVISION:${prior.kind}:${prior.normalizedName}`,
      expectedVersion,
    });
  }

  async getCapabilityDraft(workspaceId) {
    if (!await this.getWorkspace(workspaceId)) return null;
    return [...await this.store.listUnderstandingRecords(workspaceId, 'WORKSPACE_CAPABILITY_DRAFT')]
      .sort((left, right) => right.revision - left.revision)[0] ?? null;
  }

  async saveCapabilityDraft(workspaceId, input) {
    if (!await this.getWorkspace(workspaceId)) return null;
    const current = await this.getCapabilityDraft(workspaceId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new TypeError('expectedVersion is required');
    const expectedVersion = input.expectedVersion;
    if (expectedVersion !== (current?.revision ?? 0)) throw new TypeError(`Workspace capability draft version conflict: expected ${expectedVersion}, current ${current?.revision ?? 0}`);
    const policyRevision = async (kind, content, suppliedId) => {
      if (suppliedId) {
        const existing = await this.store.getUnderstandingRecord(workspaceId, 'WORKSPACE_POLICY_REVISION', suppliedId);
        if (!existing || existing.kind !== kind) throw new TypeError(`${kind} policy revision is unavailable in this Workspace`);
        return existing;
      }
      const records = (await this.store.listUnderstandingRecords(workspaceId, 'WORKSPACE_POLICY_REVISION')).filter((record) => record.kind === kind);
      const revision = Math.max(0, ...records.map((record) => record.revision)) + 1;
      const record = createWorkspacePolicyRevision({ workspaceId, kind, revision, content: content ?? {} }, this.clock);
      return this.store.appendUnderstandingRecordWithCas(workspaceId, 'WORKSPACE_POLICY_REVISION', record, { headKey: `WORKSPACE_POLICY_REVISION:${kind}`, expectedVersion: revision - 1 });
    };
    const [dependency, convention, security] = await Promise.all([
      policyRevision('DEPENDENCY', input.dependencies, input.dependencyPolicyRevisionId),
      policyRevision('CONVENTION', input.conventions, input.conventionRevisionId),
      policyRevision('SECURITY', input.securityPolicy, input.securityPolicyRevisionId),
    ]);
    const draft = createWorkspaceCapabilityDraftRevision({
      ...input, workspaceId, revision: expectedVersion + 1,
      dependencyPolicyRevisionId: dependency.id,
      conventionRevisionId: convention.id,
      securityPolicyRevisionId: security.id,
    }, this.clock);
    return this.store.appendUnderstandingRecordWithCas(workspaceId, 'WORKSPACE_CAPABILITY_DRAFT', draft, {
      headKey: 'WORKSPACE_CAPABILITY_DRAFT', expectedVersion,
    });
  }

  async effectiveCapabilityCatalog(workspaceId, disabledKeys = null) {
    const projectCatalog = await this.listProjectCapabilities(workspaceId);
    if (!projectCatalog) return null;
    const draft = await this.getCapabilityDraft(workspaceId);
    return resolveWorkspaceCapabilityCatalog({
      builtinCatalog: await this.listBuiltinCapabilities(),
      projectCatalog,
      disabledKeys: disabledKeys ?? draft?.disabledKeys ?? [],
    });
  }

  async validateCapabilityDraft(workspaceId, modelProfiles) {
    const draft = await this.getCapabilityDraft(workspaceId);
    if (!draft) return null;
    const catalog = await this.effectiveCapabilityCatalog(workspaceId, draft.disabledKeys);
    return Object.freeze({ draft, catalog, validation: validateWorkspaceCapabilityDraft({ draft, modelProfiles, effectiveCatalog: catalog.effective }) });
  }

  async activateCapabilityDraft(workspaceId, modelProfiles) {
    const result = await this.validateCapabilityDraft(workspaceId, modelProfiles);
    if (!result) return null;
    const profile = activateWorkspaceCapabilityDraft({ draft: result.draft, modelProfiles, catalog: result.catalog, clock: this.clock });
    await this.store.appendUnderstandingRecord(workspaceId, 'WORKSPACE_EXECUTION_PROFILE', profile);
    return profile;
  }

  async modelUsage(profileId) {
    const references = [];
    for (const workspace of await this.listWorkspaces(null, { includeDeleted: false })) {
      const draft = await this.getCapabilityDraft(workspace.id);
      for (const slot of draft ? [draft.mainAgentSlot, ...draft.childAgentSlots] : []) {
        if (slot.modelProfileId === profileId) references.push({ workspaceId: workspace.id, workspaceName: workspace.name, source: 'DRAFT_HEAD', slotId: slot.id });
      }
      const activeProfile = (await this.listWorkspaceProfiles(workspace.id))?.[0];
      for (const slot of (activeProfile ? [activeProfile.mainAgentSlot, ...(activeProfile.childAgentSlots ?? [])] : []).filter(Boolean)) {
        if (slot.modelProfileId === profileId) references.push({ workspaceId: workspace.id, workspaceName: workspace.name, source: 'ACTIVE_PROFILE_HEAD', slotId: slot.id, profileRevisionId: activeProfile.id });
      }
      for (const run of await this.store.listUnderstandingRecords(workspace.id, 'WORKSPACE_ANALYSIS_JOB')) {
        if (!['RUNNING', 'PAUSED'].includes(run.status)) continue;
        const pinned = await this.store.getUnderstandingRecord(workspace.id, 'WORKSPACE_EXECUTION_PROFILE', run.workspaceExecutionProfileRevisionId);
        for (const slot of (pinned ? [pinned.mainAgentSlot, ...(pinned.childAgentSlots ?? [])] : []).filter(Boolean)) {
          if (slot.modelProfileId === profileId) references.push({ workspaceId: workspace.id, workspaceName: workspace.name, source: 'ACTIVE_RUN', slotId: slot.id, runId: run.id, profileRevisionId: pinned.id });
        }
      }
    }
    return Object.freeze({ profileId, references: Object.freeze(references), usageCount: references.length });
  }

  async saveWorkspaceCapabilityConfig(workspaceId, input) {
    if (!await this.getWorkspace(workspaceId)) return null;
    const configs = [...(await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_CAPABILITY_CONFIG"))];
    const config = createWorkspaceCapabilityConfig({
      ...input,
      workspaceId,
      version: input.version ?? Math.max(0, ...configs.map(({ version }) => version)) + 1,
    }, this.clock);
    return this.store.appendUnderstandingRecord(workspaceId, "WORKSPACE_CAPABILITY_CONFIG", config);
  }

  async listWorkspaceCapabilityConfigs(workspaceId) {
    if (!await this.getWorkspace(workspaceId)) return null;
    return Object.freeze([...(await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_CAPABILITY_CONFIG"))]
      .sort((left, right) => right.version - left.version));
  }

  async resolveWorkspaceProfile(workspaceId, configId = null) {
    const configs = [...(await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_CAPABILITY_CONFIG"))];
    const config = configId
      ? configs.find(({ id }) => id === configId)
      : configs.sort((left, right) => right.version - left.version)[0];
    if (!config) return null;
    const profile = resolveWorkspaceExecutionProfile({
      workspaceId,
      templates: await this.store.listCapabilityTemplateRevisions(),
      config,
      clock: this.clock,
    });
    await this.store.appendUnderstandingRecord(workspaceId, "WORKSPACE_EXECUTION_PROFILE", profile);
    return profile;
  }

  async listWorkspaceProfiles(workspaceId) {
    if (!await this.getWorkspace(workspaceId)) return null;
    return Object.freeze([...(await this.store.listUnderstandingRecords(workspaceId, "WORKSPACE_EXECUTION_PROFILE"))]
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))));
  }

  async issueSecretGrants(workspaceId, profileId, input) {
    const profile = await this.store.getUnderstandingRecord(workspaceId, "WORKSPACE_EXECUTION_PROFILE", profileId);
    if (!profile) return null;
    const grants = issueScopedSecretGrants(profile, input);
    for (const grant of grants) await this.store.appendUnderstandingRecord(workspaceId, "SECRET_GRANT", grant);
    return grants;
  }

  async createBatch(workspaceId, input) {
    const profile = await this.store.getUnderstandingRecord(
      workspaceId,
      "WORKSPACE_EXECUTION_PROFILE",
      input.profileRevisionId,
    );
    if (!profile) return null;
    const batch = createAnalysisBatch({ ...input, workspaceId }, this.clock);
    const assignments = fanOutAnalysisBatch(batch, profile, this.clock);
    await this.store.appendUnderstandingRecord(workspaceId, "ANALYSIS_BATCH", batch);
    for (const assignment of assignments) {
      await this.store.appendUnderstandingRecord(workspaceId, "CHILD_WORK_UNIT", assignment);
    }
    return Object.freeze({ batch, assignments });
  }

  async commitChildResult(workspaceId, input) {
    const batch = await this.store.getUnderstandingRecord(workspaceId, "ANALYSIS_BATCH", input.analysisBatchId);
    const assignment = await this.store.getUnderstandingRecord(workspaceId, "CHILD_WORK_UNIT", input.childWorkUnitId);
    if (!batch || !assignment) return null;
    if (assignment.slotId !== input.slotId || assignment.inputDigest !== input.inputDigest) {
      throw new TypeError("Child result does not match its sealed assignment");
    }
    const result = commitChildBatchResult({ ...input, workspaceId }, this.clock);
    const existing = await this.store.getUnderstandingRecord(
      workspaceId,
      "CHILD_BATCH_RESULT",
      result.id,
    );
    if (existing) {
      const comparable = ({ completedAt: _completedAt, ...value }) => value;
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(result))) {
        throw new TypeError("a conflicting Child result is already committed for this sealed input");
      }
      return existing;
    }
    return this.store.appendUnderstandingRecord(workspaceId, "CHILD_BATCH_RESULT", result);
  }

  async openBatchBarrier(workspaceId, batchId) {
    const batch = await this.store.getUnderstandingRecord(workspaceId, "ANALYSIS_BATCH", batchId);
    if (!batch) return null;
    const assignments = (await this.store.listUnderstandingRecords(workspaceId, "CHILD_WORK_UNIT"))
      .filter(({ analysisBatchId }) => analysisBatchId === batchId);
    const results = (await this.store.listUnderstandingRecords(workspaceId, "CHILD_BATCH_RESULT"))
      .filter(({ analysisBatchId }) => analysisBatchId === batchId);
    const barrier = openAnalysisBatchBarrier(batch, assignments, results);
    const record = Object.freeze({
      id: `BARRIER-${batch.id}`,
      workspaceId,
      analysisRunId: batch.analysisRunId,
      ...barrier,
      openedAt: this.clock().toISOString(),
    });
    const existing = await this.store.getUnderstandingRecord(workspaceId, "BATCH_BARRIER", record.id);
    if (existing) return existing;
    return this.store.appendUnderstandingRecord(workspaceId, "BATCH_BARRIER", record);
  }

  async getReviewQueue(workspaceId, filters = {}) {
    const decisions = [...(await this.store.listUnderstandingRecords(workspaceId, "REVIEW_BATCH_DECISION"))]
      .sort((left, right) => String(right.decidedAt).localeCompare(String(left.decidedAt)));
    const items = (await this.store.listUnderstandingRecords(workspaceId, "REVIEW_QUEUE_ITEM"))
      .map((item) => {
        const decision = decisions.find(({ itemIds }) => itemIds.includes(item.id));
        return decision
          ? {
              ...item,
              status: decision.outcome,
              reviewerId: decision.reviewerId,
              rationale: decision.rationale,
              edits: structuredClone(decision.edits?.[item.id] ?? {}),
              decisionId: decision.id,
              decidedAt: decision.decidedAt,
            }
          : item;
      });
    return Object.freeze(items
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.severity || item.severity === filters.severity)
      .filter((item) => !filters.evidenceState || item.evidenceState === filters.evidenceState)
      .filter((item) => !filters.source || item.source === filters.source)
      .filter((item) => !filters.analysisBatchId || item.analysisBatchId === filters.analysisBatchId));
  }

  async decideReviewBatch(workspaceId, input) {
    const itemIds = [...new Set(input.itemIds ?? [])];
    if (itemIds.length === 0) throw new TypeError("itemIds must contain at least one review item");
    if (!["CONFIRMED", "EDITED", "REJECTED", "DEFERRED", "INSUFFICIENT_EVIDENCE"].includes(input.outcome)) {
      throw new TypeError("unsupported review batch outcome");
    }
    if (typeof input.reviewerId !== "string" || input.reviewerId.trim() === "") {
      throw new TypeError("reviewerId is required");
    }
    if (typeof input.rationale !== "string" || input.rationale.trim() === "") {
      throw new TypeError("rationale is required");
    }
    const queue = new Map((await this.getReviewQueue(workspaceId)).map((item) => [item.id, item]));
    for (const itemId of itemIds) {
      if (!queue.has(itemId)) throw new TypeError(`review item ${itemId} does not exist in this Workspace`);
    }
    const versionVector = Object.fromEntries(itemIds.map((itemId) => [itemId, queue.get(itemId).version]));
    const decision = Object.freeze({
      id: `REVIEW-BATCH-${this.clock().getTime()}-${itemIds.length}`,
      workspaceId,
      itemIds: itemIds.sort(),
      versionVector,
      outcome: input.outcome,
      edits: structuredClone(input.edits ?? {}),
      reviewerId: input.reviewerId,
      rationale: input.rationale,
      decidedAt: this.clock().toISOString(),
    });
    return this.store.appendUnderstandingRecord(workspaceId, "REVIEW_BATCH_DECISION", decision);
  }
}
