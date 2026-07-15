import {
  AuthorityStatus,
  ClaimType,
  ConformanceStatus,
  EvidenceFreshness,
  EvidenceSupport,
  GapSeverity,
  IntegrityStatus,
  TraceGapType,
  VerificationStatus,
  assertEnum,
  hasItems,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";
import { contentId } from "./canonical-json.js";

const ownerByGap = Object.freeze({
  [TraceGapType.MISSING_NORMATIVE_CLAIM]: "business-owner",
  [TraceGapType.MISSING_AUTHORITY]: "business-owner",
  [TraceGapType.SCOPE_UNKNOWN]: "product-owner",
  [TraceGapType.SNAPSHOT_INCOMPLETE]: "platform-operator",
  [TraceGapType.IMPLEMENTATION_UNMAPPED]: "technical-owner",
  [TraceGapType.CONFORMANCE_UNKNOWN]: "technical-owner",
  [TraceGapType.CONFORMANCE_STALE]: "technical-owner",
  [TraceGapType.IMPLEMENTATION_DEVIATES]: "technical-owner",
  [TraceGapType.UNRESOLVED_CONFLICT]: "claim-owner",
  [TraceGapType.NO_TEST_SPEC]: "quality-owner",
  [TraceGapType.TEST_SPEC_NOT_LINKED]: "quality-owner",
  [TraceGapType.TEST_SPEC_UNAPPROVED]: "quality-owner",
  [TraceGapType.NO_ASSERTION]: "quality-owner",
  [TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT]: "quality-owner",
  [TraceGapType.VERIFICATION_FAILED]: "technical-owner",
  [TraceGapType.EXECUTION_ERROR]: "platform-operator",
  [TraceGapType.VERIFICATION_INCONCLUSIVE]: "quality-owner",
  [TraceGapType.EVIDENCE_MISSING]: "quality-owner",
  [TraceGapType.EVIDENCE_UNVERIFIED]: "security-owner",
  [TraceGapType.EVIDENCE_EXPIRING]: "quality-owner",
  [TraceGapType.EVIDENCE_STALE]: "quality-owner",
});

function gap(type, message, severity = GapSeverity.BLOCKING) {
  return Object.freeze({
    type,
    severity,
    ownerRole: ownerByGap[type],
    message,
  });
}

function implementationMapped(implementation) {
  if (implementation === null || typeof implementation !== "object") {
    return false;
  }
  return ["endpoints", "codeSymbols", "dataObjects", "configurations", "dependencies"].some((key) =>
    hasItems(implementation[key]),
  );
}

function traceNode(type, value, fallbackId) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      type,
      id: value.id ?? value.factId ?? value.naturalKey ?? fallbackId,
      version: value.version ?? null,
    };
  }
  return { type, id: value === undefined || value === null ? fallbackId : String(value), version: null };
}

