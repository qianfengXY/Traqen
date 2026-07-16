import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson, deepFreeze, requireIsoTimestamp, requireNonEmptyString } from "../domain/index.js";
import { RunnerPolicyError } from "./errors.js";

function requireHash(value, fieldName) {
  requireNonEmptyString(value, fieldName);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new TypeError(`${fieldName} must be a SHA-256 digest`);
  return value;
}

export function runnerPolicyHash(policy) {
  let serializable;
  try {
    serializable = structuredClone(policy);
  } catch {
    throw new TypeError("target policy must be structured-clone serializable");
  }
  return `sha256:${createHash("sha256").update(canonicalJson(serializable)).digest("hex")}`;
}

export function createRunnerTask(input) {
  const issuedAt = requireNonEmptyString(input?.issuedAt, "task.issuedAt");
  const expiresAt = requireNonEmptyString(input?.expiresAt, "task.expiresAt");
  requireIsoTimestamp(issuedAt, "task.issuedAt");
  requireIsoTimestamp(expiresAt, "task.expiresAt");
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) {
    throw new RangeError("task.issuedAt must be earlier than task.expiresAt");
  }
  if (Date.parse(expiresAt) - Date.parse(issuedAt) > 5 * 60 * 1000) {
    throw new RangeError("Runner task validity window must not exceed 5 minutes");
  }
  if (!input?.testSpec || typeof input.testSpec !== "object") throw new TypeError("task.testSpec must be an object");
  if (!input?.snapshotManifest || typeof input.snapshotManifest !== "object") {
    throw new TypeError("task.snapshotManifest must be an object");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "task.id"),
    projectId: requireNonEmptyString(input?.projectId, "task.projectId"),
    executionId: requireNonEmptyString(input?.executionId, "task.executionId"),
    runnerId: requireNonEmptyString(input?.runnerId, "task.runnerId"),
    nonce: requireNonEmptyString(input?.nonce, "task.nonce"),
    policyHash: requireHash(input?.policyHash, "task.policyHash"),
    issuedAt,
    expiresAt,
    testSpec: structuredClone(input.testSpec),
    snapshotManifest: structuredClone(input.snapshotManifest),
  });
}

export function runnerTaskSigningPayload(task) {
  return canonicalJson({ kind: "RUNNER_TASK", ...createRunnerTask(task) });
}

export function signRunnerTask(task, secret) {
  requireNonEmptyString(secret, "runner task secret");
  const normalized = createRunnerTask(task);
  const signature = createHmac("sha256", secret).update(runnerTaskSigningPayload(normalized)).digest("hex");
  return deepFreeze({
    ...structuredClone(normalized),
    attestation: { algorithm: "HMAC-SHA256", signature },
  });
}

export function verifyRunnerTask(task, secret) {
  if (task?.attestation?.algorithm !== "HMAC-SHA256") return false;
  if (typeof task.attestation.signature !== "string" || !/^[a-f0-9]{64}$/.test(task.attestation.signature)) {
    return false;
  }
  let expected;
  try {
    expected = createHmac("sha256", secret).update(runnerTaskSigningPayload(task)).digest();
  } catch {
    return false;
  }
  const actual = Buffer.from(task.attestation.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticateRunnerTask(task, { runnerId, secret, now, usedNonces }) {
  if (!verifyRunnerTask(task, secret)) throw new RunnerPolicyError("Runner task signature is invalid");
  const normalized = createRunnerTask(task);
  if (normalized.runnerId !== runnerId) throw new RunnerPolicyError("Runner task targets another Runner");
  const timestamp = now.getTime();
  if (timestamp < Date.parse(normalized.issuedAt) || timestamp >= Date.parse(normalized.expiresAt)) {
    throw new RunnerPolicyError("Runner task is not within its validity window");
  }
  if (usedNonces.has(normalized.nonce)) throw new RunnerPolicyError("Runner task nonce has already been used");
  return normalized;
}

export function bindRunnerTaskPolicy(task, { policy, usedNonces }) {
  if (usedNonces.has(task.nonce)) throw new RunnerPolicyError("Runner task nonce has already been used");
  if (task.policyHash !== runnerPolicyHash(policy)) {
    throw new RunnerPolicyError("Runner task policyHash does not match the local target policy");
  }
  usedNonces.add(task.nonce);
  return task;
}

export function assertRunnerTaskUsable(task, options) {
  const normalized = authenticateRunnerTask(task, options);
  return bindRunnerTaskPolicy(normalized, options);
}
