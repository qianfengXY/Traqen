import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFactsClient } from "../app/deterministic-facts/client.ts";
import { setSessionProof } from "../app/auth-client.ts";

test("technical evidence consumes the main cookie session and antiforgery proof, without a second token", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; setSessionProof(""); });
  let request;
  globalThis.fetch = async (_url, init) => { request = init; return Response.json({ schemaVersion: 1 }); };
  setSessionProof("same-session-proof");
  await new DeterministicFactsClient("/api", "", "workspace").request("/runs", "POST", { operationId: "one" });
  assert.equal(request.credentials, "same-origin");
  assert.equal(new Headers(request.headers).get("x-traqen-csrf"), "same-session-proof");
  assert.equal(new Headers(request.headers).has("authorization"), false);
});
