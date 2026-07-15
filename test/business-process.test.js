import assert from "node:assert/strict";
import test from "node:test";

import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createBusinessProcessModel, createFeatureGraphProjection } from "../src/domain/index.js";
import { MemoryTraceabilityStore, ReviewAuthorizationError } from "../src/storage/index.js";

const fixedClock = () => new Date("2026-07-15T08:00:00.000Z");

function processInput() {
  return {
    id: "PROCESS-ORDER-SUBMIT",
    version: 1,
    featureVersion: 1,
    name: "Submit order lifecycle",
    actors: [{ id: "ACTOR-BUYER", name: "Buyer", role: "order-owner" }],
    states: [
      { id: "STATE-DRAFT", name: "Draft", kind: "INITIAL" },
      { id: "STATE-SUBMITTED", name: "Submitted", kind: "TERMINAL" },
      { id: "STATE-REJECTED", name: "Rejected", kind: "EXCEPTION" },
    ],
    transitions: [
      {
        id: "TRANSITION-SUBMIT",
        name: "Submit draft order",
        fromStateId: "STATE-DRAFT",
        toStateId: "STATE-SUBMITTED",
        trigger: "POST /orders/{id}/submit",
        actorIds: ["ACTOR-BUYER"],
        guards: ["order.status = DRAFT", "order.owner = actor"],
      },
      {
        id: "TRANSITION-REJECT",
        name: "Reject invalid order",
        fromStateId: "STATE-DRAFT",
        toStateId: "STATE-REJECTED",
        trigger: "validation failure",
        actorIds: ["ACTOR-BUYER"],
        exception: "The order remains unchanged and the rejection reason is returned.",
      },
    ],
    designElements: [{ id: "DESIGN-TRANSACTION", name: "Atomic submit", type: "TRANSACTION" }],
    authority: { rationale: "Product owner confirms roles, guards, state changes, and exception behavior." },
  };
}

test("business process models reject disconnected or self-looping state declarations", () => {
  assert.throws(
    () => createBusinessProcessModel({
      ...processInput(),
      featureId: "FEATURE-ORDER-SUBMIT",
      authority: { ...processInput().authority, actorId: "OWNER-001", actorRole: "business-owner" },
      states: [...processInput().states, { id: "STATE-ORPHAN", name: "Orphan", kind: "INTERMEDIATE" }],
    }, fixedClock),
    /unreachable states: STATE-ORPHAN/,
  );
  assert.throws(
    () => createBusinessProcessModel({
      ...processInput(),
      featureId: "FEATURE-ORDER-SUBMIT",
      authority: { ...processInput().authority, actorId: "OWNER-001", actorRole: "business-owner" },
      transitions: [{ ...processInput().transitions[0], toStateId: "STATE-DRAFT" }],
    }, fixedClock),
    /must change business state/,
  );
});

test("only an authorized human can append an immutable process model and project it as a business flow", async () => {
  const store = new MemoryTraceabilityStore();
  let reviewer = { actorId: "OWNER-001", actorRole: "business-owner" };
  const application = new TraceabilityApplication({
    store,
    clock: fixedClock,
    reviewerResolver: () => reviewer,
    reviewPolicyResolver: () => ({ allowedProcessModelRoles: ["business-owner"] }),
  });
  await application.createProject({
    organization: { id: "ORG-001", name: "Traqen" },
    tenant: { id: "TENANT-001", name: "Default" },
    project: { id: "PROJECT-001", name: "Orders" },
    principals: [{ id: "OWNER-001", type: "USER", displayName: "Business owner" }],
  });
  await application.appendFeatureVersion("PROJECT-001", {
    id: "FEATURE-ORDER-SUBMIT",
    version: 1,
    name: "Submit order",
  });
  const model = await application.appendBusinessProcessModel(
    "PROJECT-001",
    "FEATURE-ORDER-SUBMIT",
    processInput(),
  );
  assert.equal(model.authority.actorId, "OWNER-001");
  assert.equal((await application.getFeatureBaseline("PROJECT-001", "FEATURE-ORDER-SUBMIT")).processModel.id, model.id);

  const graph = createFeatureGraphProjection({
    feature: { id: "FEATURE-ORDER-SUBMIT", version: 1, name: "Submit order" },
    processModel: model,
    processImplementationFacts: [],
    snapshotManifest: { id: "SNAPSHOT-001" },
    claims: [],
    traceChains: [],
  }, { view: "business", depth: 8, limit: 100 });
  assert.ok(graph.nodes.some((node) => node.type === "ACTOR_ROLE"));
  assert.ok(graph.nodes.some((node) => node.type === "BUSINESS_STATE"));
  assert.ok(graph.nodes.some((node) => node.type === "STATE_TRANSITION"));
  assert.ok(graph.edges.some((edge) => edge.type === "TRANSITIONS_TO"));

  reviewer = { actorId: "OWNER-001", actorRole: "developer" };
  await assert.rejects(
    application.appendBusinessProcessModel("PROJECT-001", "FEATURE-ORDER-SUBMIT", { ...processInput(), version: 2 }),
    ReviewAuthorizationError,
  );
});

test("a process model cannot claim an implementation Fact absent from its referenced Snapshot", async () => {
  const store = {
    async getSnapshotManifest() { return { id: "SNAPSHOT-001" }; },
    async getFactGraphByReferences() {
      return { nodes: [], edges: [], missingFactRefs: ["FACT-MISSING"] };
    },
    async appendBusinessProcessModel() {
      assert.fail("an invalid implementation mapping must not be persisted");
    },
  };
  const application = new TraceabilityApplication({
    store,
    clock: fixedClock,
    reviewerResolver: () => ({ actorId: "OWNER-001", actorRole: "business-owner" }),
    reviewPolicyResolver: () => ({ allowedProcessModelRoles: ["business-owner"] }),
  });
  const input = processInput();
  input.transitions[0].implementationFactRefs = [{
    snapshotManifestId: "SNAPSHOT-001",
    factId: "FACT-MISSING",
  }];
  await assert.rejects(
    application.appendBusinessProcessModel("PROJECT-001", "FEATURE-ORDER-SUBMIT", input),
    /FACT-MISSING/,
  );
});
