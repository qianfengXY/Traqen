import assert from "node:assert/strict";
import test from "node:test";
import { listWorkspaces, createWorkspace } from "../app/workspace-client.ts";
import { getConnectionHealth, listGlobalCliModels, listGlobalAccounts, listGlobalCapabilities, listWorkspaceExecutableSkills, listGlobalCapabilityTemplates } from "../app/product-foundation-client.ts";

test("connection reads pass cancellation through to fetch", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    return new Response(JSON.stringify({ workspaces: [], models: [], accounts: [], capabilities: [], skills: [], templates: [] }));
  });
  await listWorkspaces("/api", "", "owner", controller.signal);
  await getConnectionHealth("/api", controller.signal);
  for (const read of [listGlobalCliModels, listGlobalAccounts, listGlobalCapabilities, listWorkspaceExecutableSkills, listGlobalCapabilityTemplates]) await read("/api", "", controller.signal);
});

test("cancelled Workspace body consumption cannot publish a successful list", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => {
    controller.abort();
    return { workspaces: [] };
  } }));
  await assert.rejects(listWorkspaces("/api", "", "owner", controller.signal), { name: "AbortError" });
});

test("cancelled auxiliary body consumption cannot publish a successful catalog", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => {
    controller.abort();
    return { skills: [] };
  } }));
  await assert.rejects(listWorkspaceExecutableSkills("/api", "", controller.signal), { name: "AbortError" });
});

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
