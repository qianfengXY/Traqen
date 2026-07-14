import {
  createReverseArtifactBundle,
  deepFreeze,
  mergeReverseArtifactBundles,
  requireIsoTimestamp,
  requireNonEmptyString,
} from "../domain/index.js";

function positiveInteger(value, fieldName, fallback) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1) throw new TypeError(`${fieldName} must be a positive integer`);
  return candidate;
}

function policyAllows(policy, fieldName, value) {
  if (!Object.hasOwn(policy, fieldName)) return true;
  const allowlist = policy[fieldName];
  if (!Array.isArray(allowlist) || allowlist.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`policy.${fieldName} must be an array of non-empty strings`);
  }
  return allowlist.includes(value);
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function assertSafeOutput(value, path = "output") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeOutput(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value)) {
      throw new TypeError(`${path} contains secret-like material`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "secretRef") {
      if (typeof nested !== "string" || nested.trim() === "") {
        throw new TypeError(`${path}.secretRef must be a non-empty local secret reference`);
      }
      continue;
    }
    if (/password|secret|token|authorization|credential|private.?key/i.test(key)) {
      if (
        !nested ||
        typeof nested !== "object" ||
        Array.isArray(nested) ||
        Object.keys(nested).length !== 1 ||
        typeof nested.secretRef !== "string" ||
        nested.secretRef.trim() === ""
      ) {
        throw new TypeError(`${path}.${key} is a forbidden sensitive output field without secretRef`);
      }
      continue;
    }
    assertSafeOutput(nested, `${path}.${key}`);
  }
}

function emittedTypes(rawOutput) {
  const mapping = {
    candidateFeatures: "CANDIDATE_FEATURE",
    candidateClaims: "CANDIDATE_CLAIM",
    candidateTestSpecs: "CANDIDATE_TEST_SPEC",
    openQuestions: "OPEN_QUESTION",
  };
  return Object.entries(mapping)
    .filter(([field]) => Array.isArray(rawOutput[field]) && rawOutput[field].length > 0)
    .map(([, type]) => type);
}

