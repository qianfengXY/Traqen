import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson, deepFreeze } from "./canonical-json.js";
import {
  AssertionResultStatus,
  EvidenceFreshness,
  EvidenceType,
  ExecutionCompletionReason,
  ExecutionPhaseStatus,
  VerificationStatus,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

const sensitiveField =
  /(?:authorization|api[_-]?key|token|password|secret|certificate|private[_-]?key|credential|cookie)/i;

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return structuredClone(value);
}

function requireArray(value, fieldName, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new TypeError(`${fieldName} must be ${nonEmpty ? "a non-empty array" : "an array"}`);
  }
  return value;
}

function optionalString(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, fieldName);
}

function isoTimestamp(value, fieldName) {
  requireIsoTimestamp(value, fieldName);
  return value;
}

function normalizeRunner(value) {
  return {
    id: requireNonEmptyString(value?.id, "execution.runner.id"),
    version: requireNonEmptyString(value?.version, "execution.runner.version"),
  };
}

function normalizeAssertionResult(value, fieldName) {
  const result = requireObject(value, fieldName);
  return {
    ...result,
    id: requireNonEmptyString(result.id, `${fieldName}.id`),
    status: assertEnum(AssertionResultStatus, result.status, `${fieldName}.status`),
    message: optionalString(result.message, `${fieldName}.message`),
  };
}

function normalizeAttempt(value, index) {
  const attempt = requireObject(value, `execution.attempts[${index}]`);
  const startedAt = isoTimestamp(attempt.startedAt, `execution.attempts[${index}].startedAt`);
  const finishedAt = isoTimestamp(attempt.finishedAt, `execution.attempts[${index}].finishedAt`);
  if (Date.parse(startedAt) > Date.parse(finishedAt)) {
    throw new RangeError(`execution.attempts[${index}].startedAt must not be later than finishedAt`);
  }
  const setup = requireObject(attempt.setup ?? { status: "SKIPPED" }, `execution.attempts[${index}].setup`);
  const cleanup = requireObject(attempt.cleanup ?? { status: "SKIPPED" }, `execution.attempts[${index}].cleanup`);
  const assertionResults = requireArray(
    attempt.assertionResults ?? [],
    `execution.attempts[${index}].assertionResults`,
  ).map((result, resultIndex) =>
    normalizeAssertionResult(result, `execution.attempts[${index}].assertionResults[${resultIndex}]`),
  );
  if (new Set(assertionResults.map((result) => result.id)).size !== assertionResults.length) {
    throw new TypeError(`execution.attempts[${index}].assertionResults must use unique ids`);
  }
  return {
    number: requirePositiveInteger(attempt.number, `execution.attempts[${index}].number`),
    startedAt,
    finishedAt,
    phaseStatus: assertEnum(
      ExecutionPhaseStatus,
      attempt.phaseStatus,
      `execution.attempts[${index}].phaseStatus`,
    ),
    setup: {
      ...setup,
      status: assertEnum(
        ExecutionPhaseStatus,
        setup.status,
        `execution.attempts[${index}].setup.status`,
      ),
    },
    stepResults: requireArray(attempt.stepResults ?? [], `execution.attempts[${index}].stepResults`).map(
      (result, resultIndex) => requireObject(result, `execution.attempts[${index}].stepResults[${resultIndex}]`),
    ),
    assertionResults,
    cleanup: {
      ...cleanup,
      status: assertEnum(
        ExecutionPhaseStatus,
        cleanup.status,
        `execution.attempts[${index}].cleanup.status`,
      ),
    },
  };
}

function uniqueAttemptNumbers(attempts) {
  const numbers = new Set();
  for (const attempt of attempts) {
    if (numbers.has(attempt.number)) throw new TypeError("execution.attempts must use unique attempt numbers");
    numbers.add(attempt.number);
  }
  const expected = attempts.map((_, index) => index + 1);
  const actual = [...numbers].sort((left, right) => left - right);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError("execution.attempts must be numbered consecutively from 1");
  }
  return attempts;
}

