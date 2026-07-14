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
  requireNonEmptyString(input.projectId, "generation.projectId");
  const expectedHttpStatus = requirePositiveInteger(
    input.expectedHttpStatus,
    "generation.expectedHttpStatus",
  );
  if (expectedHttpStatus < 100 || expectedHttpStatus > 599) {
    throw new RangeError("generation.expectedHttpStatus must be between 100 and 599");
  }
  const safeRead = ["GET", "HEAD"].includes(method);
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
    steps: [{
      id: "invoke-endpoint",
      executor: "HTTP",
      method,
      path,
      headers: input.headers ?? {},
      ...(input.body === undefined ? {} : { body: structuredClone(input.body) }),
    }],
    assertions: [{
      id: "endpoint-http-status",
      type: "HTTP_STATUS",
      stepId: "invoke-endpoint",
      expected: expectedHttpStatus,
    }],
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
