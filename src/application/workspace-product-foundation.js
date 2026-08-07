import {
  commitChildBatchResult,
  createAnalysisBatch,
  createCapabilityTemplateRevision,
  createWorkspace,
  createWorkspaceCapabilityConfig,
  createWorkspaceLifecycleEvent,
  createWorkspaceViewPreference,
  evolveWorkspace,
  fanOutAnalysisBatch,
  issueScopedSecretGrants,
  openAnalysisBatchBarrier,
  resolveWorkspaceExecutionProfile,
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
