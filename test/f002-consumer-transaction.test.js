import assert from "node:assert/strict";
import test from "node:test";
import { F002RequestService } from "../src/deterministic-facts/request-service.js";

const actor = { actorId: "owner", tenantId: "tenant" }, workspaceId = "workspace", baseVersionId = "a".repeat(64);
for (const operation of ["preview", "get", "list", "find"]) test(`F002 passes the owning transaction to trusted consumer ${operation} checks`, async () => {
  const row = { id: "request-1", workspace_id: workspaceId, investigation_id: "investigation-1", base_version_id: baseVersionId };
  const tx = { query: async () => ({ rows: [row] }) };
  let checked = 0;
  const check = options => { checked++; assert.equal(options?.tx, tx, "consumer must not open a nested transaction while the Workspace lock is held"); return null; };
  const service = new F002RequestService({ withAuthorizedWorkspace: async (_a, _w, callback) => callback(tx), withMaintainedWorkspace: async () => {} }, {
    resolver: { resolve: async (_a, _w, _i, options) => check(options), authorizeRead: async (_a, _w, _i, _r, options) => check(options) },
  });
  const action = operation === "preview" ? () => service.investigation(actor, workspaceId, "investigation-1", baseVersionId)
    : operation === "get" ? () => service.get(actor, workspaceId, row.id)
      : operation === "find" ? () => service.findByOperation(actor, workspaceId, "operation-1")
        : () => service.list(actor, workspaceId, { investigationId: "investigation-1", baseVersionId, cursor: row.id });
  await assert.rejects(action, { code: "F002_CONSUMER_REJECTED" });
  assert.equal(checked, 1);
});
