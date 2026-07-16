import assert from "node:assert/strict";
import test from "node:test";

import {
  createClaim,
  createClaimScope,
  createDecision,
  createFeatureVersion,
} from "../src/domain/index.js";

const fixedClock = () => new Date("2026-07-14T05:00:00.000Z");

test("governance factories create immutable versioned records", () => {
  const feature = createFeatureVersion({ id: "FEATURE-001", version: 1, name: "Submit order" }, fixedClock);
  const scope = createClaimScope(
    { id: "SCOPE-001", version: 1, scope: { actor: "normal-user" } },
    fixedClock,
  );
  const claim = createClaim(
    {
      id: "CLAIM-001",
      version: 1,
      featureId: feature.id,
      type: "NORMATIVE_REQUIREMENT",
      statement: "A normal user may submit only a DRAFT order.",
      sourceType: "HUMAN",
      evidenceSupport: "MULTI_SOURCE",
      constraint: { dimension: "requiredState", operator: "EQUALS", value: "DRAFT" },
      scopeId: scope.id,
      scopeVersion: scope.version,
    },
    fixedClock,
  );

  assert.equal(Object.isFrozen(feature), true);
  assert.equal(Object.isFrozen(scope.scope), true);
  assert.equal(Object.isFrozen(claim.provenance), true);
  assert.equal(claim.createdAt, "2026-07-14T05:00:00.000Z");
  assert.deepEqual(claim.constraint, { dimension: "requiredState", operator: "EQUALS", value: "DRAFT" });
});

test("decision creation deduplicates evidence references without changing the claim", () => {
  const decision = createDecision(
    {
      id: "DECISION-001",
      claimId: "CLAIM-001",
      claimVersion: 1,
      scopeId: "SCOPE-001",
      scopeVersion: 1,
      type: "CONFIRMED",
      actorId: "USER-001",
      actorRole: "business-owner",
      evidenceRefs: ["EVIDENCE-A", "EVIDENCE-A"],
    },
    fixedClock,
  );

  assert.deepEqual(decision.evidenceRefs, ["EVIDENCE-A"]);
  assert.equal(decision.type, "CONFIRMED");
});

test("governance records reject invalid enums and effective windows", () => {
  assert.throws(
    () =>
      createClaim(
        {
          id: "CLAIM-001",
          version: 1,
          featureId: "FEATURE-001",
          type: "BUSINESS_TRUTH",
          statement: "Invalid",
          sourceType: "HUMAN",
          evidenceSupport: "NONE",
          scopeId: "SCOPE-001",
          scopeVersion: 1,
        },
        fixedClock,
      ),
    /claim.type must be one of/,
  );
  assert.throws(
    () =>
      createClaimScope(
        {
          id: "SCOPE-001",
          version: 1,
          scope: {},
          effectiveFrom: "2026-07-15T00:00:00.000Z",
          effectiveTo: "2026-07-14T00:00:00.000Z",
        },
        fixedClock,
      ),
    /effectiveFrom must be earlier/,
  );
});