export function deriveExecutionStatus({ completionReason, attempts }) {
  if (completionReason === ExecutionCompletionReason.CANCELLED) return VerificationStatus.CANCELLED;
  if (completionReason === ExecutionCompletionReason.SKIPPED) return VerificationStatus.SKIPPED;
  if (attempts.length === 0) return VerificationStatus.INCONCLUSIVE;

  const assertions = attempts.flatMap((attempt) => attempt.assertionResults);
  if (
    attempts.some((attempt) => attempt.phaseStatus === ExecutionPhaseStatus.FAIL) ||
    assertions.some((result) => result.status === AssertionResultStatus.FAIL)
  ) {
    return VerificationStatus.FAIL;
  }
  if (
    attempts.some(
      (attempt) =>
        attempt.phaseStatus === ExecutionPhaseStatus.ERROR ||
        [ExecutionPhaseStatus.FAIL, ExecutionPhaseStatus.ERROR].includes(attempt.setup.status) ||
        [ExecutionPhaseStatus.FAIL, ExecutionPhaseStatus.ERROR].includes(attempt.cleanup.status),
    ) ||
    assertions.some((result) => result.status === AssertionResultStatus.ERROR)
  ) {
    return VerificationStatus.ERROR;
  }
  if (
    assertions.length === 0 ||
    assertions.some((result) =>
      [AssertionResultStatus.INCONCLUSIVE, AssertionResultStatus.SKIPPED].includes(result.status),
    )
  ) {
    return VerificationStatus.INCONCLUSIVE;
  }
  return assertions.every((result) => result.status === AssertionResultStatus.PASS)
    ? VerificationStatus.PASS
    : VerificationStatus.INCONCLUSIVE;
}

export function createTestExecution(input) {
  const startedAt = isoTimestamp(input?.startedAt, "execution.startedAt");
  const finishedAt = isoTimestamp(input?.finishedAt, "execution.finishedAt");
  if (Date.parse(startedAt) > Date.parse(finishedAt)) {
    throw new RangeError("execution.startedAt must not be later than execution.finishedAt");
  }
  const completionReason = assertEnum(
    ExecutionCompletionReason,
    input?.completionReason ?? ExecutionCompletionReason.COMPLETED,
    "execution.completionReason",
  );
  const attempts = uniqueAttemptNumbers(
    requireArray(input?.attempts ?? [], "execution.attempts").map(normalizeAttempt),
  );
  if (
    attempts.some(
      (attempt) =>
        Date.parse(attempt.startedAt) < Date.parse(startedAt) ||
        Date.parse(attempt.finishedAt) > Date.parse(finishedAt),
    )
  ) {
    throw new RangeError("execution attempts must fall within the execution time window");
  }
  const execution = {
    id: requireNonEmptyString(input?.id, "execution.id"),
    testSpecId: requireNonEmptyString(input?.testSpecId, "execution.testSpecId"),
    testSpecVersion: requirePositiveInteger(input?.testSpecVersion, "execution.testSpecVersion"),
    snapshotManifestId: requireNonEmptyString(input?.snapshotManifestId, "execution.snapshotManifestId"),
    deploymentId: requireNonEmptyString(input?.deploymentId, "execution.deploymentId"),
    runner: normalizeRunner(input?.runner),
    completionReason,
    status: deriveExecutionStatus({ completionReason, attempts }),
    startedAt,
    finishedAt,
    attempts,
  };
  assertSensitiveValuesRedacted(execution, "execution");
  return deepFreeze(execution);
}