function createSegments(input, chainId, identity, conformance, executionIsCurrent) {
  const segments = [];
  const append = (from, relation, to, provenance, status = "ACTIVE") => {
    segments.push(Object.freeze({
      id: contentId("TRACE-SEGMENT", { chainId, from, relation, to }),
      from,
      relation,
      to,
      provenance,
      status,
    }));
  };
  const feature = traceNode("FEATURE", input.feature, identity.featureId);
  const claim = traceNode("CLAIM", input.claim, identity.claimId);
  append(feature, "HAS_RULE", claim, "GOVERNED_BASELINE");
  if (input.decision?.id) {
    append(
      claim,
      "CONFIRMED_BY",
      traceNode("DECISION", input.decision, input.decision.id),
      "AUTHORIZED_HUMAN_DECISION",
      [AuthorityStatus.CONFIRMED, AuthorityStatus.EXCEPTION_RECORDED].includes(input.claim.authorityStatus)
        ? "ACTIVE"
        : "PENDING",
    );
  }
  if (input.scope?.id) {
    append(claim, "APPLIES_IN", traceNode("CLAIM_SCOPE", input.scope, identity.scopeId), "GOVERNED_BASELINE");
  }
  if (input.conformance) {
    const conformanceNode = traceNode(
      "IMPLEMENTATION_CONFORMANCE",
      input.conformance,
      contentId("CONFORMANCE-REF", {
        claimId: identity.claimId,
        claimVersion: identity.claimVersion,
        snapshotManifestId: identity.snapshotManifestId,
      }),
    );
    append(
      claim,
      "ASSESSED_BY",
      conformanceNode,
      input.conformance.analysisMethod?.type ?? "CONFORMANCE_ASSESSMENT",
      conformance === ConformanceStatus.STALE ? "STALE" : "ACTIVE",
    );
    if (conformance === ConformanceStatus.CONFORMS) {
      append(conformanceNode, "CONFORMS_TO", claim, "DETERMINISTIC_CONFORMANCE", "ACTIVE");
    } else if ([ConformanceStatus.DEVIATES, ConformanceStatus.PARTIAL].includes(conformance)) {
      append(conformanceNode, "DEVIATES_FROM", claim, "DETERMINISTIC_CONFORMANCE", "ACTIVE");
    }
  }
  const implementationRelations = {
    endpoints: ["ENDPOINT", "EXPOSED_BY"],
    codeSymbols: ["CODE_SYMBOL", "IMPLEMENTED_BY"],
    dataObjects: ["DATA_OBJECT", "USES_DATA"],
    configurations: ["CONFIGURATION", "CONTROLLED_BY"],
    dependencies: ["EXTERNAL_DEPENDENCY", "DEPENDS_ON"],
  };
  for (const [collection, [type, relation]] of Object.entries(implementationRelations)) {
    for (const [index, item] of (input.implementation?.[collection] ?? []).entries()) {
      append(
        claim,
        relation,
        traceNode(type, item, `${type}-${index + 1}`),
        item?.extractor ? "DETERMINISTIC_FACT" : "IMPLEMENTATION_MAPPING",
        input.implementationStatus === "STALE" ? "STALE" : "ACTIVE",
      );
    }
  }
  if (input.testSpec?.id) {
    const testSpec = traceNode("TEST_SPEC", input.testSpec, input.testSpec.id);
    append(claim, "VERIFIED_BY", testSpec, "APPROVED_TEST_SPEC", input.testSpec.approved ? "ACTIVE" : "PENDING");
    const assertions = (input.testSpec.assertions ?? []).map((assertion, index) =>
      traceNode("TEST_ASSERTION", assertion, `${input.testSpec.id}:ASSERTION:${index + 1}`));
    for (const assertion of assertions) {
      append(testSpec, "HAS_ASSERTION", assertion, "DETERMINISTIC_ASSERTION", input.testSpec.approved ? "ACTIVE" : "PENDING");
    }
    if (input.execution?.id) {
      const execution = traceNode("TEST_EXECUTION", input.execution, input.execution.id);
      append(testSpec, "EXECUTED_AS", execution, "ATTESTED_RUNNER", executionIsCurrent ? "ACTIVE" : "STALE");
      for (const assertion of assertions) {
        append(assertion, "EVALUATED_IN", execution, "DETERMINISTIC_ASSERTION_RESULT", executionIsCurrent ? "ACTIVE" : "STALE");
      }
      for (const [index, evidence] of (input.evidence ?? []).entries()) {
        if (evidence.executionId !== input.execution.id) continue;
        append(
          execution,
          "PROVED_BY",
          traceNode("EVIDENCE", evidence, `EVIDENCE-${index + 1}`),
          evidence.integrity === IntegrityStatus.VERIFIED ? "VERIFIED_EVIDENCE" : "UNVERIFIED_EVIDENCE",
          evidence.freshness === EvidenceFreshness.STALE ? "STALE" : "ACTIVE",
        );
      }
    }
  }
  return Object.freeze(segments);
}

function addConformanceGaps(input, currentIdentity, gaps) {
  const status = input.conformance?.status ?? ConformanceStatus.UNKNOWN;
  assertEnum(ConformanceStatus, status, "conformance.status");
  const conformanceIsCurrent =
    input.conformance?.claimId === currentIdentity.claimId &&
    input.conformance?.claimVersion === currentIdentity.claimVersion &&
    input.conformance?.scopeId === currentIdentity.scopeId &&
    input.conformance?.snapshotManifestId === currentIdentity.snapshotManifestId;
  const effectiveStatus = status !== ConformanceStatus.UNKNOWN && !conformanceIsCurrent
    ? ConformanceStatus.STALE
    : status;

  if (effectiveStatus === ConformanceStatus.UNKNOWN) {
    gaps.push(gap(TraceGapType.CONFORMANCE_UNKNOWN, "Implementation conformance has not been established."));
  } else if (effectiveStatus === ConformanceStatus.STALE) {
    gaps.push(gap(TraceGapType.CONFORMANCE_STALE, "Implementation conformance is stale for the selected manifest."));
  } else if ([ConformanceStatus.DEVIATES, ConformanceStatus.PARTIAL].includes(effectiveStatus)) {
    gaps.push(gap(TraceGapType.IMPLEMENTATION_DEVIATES, `Implementation conformance is ${effectiveStatus}.`));
  } else if (effectiveStatus === ConformanceStatus.CONFLICTED) {
    gaps.push(gap(TraceGapType.UNRESOLVED_CONFLICT, "Implementation evidence is conflicted."));
  }

  return effectiveStatus;
}