async function executeWithBoundary(adapter, inputPackage, { signal, timeoutMs, setTimer, clearTimer }) {
  if (signal?.aborted) throw createAbortError("Reverse run was cancelled");
  let timeout;
  let abortListener;
  const boundary = new Promise((_, reject) => {
    timeout = setTimer(() => reject(new Error(`Skill execution exceeded ${timeoutMs}ms`)), timeoutMs);
    if (signal) {
      abortListener = () => reject(createAbortError("Reverse run was cancelled"));
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(() => adapter.execute(inputPackage, { signal })), boundary]);
  } finally {
    clearTimer(timeout);
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

export class ReverseSkillOrchestrator {
  #adapters;
  #clock;
  #setTimer;
  #clearTimer;
  #millisecondsPerMinute;

  constructor({
    adapters,
    clock = () => new Date(),
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    millisecondsPerMinute = 60_000,
  }) {
    if (!Array.isArray(adapters) || adapters.length === 0) throw new TypeError("adapters must be a non-empty array");
    if (!Number.isSafeInteger(millisecondsPerMinute) || millisecondsPerMinute < 1) {
      throw new TypeError("millisecondsPerMinute must be a positive integer");
    }
    this.#adapters = new Map(adapters.map((adapter) => [`${adapter.id}\u0000${adapter.version}`, adapter]));
    if (this.#adapters.size !== adapters.length) throw new TypeError("adapter id and version pairs must be unique");
    this.#clock = clock;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#millisecondsPerMinute = millisecondsPerMinute;
  }

  async execute({ runId, inputPackage, registrations, modelProfile = null, policy = {}, signal = null }) {
    requireNonEmptyString(runId, "runId");
    if (!inputPackage?.digest || !Array.isArray(registrations) || registrations.length === 0) {
      throw new TypeError("inputPackage and non-empty registrations are required");
    }
    const maxSkills = positiveInteger(policy.maxSkills, "policy.maxSkills", 5);
    if (registrations.length > maxSkills) throw new RangeError("Reverse run exceeds policy.maxSkills");
    const maxAttempts = positiveInteger(policy.maxAttempts, "policy.maxAttempts", 1);
    if (maxAttempts > 3) throw new RangeError("policy.maxAttempts must not exceed 3");
    const maxTimeoutMinutes = positiveInteger(policy.maxTimeoutMinutes, "policy.maxTimeoutMinutes", 30);
    const maxRawOutputBytes = positiveInteger(policy.maxRawOutputBytes, "policy.maxRawOutputBytes", 10_000_000);
    if (maxRawOutputBytes > 50_000_000) {
      throw new RangeError("policy.maxRawOutputBytes must not exceed 50000000");
    }
    const events = [];
    const event = (status, details = {}) => {
      const occurredAt = this.#clock().toISOString();
      requireIsoTimestamp(occurredAt, "run event occurredAt");
      events.push({ sequence: events.length + 1, status, details, occurredAt });
    };
    event("CREATED");
    event("FACT_SCANNING", {
      inputDigest: inputPackage.digest,
      nodeCount: inputPackage.facts.nodes.length,
      edgeCount: inputPackage.facts.edges.length,
    });
    if (policy.allowIncompleteFacts !== true && inputPackage.factBundles.some((bundle) => !bundle.complete)) {
      throw new TypeError("Reverse run policy rejects incomplete Fact Bundles");
    }
    event("SKILL_PLANNING", { skillCount: registrations.length });

    const planned = registrations.map((registration) => {
      const manifest = registration.manifest;
      if (registration.status === "BLOCKED") throw new TypeError(`Skill ${manifest.metadata.id} is blocked`);
      if (!policyAllows(policy, "allowedSkillIds", manifest.metadata.id)) {
        throw new TypeError(`Skill ${manifest.metadata.id} is not allowed by policy`);
      }
      if (!policyAllows(policy, "allowedPublishers", manifest.metadata.publisher)) {
        throw new TypeError(`Publisher ${manifest.metadata.publisher} is not allowed by policy`);
      }
      if (manifest.permissions.network !== "NONE" || manifest.permissions.shell !== "NONE" || manifest.permissions.secrets !== "NONE") {
        throw new TypeError(`Skill ${manifest.metadata.id} requests a runtime privilege unavailable in this executor`);
      }
      if (manifest.execution.timeoutMinutes > maxTimeoutMinutes) {
        throw new RangeError(`Skill ${manifest.metadata.id} exceeds policy.maxTimeoutMinutes`);
      }
      if (manifest.model.required) {
        if (!modelProfile || !manifest.model.allowedProfiles.includes(modelProfile)) {
          throw new TypeError(`Skill ${manifest.metadata.id} requires an allowed model profile`);
        }
        if (!policyAllows(policy, "allowedModelProfiles", modelProfile)) {
          throw new TypeError(`Model profile ${modelProfile} is not allowed by policy`);
        }
      }
      const adapter = this.#adapters.get(`${manifest.metadata.id}\u0000${manifest.metadata.version}`);
      if (!adapter || adapter.artifactDigest !== manifest.metadata.artifactDigest) {
        throw new TypeError(`Installed adapter does not match ${manifest.metadata.id}@${manifest.metadata.version}`);
      }
      return { registration, manifest, adapter };
    });

    event("SKILL_RUNNING", { skills: planned.map((item) => item.manifest.metadata.id) });
    const skillRuns = await Promise.all(planned.map(async ({ registration, manifest, adapter }) => {
      const attempts = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = this.#clock().toISOString();
        try {
          const rawOutput = await executeWithBoundary(adapter, inputPackage, {
            signal,
            timeoutMs: manifest.execution.timeoutMinutes * this.#millisecondsPerMinute,
            setTimer: this.#setTimer,
            clearTimer: this.#clearTimer,
          });
          assertSafeOutput(rawOutput);
          const undeclared = emittedTypes(rawOutput).filter((type) => !manifest.outputs.types.includes(type));
          if (undeclared.length) throw new TypeError(`Skill emitted undeclared output types: ${undeclared.join(", ")}`);
          const normalizedOutput = createReverseArtifactBundle({
            runId,
            producer: {
              skillId: manifest.metadata.id,
              skillVersion: manifest.metadata.version,
              adapterId: adapter.id,
              modelProfile: manifest.model.required ? modelProfile : null,
              promptVersion: adapter.promptVersion ?? null,
            },
            scope: {
              projectId: inputPackage.projectSnapshot.projectId,
              snapshotManifestId: inputPackage.projectSnapshot.snapshotManifestId,
              sourceComponentId: inputPackage.projectSnapshot.sourceComponentId,
              taskScope: inputPackage.taskScope,
            },
            inputDigest: inputPackage.digest,
            allowedFactIds: inputPackage.allowedFactIds,
            rawOutput,
            maxOutputCandidates: manifest.execution.maxOutputCandidates,
            maxRawOutputBytes,
            generatedAt: this.#clock().toISOString(),
          }, this.#clock);
          attempts.push({ attempt, status: "COMPLETED", startedAt, finishedAt: this.#clock().toISOString(), error: null });
          return deepFreeze({
            skillId: manifest.metadata.id,
            skillVersion: manifest.metadata.version,
            registrationId: registration.id,
            status: "COMPLETED",
            observeOnly: registration.status === "OBSERVE",
            attempts,
            rawOutput,
            normalizedOutput,
          });
        } catch (error) {
          attempts.push({
            attempt,
            status: error.name === "AbortError" ? "CANCELLED" : "FAILED",
            startedAt,
            finishedAt: this.#clock().toISOString(),
            error: { name: error.name, message: error.message },
          });
          if (error.name === "AbortError" || attempt === maxAttempts) {
            return deepFreeze({
              skillId: manifest.metadata.id,
              skillVersion: manifest.metadata.version,
              registrationId: registration.id,
              status: error.name === "AbortError" ? "CANCELLED" : "FAILED",
              observeOnly: registration.status === "OBSERVE",
              attempts,
              rawOutput: null,
              normalizedOutput: null,
            });
          }
        }
      }
      throw new Error("unreachable");
    }));

    if (skillRuns.every((run) => run.status === "CANCELLED")) {
      event("CANCELLED");
      return deepFreeze({
        id: runId,
        projectId: inputPackage.projectSnapshot.projectId,
        snapshotManifestId: inputPackage.projectSnapshot.snapshotManifestId,
        sourceComponentId: inputPackage.projectSnapshot.sourceComponentId,
        inputPackage,
        skillRuns,
        mergedOutput: null,
        status: "CANCELLED",
        statusHistory: events,
      });
    }
    const successful = skillRuns.filter((run) => run.status === "COMPLETED");
    if (successful.length === 0) {
      event("FAILED", { failedSkills: skillRuns.map((run) => run.skillId) });
      return deepFreeze({
        id: runId,
        projectId: inputPackage.projectSnapshot.projectId,
        snapshotManifestId: inputPackage.projectSnapshot.snapshotManifestId,
        sourceComponentId: inputPackage.projectSnapshot.sourceComponentId,
        inputPackage,
        skillRuns,
        mergedOutput: null,
        status: "FAILED",
        statusHistory: events,
      });
    }

    event("NORMALIZING", { successfulSkills: successful.length });
    event("CONFLICT_ANALYSIS");
    const mergedOutput = mergeReverseArtifactBundles({
      runId,
      bundles: successful.map((run) => run.normalizedOutput),
      mergedAt: this.#clock().toISOString(),
    }, this.#clock);
    event("WAITING_REVIEW", {
      conflicts: mergedOutput.conflicts.length,
      failedSkills: skillRuns.filter((run) => run.status === "FAILED").map((run) => run.skillId),
    });
    return deepFreeze({
      id: runId,
      projectId: inputPackage.projectSnapshot.projectId,
      snapshotManifestId: inputPackage.projectSnapshot.snapshotManifestId,
      sourceComponentId: inputPackage.projectSnapshot.sourceComponentId,
      inputPackage,
      skillRuns,
      mergedOutput,
      status: "WAITING_REVIEW",
      statusHistory: events,
    });
  }
}