function assertSensitiveValuesRedacted(value, rootLabel) {
  function visit(value, path) {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}/${index}`));
      return;
    }
    for (const [name, child] of Object.entries(value)) {
      const childPath = `${path}/${name}`;
      if (sensitiveField.test(name) && child !== "[REDACTED]") {
        throw new TypeError(`${rootLabel} sensitive value at ${childPath} must be redacted`);
      }
      visit(child, childPath);
    }
  }
  visit(value, "");
}

export function evidenceContentHash(manifest) {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

function createEvidence(input, execution, clock) {
  const manifest = requireObject(input?.manifest, "evidence.manifest");
  const evidenceType = assertEnum(EvidenceType, input?.type, "evidence.type");
  const redactions = requireArray(manifest.redactions, "evidence.manifest.redactions");
  manifest.redactions = redactions;
  assertSensitiveValuesRedacted(manifest, "evidence.manifest");
  for (const [fieldName, actual, expected] of [
    ["executionId", manifest.executionId, execution.id],
    ["testSpecId", manifest.testSpecId, execution.testSpecId],
    ["testSpecVersion", manifest.testSpecVersion, execution.testSpecVersion],
    ["snapshotManifestId", manifest.snapshotManifestId, execution.snapshotManifestId],
    ["deploymentId", manifest.deploymentId, execution.deploymentId],
    ["runnerId", manifest.runnerId, execution.runner.id],
    ["runnerVersion", manifest.runnerVersion, execution.runner.version],
  ]) {
    if (actual !== expected) throw new TypeError(`evidence.manifest.${fieldName} must match the execution`);
  }
  if (evidenceType === EvidenceType.ASSERTION) {
    const assertionResults = requireArray(
      manifest.assertionResults,
      "evidence.manifest.assertionResults",
      { nonEmpty: execution.status === VerificationStatus.PASS },
    ).map((result, index) => normalizeAssertionResult(result, `evidence.manifest.assertionResults[${index}]`));
    const executionAssertions = execution.attempts.flatMap((attempt) => attempt.assertionResults);
    if (canonicalJson(assertionResults) !== canonicalJson(executionAssertions)) {
      throw new TypeError("evidence.manifest.assertionResults must match the execution attempts");
    }
    manifest.assertionResults = assertionResults;
  }
  const contentHash = evidenceContentHash(manifest);
  if (input?.contentHash !== undefined && input.contentHash !== contentHash) {
    throw new TypeError("evidence.contentHash does not match the canonical manifest");
  }
  const createdAt = input?.createdAt ?? clock().toISOString();
  isoTimestamp(createdAt, "evidence.createdAt");
  if (Date.parse(createdAt) < Date.parse(execution.finishedAt)) {
    throw new RangeError("evidence.createdAt must not be earlier than execution.finishedAt");
  }
  return {
    id: requireNonEmptyString(input?.id, "evidence.id"),
    executionId: execution.id,
    type: evidenceType,
    freshness: assertEnum(EvidenceFreshness, input?.freshness ?? "FRESH", "evidence.freshness"),
    contentHash,
    storageUri: optionalString(input?.storageUri, "evidence.storageUri"),
    manifest,
    createdAt,
  };
}

export function createExecutionEvidenceBundle(input, clock = () => new Date()) {
  const execution = createTestExecution(input?.execution);
  const evidence = requireArray(input?.evidence, "evidence", { nonEmpty: true }).map((item) =>
    createEvidence(item, execution, clock),
  );
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) {
    throw new TypeError("evidence ids must be unique");
  }
  if (execution.status === VerificationStatus.PASS && !evidence.some((item) => item.type === EvidenceType.ASSERTION)) {
    throw new TypeError("a passing execution requires ASSERTION evidence");
  }
  return deepFreeze({ execution, evidence });
}

export function executionBundleSigningPayload(projectId, bundle) {
  return canonicalJson({
    kind: "EXECUTION_EVIDENCE_BUNDLE",
    projectId: requireNonEmptyString(projectId, "projectId"),
    execution: bundle.execution,
    evidence: bundle.evidence,
  });
}

export function signExecutionEvidenceBundle(projectId, bundle, secret) {
  requireNonEmptyString(secret, "runner secret");
  const signature = createHmac("sha256", secret).update(executionBundleSigningPayload(projectId, bundle)).digest("hex");
  return deepFreeze({
    ...structuredClone(bundle),
    attestation: {
      algorithm: "HMAC-SHA256",
      runnerId: bundle.execution.runner.id,
      signature,
    },
  });
}

export function verifyExecutionEvidenceAttestation(projectId, bundle, secret) {
  if (bundle?.attestation?.algorithm !== "HMAC-SHA256") return false;
  if (bundle.attestation.runnerId !== bundle.execution?.runner?.id) return false;
  if (typeof bundle.attestation.signature !== "string" || !/^[a-f0-9]{64}$/.test(bundle.attestation.signature)) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(executionBundleSigningPayload(projectId, bundle))
    .digest();
  const actual = Buffer.from(bundle.attestation.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
