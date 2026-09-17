import assert from "node:assert/strict";
import test from "node:test";
import { listWorkspaces, createWorkspace } from "../app/workspace-client.ts";

test("Workspace authentication failures retain their status and request identity, not an empty list", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "A valid API bearer token is required" } }), { status: 401, headers: { "content-type": "application/json", "x-request-id": "entry-401" } }));
  await assert.rejects(listWorkspaces("/api", "", "WEB-OPERATOR"), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHORIZED");
    assert.equal(error.requestId, "entry-401");
    return true;
  });
});

test("Workspace creation surfaces a structured rejection without inventing success", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Permission denied" } }), { status: 403, headers: { "content-type": "application/json" } }));
  await assert.rejects(createWorkspace("/api", "fixture-only", { id: "TEST", name: "Verification", userId: "owner" }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "FORBIDDEN");
    return true;
  });
});

test("an HTML gateway failure is an HTTP failure, not a JSON parse exception", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>upstream unavailable</html>", { status: 502, headers: { "content-type": "text/html" } }));
  await assert.rejects(listWorkspaces("/api", "", "owner"), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /502/);
    return true;
  });
});
