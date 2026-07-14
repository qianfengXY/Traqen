import { contentId, deepFreeze } from "./canonical-json.js";
import { createTestSpec, validateTestSpec } from "./test-spec.js";
import { requireNonEmptyString, requirePositiveInteger } from "./model.js";

const generator = Object.freeze({ id: "confirmed-claim-endpoint-converter", version: "1.0.0" });

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return structuredClone(value);
}

function assertOnlyFields(value, allowedFields, fieldName) {
  const allowed = new Set(allowedFields);
  for (const name of Object.keys(value)) {
    if (!allowed.has(name)) throw new TypeError(`${fieldName}.${name} is not supported`);
  }
}

function normalizeDatabaseVerification(value) {
  if (value === undefined || value === null) return null;
  const verification = requireObject(value, "generation.databaseVerification");
  assertOnlyFields(
    verification,
    ["stepId", "queryRef", "parameters", "assertions"],
    "generation.databaseVerification",
  );
  const stepId = requireNonEmptyString(
    verification.stepId ?? "verify-database",
    "generation.databaseVerification.stepId",
  );
  const queryRef = requireNonEmptyString(
    verification.queryRef,
    "generation.databaseVerification.queryRef",
  );
  if (!Array.isArray(verification.parameters ?? [])) {
    throw new TypeError("generation.databaseVerification.parameters must be an array");
  }
  if (!Array.isArray(verification.assertions) || verification.assertions.length === 0) {
    throw new TypeError("generation.databaseVerification.assertions must be a non-empty array");
  }
  const assertions = verification.assertions.map((input, index) => {
    const assertion = requireObject(input, `generation.databaseVerification.assertions[${index}]`);
    const fieldName = `generation.databaseVerification.assertions[${index}]`;
    const id = requireNonEmptyString(assertion.id, `${fieldName}.id`);
    if (assertion.type === "DATABASE_ROW_COUNT") {
      assertOnlyFields(assertion, ["id", "type", "expected"], fieldName);
      if (!Number.isSafeInteger(assertion.expected) || assertion.expected < 0) {
        throw new TypeError(`${fieldName}.expected must be a non-negative integer`);
      }
      return { id, type: assertion.type, stepId, expected: assertion.expected };
    }
    if (assertion.type === "DATABASE_FIELD") {
      assertOnlyFields(assertion, ["id", "type", "row", "field", "expected"], fieldName);
      const row = assertion.row ?? 0;
      if (!Number.isSafeInteger(row) || row < 0) {
        throw new TypeError(`${fieldName}.row must be a non-negative integer`);
      }
      if (!Object.hasOwn(assertion, "expected")) {
        throw new TypeError(`${fieldName}.expected is required`);
      }
      return {
        id,
        type: assertion.type,
        stepId,
        row,
        field: requireNonEmptyString(assertion.field, `${fieldName}.field`),
        expected: structuredClone(assertion.expected),
      };
    }
    throw new TypeError(`${fieldName}.type must be DATABASE_ROW_COUNT or DATABASE_FIELD`);
  });
  return {
    step: {
      id: stepId,
      executor: "DATABASE",
      queryRef,
      parameters: structuredClone(verification.parameters ?? []),
    },
    assertions,
  };
}

function bindEndpointPath(path, input) {
  const names = [...path.matchAll(/\{([^/{}/]+)\}/g)].map((match) => match[1]);
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) {
    if (input !== undefined && (input === null || typeof input !== "object" || Object.keys(input).length > 0)) {
      throw new TypeError("generation.pathParameters must be omitted for a path without placeholders");
    }
    return path;
  }
  if (input === undefined || input === null) {
    throw new TypeError(
      `generation.pathParameters.${uniqueNames[0]} must bind the endpoint placeholder`,
    );
  }
  const parameters = requireObject(input, "generation.pathParameters");
  assertOnlyFields(parameters, uniqueNames, "generation.pathParameters");
  for (const name of uniqueNames) {
    const value = parameters[name];
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "") {
      throw new TypeError(`generation.pathParameters.${name} must bind the endpoint placeholder`);
    }
  }
  return path.replace(/\{([^/{}/]+)\}/g, (_match, name) => String(parameters[name]));
}

