import { deepFreeze } from "./canonical-json.js";
import {
  TestExecutor,
  TestOperationLevel,
  TestRisk,
  TestSpecOriginType,
  assertEnum,
  requireIsoTimestamp,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

const sensitiveValueName =
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

function requireBoolean(value, fieldName, defaultValue) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "boolean") throw new TypeError(`${fieldName} must be a boolean`);
  return value;
}

function normalizeApproval(value, approved) {
  if (!approved) {
    if (value !== undefined && value !== null) {
      throw new TypeError("testSpec.approval must be null when testSpec.approved is false");
    }
    return null;
  }
  const approval = requireObject(value, "testSpec.approval");
  const approvedAt = requireNonEmptyString(approval.approvedAt, "testSpec.approval.approvedAt");
  requireIsoTimestamp(approvedAt, "testSpec.approval.approvedAt");
  return {
    actorId: requireNonEmptyString(approval.actorId, "testSpec.approval.actorId"),
    actorRole: requireNonEmptyString(approval.actorRole, "testSpec.approval.actorRole"),
    approvedAt,
    rationale: optionalString(approval.rationale, "testSpec.approval.rationale"),
    requestFingerprint: optionalString(
      approval.requestFingerprint,
      "testSpec.approval.requestFingerprint",
    ),
  };
}

function normalizeOrigin(value) {
  if (value === undefined || value === null) {
    return {
      type: TestSpecOriginType.MANUAL,
      claimRef: null,
      decisionId: null,
      mappingId: null,
      factIds: [],
      generator: null,
      requestFingerprint: null,
    };
  }
  const origin = requireObject(value, "testSpec.origin");
  const type = assertEnum(TestSpecOriginType, origin.type, "testSpec.origin.type");
  if (type === TestSpecOriginType.MANUAL) {
    return {
      type,
      claimRef: null,
      decisionId: null,
      mappingId: null,
      factIds: [],
      generator: null,
      requestFingerprint: optionalString(origin.requestFingerprint, "testSpec.origin.requestFingerprint"),
    };
  }
  const claimRef = requireObject(origin.claimRef, "testSpec.origin.claimRef");
  const generator = requireObject(origin.generator, "testSpec.origin.generator");
  const factIds = requireArray(origin.factIds, "testSpec.origin.factIds", { nonEmpty: true })
    .map((factId, index) => requireNonEmptyString(factId, `testSpec.origin.factIds[${index}]`));
  return {
    type,
    claimRef: {
      id: requireNonEmptyString(claimRef.id, "testSpec.origin.claimRef.id"),
      version: requirePositiveInteger(claimRef.version, "testSpec.origin.claimRef.version"),
    },
    decisionId: requireNonEmptyString(origin.decisionId, "testSpec.origin.decisionId"),
    mappingId: requireNonEmptyString(origin.mappingId, "testSpec.origin.mappingId"),
    factIds: [...new Set(factIds)],
    generator: {
      id: requireNonEmptyString(generator.id, "testSpec.origin.generator.id"),
      version: requireNonEmptyString(generator.version, "testSpec.origin.generator.version"),
    },
    requestFingerprint: requireNonEmptyString(
      origin.requestFingerprint,
      "testSpec.origin.requestFingerprint",
    ),
  };
}

function normalizeClaimRefs(value) {
  const references = requireArray(value, "testSpec.verifiesClaims", { nonEmpty: true }).map((reference, index) => ({
    id: requireNonEmptyString(reference?.id, `testSpec.verifiesClaims[${index}].id`),
    version: requirePositiveInteger(reference?.version, `testSpec.verifiesClaims[${index}].version`),
  }));
  const unique = new Map(references.map((reference) => [`${reference.id}\u0000${reference.version}`, reference]));
  return [...unique.values()];
}

function requireUniqueIds(items, fieldName) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new TypeError(`${fieldName} must use unique ids`);
    ids.add(item.id);
  }
  return items;
}

function normalizeSteps(value) {
  return requireUniqueIds(
    requireArray(value, "testSpec.steps", { nonEmpty: true }).map((step, index) => ({
      ...requireObject(step, `testSpec.steps[${index}]`),
      id: requireNonEmptyString(step?.id, `testSpec.steps[${index}].id`),
      executor: assertEnum(TestExecutor, step?.executor, `testSpec.steps[${index}].executor`),
    })),
    "testSpec.steps",
  );
}

function normalizeAssertions(value) {
  return requireUniqueIds(
    requireArray(value, "testSpec.assertions").map((assertion, index) => ({
      ...requireObject(assertion, `testSpec.assertions[${index}]`),
      id: requireNonEmptyString(assertion?.id, `testSpec.assertions[${index}].id`),
      type: requireNonEmptyString(assertion?.type, `testSpec.assertions[${index}].type`),
    })),
    "testSpec.assertions",
  );
}