function addVerificationGaps(status, gaps) {
  if (status === VerificationStatus.PASS) return;

  const mappings = {
    [VerificationStatus.FAIL]: [TraceGapType.VERIFICATION_FAILED, "Verification failed."],
    [VerificationStatus.ERROR]: [TraceGapType.EXECUTION_ERROR, "Execution failed before product correctness could be determined."],
    [VerificationStatus.INCONCLUSIVE]: [TraceGapType.VERIFICATION_INCONCLUSIVE, "Evidence is insufficient for a verdict."],
    [VerificationStatus.SKIPPED]: [TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT, "Verification was skipped."],
    [VerificationStatus.CANCELLED]: [TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT, "Verification was cancelled."],
    [VerificationStatus.NOT_RUN]: [TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT, "Verification has not run."],
  };
  const [type, message] = mappings[status];
  gaps.push(gap(type, message));
}

export function evaluateTraceChain(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("trace-chain input must be an object");
  }

  const featureId = requireNonEmptyString(input.feature?.id, "feature.id");
  const claimId = requireNonEmptyString(input.claim?.id, "claim.id");
  const claimVersion = requirePositiveInteger(input.claim?.version, "claim.version");
  const claimType = assertEnum(ClaimType, input.claim.type, "claim.type");
  const authority = assertEnum(
    AuthorityStatus,
    input.claim.authorityStatus ?? AuthorityStatus.UNREVIEWED,
    "claim.authorityStatus",
  );
  const gaps = [];

  if (claimType !== ClaimType.NORMATIVE_REQUIREMENT) {
    gaps.push(gap(TraceGapType.MISSING_NORMATIVE_CLAIM, "Trace proof must start from a normative business claim."));
  }

  if (![AuthorityStatus.CONFIRMED, AuthorityStatus.EXCEPTION_RECORDED].includes(authority)) {
    gaps.push(gap(TraceGapType.MISSING_AUTHORITY, `Normative claim authority is ${authority}.`));
  }

  if (!input.scope?.id) {
    gaps.push(gap(TraceGapType.SCOPE_UNKNOWN, "Claim scope has not been defined."));
  }

  if (!input.snapshotManifest?.complete) {
    gaps.push(gap(TraceGapType.SNAPSHOT_INCOMPLETE, "Snapshot manifest is missing components or contains failed sources."));
  }

  if (!implementationMapped(input.implementation)) {
    gaps.push(gap(TraceGapType.IMPLEMENTATION_UNMAPPED, "No technical implementation is mapped to the claim."));
  }

  const currentIdentity = {
    claimId,
    claimVersion,
    scopeId: input.scope?.id ?? null,
    snapshotManifestId: input.snapshotManifest?.id ?? null,
  };
  const conformance = addConformanceGaps(input, currentIdentity, gaps);

  const testSpec = input.testSpec;
  if (!testSpec?.id) {
    gaps.push(gap(TraceGapType.NO_TEST_SPEC, "No TestSpec verifies this claim."));
  } else {
    const verifiesCurrentClaim = testSpec.verifiesClaims?.some(
      (claim) => claim.id === claimId && claim.version === claimVersion,
    );
    if (!verifiesCurrentClaim) {
      gaps.push(gap(TraceGapType.TEST_SPEC_NOT_LINKED, "TestSpec does not declare that it verifies this claim."));
    }
    if (!testSpec.approved) {
      gaps.push(gap(TraceGapType.TEST_SPEC_UNAPPROVED, "TestSpec has not been approved."));
    }
    if (!hasItems(testSpec.assertions)) {
      gaps.push(gap(TraceGapType.NO_ASSERTION, "TestSpec has no deterministic business assertion."));
    }
  }

  const execution = input.execution;
  const deploymentMatches =
    execution?.deploymentId && execution.deploymentId === input.snapshotManifest?.components?.deployment?.id;
  const manifestMatches =
    execution?.snapshotManifestId && execution.snapshotManifestId === input.snapshotManifest?.id;
  const testSpecMatches =
    testSpec?.id &&
    execution?.testSpecId === testSpec.id &&
    execution?.testSpecVersion === testSpec.version;
  const executionIsCurrent = Boolean(execution?.id && deploymentMatches && manifestMatches && testSpecMatches);
  let verification = VerificationStatus.NOT_RUN;

  if (!executionIsCurrent) {
    gaps.push(
      gap(
        TraceGapType.NOT_EXECUTED_ON_CURRENT_DEPLOYMENT,
        "No execution proves the selected deployment, snapshot manifest, and TestSpec version.",
      ),
    );
  } else {
    verification = assertEnum(VerificationStatus, execution.status, "execution.status");
    addVerificationGaps(verification, gaps);
  }

  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((item) => item.executionId === execution?.id)
    : [];
  let freshness = EvidenceFreshness.INCOMPLETE;

  if (!hasItems(evidence)) {
    gaps.push(gap(TraceGapType.EVIDENCE_MISSING, "No Evidence is linked to the selected execution."));
  } else {
    const invalidIntegrity = evidence.some(
      (item) => assertEnum(IntegrityStatus, item.integrity, "evidence.integrity") !== IntegrityStatus.VERIFIED,
    );
    if (invalidIntegrity) {
      gaps.push(gap(TraceGapType.EVIDENCE_UNVERIFIED, "At least one Evidence item has not passed integrity verification."));
    }

    const evidenceFreshness = evidence.map((item) =>
      assertEnum(EvidenceFreshness, item.freshness, "evidence.freshness"),
    );
    freshness = !executionIsCurrent
      ? EvidenceFreshness.STALE
      : evidenceFreshness.includes(EvidenceFreshness.STALE)
      ? EvidenceFreshness.STALE
      : evidenceFreshness.includes(EvidenceFreshness.INCOMPLETE)
        ? EvidenceFreshness.INCOMPLETE
        : evidenceFreshness.includes(EvidenceFreshness.EXPIRING)
          ? EvidenceFreshness.EXPIRING
          : EvidenceFreshness.FRESH;
    if (freshness === EvidenceFreshness.EXPIRING) {
      gaps.push(
        gap(
          TraceGapType.EVIDENCE_EXPIRING,
          "Evidence is still valid but is approaching its freshness limit.",
          GapSeverity.WARNING,
        ),
      );
    } else if (freshness !== EvidenceFreshness.FRESH) {
      gaps.push(gap(TraceGapType.EVIDENCE_STALE, `Evidence freshness is ${freshness}.`));
    }
  }

  if (hasItems(input.conflicts)) {
    gaps.push(gap(TraceGapType.UNRESOLVED_CONFLICT, "The trace chain contains unresolved conflicts."));
  }

  const uniqueGaps = [...new Map(gaps.map((item) => [item.type, item])).values()];
  const dimensions = Object.freeze({
    authority,
    evidenceSupport: assertEnum(
      EvidenceSupport,
      input.claim.evidenceSupport ?? EvidenceSupport.NONE,
      "claim.evidenceSupport",
    ),
    conformance,
    verification,
    freshness,
    conflict: hasItems(input.conflicts) ? "UNRESOLVED" : "NONE",
  });
  const identity = {
    featureId,
    claimId,
    claimVersion,
    scopeId: input.scope?.id ?? null,
    snapshotManifestId: input.snapshotManifest?.id ?? null,
    deploymentId: input.snapshotManifest?.components?.deployment?.id ?? null,
  };
  const chainId = contentId("TRACE-CHAIN", identity);
  const segments = createSegments(input, chainId, identity, conformance, executionIsCurrent);
  const conflicts = Object.freeze(
    (input.conflicts ?? []).map((conflict, index) => Object.freeze(
      typeof conflict === "string"
        ? { id: conflict, type: "UNSPECIFIED", status: "OPEN", reason: null }
        : {
            id: conflict.id ?? contentId("TRACE-CONFLICT", { chainId, index, conflict }),
            type: conflict.type ?? "UNSPECIFIED",
            status: conflict.status ?? "OPEN",
            reason: conflict.reason ?? null,
          },
    )),
  );

  return Object.freeze({
    id: chainId,
    ...identity,
    dimensions,
    stages: Object.freeze([
      { name: "BUSINESS_INTENT", status: authority },
      { name: "SCOPE", status: input.scope?.id ? "DEFINED" : "UNKNOWN" },
      { name: "IMPLEMENTATION_CONFORMANCE", status: conformance },
      { name: "TECHNICAL_IMPLEMENTATION", status: implementationMapped(input.implementation) ? "MAPPED" : "UNMAPPED" },
      { name: "TEST_SPEC", status: testSpec?.approved ? "APPROVED" : testSpec?.id ? "UNAPPROVED" : "MISSING" },
      { name: "EXECUTION", status: verification },
      { name: "EVIDENCE", status: freshness },
    ]),
    segments,
    conflicts,
    complete: !uniqueGaps.some((item) => item.severity === GapSeverity.BLOCKING),
    gaps: Object.freeze(uniqueGaps),
    computedAt: clock().toISOString(),
  });
}