export function generateEndpointTestSpecDraft(input, clock = () => new Date()) {
  const claim = requireObject(input?.claim, "generation.claim");
  const decision = requireObject(input?.decision, "generation.decision");
  const mapping = requireObject(input?.mapping, "generation.mapping");
  const endpoint = requireObject(input?.endpoint, "generation.endpoint");
  if (claim.type !== "NORMATIVE_REQUIREMENT") {
    throw new TypeError("Only a normative Claim can be converted into a TestSpec");
  }
  if (!["CONFIRMED", "EXCEPTION_RECORDED"].includes(decision.type)) {
    throw new TypeError("TestSpec conversion requires a currently authorized Claim Decision");
  }
  if (
    claim.constraint?.dimension !== "endpointExposed" ||
    claim.constraint?.operator !== "EQUALS" ||
    claim.constraint?.value !== true
  ) {
    throw new TypeError("The endpoint converter only supports endpointExposed EQUALS true Claims");
  }
  if (endpoint.type !== "ENDPOINT") throw new TypeError("generation.endpoint must be an ENDPOINT Fact");
  if (!mapping.factRefs?.some((reference) => reference.factId === endpoint.factId)) {
    throw new TypeError("The selected Endpoint Fact is not part of the Claim implementation mapping");
  }
  const method = requireNonEmptyString(endpoint.attributes?.method, "generation.endpoint.attributes.method").toUpperCase();
  const path = requireNonEmptyString(endpoint.attributes?.path, "generation.endpoint.attributes.path");
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Endpoint Fact path must be an origin-relative path");
  }
  const executablePath = bindEndpointPath(path, input.pathParameters);
  requireNonEmptyString(input.projectId, "generation.projectId");
  const expectedHttpStatus = requirePositiveInteger(
    input.expectedHttpStatus,
    "generation.expectedHttpStatus",
  );
  if (expectedHttpStatus < 100 || expectedHttpStatus > 599) {
    throw new RangeError("generation.expectedHttpStatus must be between 100 and 599");
  }
  const safeRead = ["GET", "HEAD"].includes(method);
  const databaseVerification = normalizeDatabaseVerification(input.databaseVerification);
  const requestFingerprint = contentId("TEST-SPEC-GENERATION-REQUEST", {
    projectId: input.projectId,
    featureId: claim.featureId,
    claimId: claim.id,
    claimVersion: claim.version,
    decisionId: decision.id,
    mappingId: mapping.id,
    endpointFactId: endpoint.factId,
    testSpecId: input.id,
    target: input.target,
    expectedHttpStatus,
    variables: input.variables ?? {},
    headers: input.headers ?? {},
    body: input.body ?? null,
    cleanup: input.cleanup ?? null,
    pathParameters: input.pathParameters ?? null,
    databaseVerification: input.databaseVerification ?? null,
  });
  const draft = createTestSpec({
    id: requireNonEmptyString(input.id, "generation.id"),
    version: 1,
    name: input.name ?? `Verify ${method} ${path}`,
    risk: input.risk ?? (safeRead ? "LOW" : "HIGH"),
    approved: false,
    approval: null,
    featureId: claim.featureId,
    verifiesClaims: [{ id: claim.id, version: claim.version }],
    sourceSnapshotId: mapping.snapshotManifestId,
    origin: {
      type: "CONFIRMED_CLAIM_CONVERSION",
      claimRef: { id: claim.id, version: claim.version },
      decisionId: decision.id,
      mappingId: mapping.id,
      factIds: [endpoint.factId],
      generator,
      requestFingerprint,
    },
    environment: {
      target: requireNonEmptyString(input.target, "generation.target"),
      operationLevel: safeRead ? "SAFE_READ" : "CONTROLLED_WRITE",
    },
    preconditions: input.preconditions ?? [],
    variables: input.variables ?? {},
    steps: [
      {
        id: "invoke-endpoint",
        executor: "HTTP",
        method,
        path: executablePath,
        headers: input.headers ?? {},
        ...(input.body === undefined ? {} : { body: structuredClone(input.body) }),
      },
      ...(databaseVerification ? [databaseVerification.step] : []),
    ],
    assertions: [
      {
        id: "endpoint-http-status",
        type: "HTTP_STATUS",
        stepId: "invoke-endpoint",
        expected: expectedHttpStatus,
      },
      ...(databaseVerification?.assertions ?? []),
    ],
    cleanup: input.cleanup ?? null,
    policy: {
      approvalRequired: true,
      destructive: false,
      externalSideEffect: false,
    },
  }, clock);
  return deepFreeze({
    draft,
    validation: validateTestSpec(draft, clock),
    generation: {
      requestFingerprint,
      generator,
      source: {
        claimId: claim.id,
        claimVersion: claim.version,
        decisionId: decision.id,
        mappingId: mapping.id,
        endpointFactId: endpoint.factId,
      },
    },
  });
}