export function createTestSpec(input, clock = () => new Date()) {
  const environment = requireObject(input?.environment, "testSpec.environment");
  const policy = requireObject(input?.policy ?? {}, "testSpec.policy");
  const approved = requireBoolean(input?.approved, "testSpec.approved", false);
  const approval = normalizeApproval(input?.approval, approved);
  const createdAt = input?.createdAt ?? clock().toISOString();
  requireIsoTimestamp(createdAt, "testSpec.createdAt");
  if (approval && Date.parse(approval.approvedAt) > Date.parse(createdAt)) {
    throw new RangeError("testSpec.approval.approvedAt must not be later than testSpec.createdAt");
  }
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "testSpec.id"),
    version: requirePositiveInteger(input?.version, "testSpec.version"),
    name: requireNonEmptyString(input?.name, "testSpec.name"),
    risk: assertEnum(TestRisk, input?.risk, "testSpec.risk"),
    approved,
    approval,
    featureId: requireNonEmptyString(input?.featureId, "testSpec.featureId"),
    verifiesClaims: normalizeClaimRefs(input?.verifiesClaims),
    origin: normalizeOrigin(input?.origin),
    sourceSnapshotId: optionalString(input?.sourceSnapshotId, "testSpec.sourceSnapshotId"),
    environment: {
      ...environment,
      target: requireNonEmptyString(environment.target, "testSpec.environment.target"),
      operationLevel: assertEnum(
        TestOperationLevel,
        environment.operationLevel,
        "testSpec.environment.operationLevel",
      ),
    },
    preconditions: requireArray(input?.preconditions ?? [], "testSpec.preconditions").map((item, index) =>
      requireObject(item, `testSpec.preconditions[${index}]`),
    ),
    variables: requireObject(input?.variables ?? {}, "testSpec.variables"),
    steps: normalizeSteps(input?.steps),
    assertions: normalizeAssertions(input?.assertions ?? []),
    cleanup: input?.cleanup == null ? null : requireObject(input.cleanup, "testSpec.cleanup"),
    policy: {
      ...policy,
      approvalRequired: requireBoolean(policy.approvalRequired, "testSpec.policy.approvalRequired", true),
      destructive: requireBoolean(policy.destructive, "testSpec.policy.destructive", false),
      externalSideEffect: requireBoolean(
        policy.externalSideEffect,
        "testSpec.policy.externalSideEffect",
        false,
      ),
    },
    createdAt,
  });
}

function violation(code, path, message, severity = "BLOCKING") {
  return { code, severity, path, message };
}

function sensitiveValueViolations(testSpec) {
  const violations = [];
  function visit(value, path) {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}/${index}`));
      return;
    }
    for (const [name, child] of Object.entries(value)) {
      const childPath = `${path}/${name}`;
      if (sensitiveValueName.test(name) && name !== "secretRef") {
        const isSecretReference =
          child !== null &&
          typeof child === "object" &&
          !Array.isArray(child) &&
          typeof child.secretRef === "string" &&
          child.secretRef.trim() !== "";
        const isTemplateReference = typeof child === "string" && /\$\{[^}]+\}/.test(child);
        if (!isSecretReference && !isTemplateReference) {
          violations.push(
            violation(
              "RAW_SECRET_FORBIDDEN",
              childPath,
              `Sensitive value ${name} must use secretRef or a variable reference`,
            ),
          );
          continue;
        }
      }
      visit(child, childPath);
    }
  }
  visit(testSpec, "");
  return violations;
}

export function validateTestSpec(input, clock = () => new Date()) {
  let testSpec;
  try {
    testSpec = createTestSpec(input, clock);
  } catch (error) {
    return deepFreeze({
      valid: false,
      executable: false,
      violations: [violation("INVALID_TEST_SPEC", "/", error.message)],
    });
  }

  const violations = sensitiveValueViolations(testSpec);
  if (testSpec.assertions.length === 0) {
    violations.push(violation("NO_ASSERTION", "/assertions", "At least one deterministic assertion is required"));
  }
  if (testSpec.policy.approvalRequired && !testSpec.approved) {
    violations.push(violation("APPROVAL_REQUIRED", "/approved", "TestSpec requires approval before execution"));
  }
  if (
    testSpec.environment.operationLevel === "CONTROLLED_WRITE" &&
    !testSpec.preconditions.some(
      (item) =>
        ["SEED", "SEED_API", "SEED_DATABASE"].includes(item.type) &&
        (typeof item.seedRef === "string" || typeof item.strategy === "string"),
    )
  ) {
    violations.push(
      violation(
        "SEED_REQUIRED",
        "/preconditions",
        "Controlled writes require an explicit server-recognized Seed protocol",
      ),
    );
  }
  if (testSpec.environment.operationLevel === "CONTROLLED_WRITE" && !testSpec.cleanup?.strategy) {
    violations.push(
      violation("CLEANUP_REQUIRED", "/cleanup", "Controlled writes require an explicit cleanup strategy"),
    );
  }
  if (testSpec.environment.operationLevel === "DESTRUCTIVE" || testSpec.policy.destructive) {
    violations.push(
      violation("DESTRUCTIVE_BLOCKED", "/environment/operationLevel", "Destructive execution is not enabled"),
    );
  }
  if (testSpec.environment.operationLevel === "EXTERNAL_SIDE_EFFECT" || testSpec.policy.externalSideEffect) {
    violations.push(
      violation(
        "EXTERNAL_SIDE_EFFECT_BLOCKED",
        "/environment/operationLevel",
        "External side effects are not enabled",
      ),
    );
  }

  return deepFreeze({
    valid: !violations.some((item) => item.code === "INVALID_TEST_SPEC" || item.code === "RAW_SECRET_FORBIDDEN"),
    executable: violations.length === 0,
    violations,
  });
}

export function assertTestSpecSafeToStore(testSpec) {
  const rawSecretViolation = sensitiveValueViolations(testSpec)[0];
  if (rawSecretViolation) throw new TypeError(rawSecretViolation.message);
  return testSpec;
}
