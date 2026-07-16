import assert from "node:assert/strict";
import test from "node:test";

import { createProjectFoundation } from "../src/domain/index.js";

test("project foundation derives tenant boundaries and validates principals", () => {
  const foundation = createProjectFoundation({
    organization: { id: "ORG-001", name: "Example organization" },
    tenant: { id: "TENANT-001", name: "Example tenant" },
    project: { id: "PROJECT-001", name: "Order platform" },
    principals: [
      { id: "USER-001", type: "user", displayName: "Business owner" },
      { id: "RUNNER-001", type: "runner", displayName: "Project Runner" },
    ],
  });

  assert.equal(foundation.tenant.organizationId, "ORG-001");
  assert.equal(foundation.project.tenantId, "TENANT-001");
  assert.equal(foundation.project.status, "ACTIVE");
  assert.deepEqual(foundation.principals.map((item) => item.type), ["RUNNER", "USER"]);
  assert.equal(Object.isFrozen(foundation), true);
  assert.throws(
    () => createProjectFoundation({
      organization: { id: "ORG-001", name: "Org" },
      tenant: { id: "TENANT-001", name: "Tenant" },
      project: { id: "PROJECT-001", name: "Project" },
      principals: [
        { id: "USER-001", type: "USER", displayName: "One" },
        { id: "USER-001", type: "USER", displayName: "Duplicate" },
      ],
    }),
    /unique ids/,
  );
});
