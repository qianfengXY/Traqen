import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceTruthAuthenticator } from "../src/source-truth/authentication.js";

const token = "isolated-test-identity-token-not-a-production-key";
const members = [{ tokenDigest: createHash("sha256").update(token).digest("hex"), actorId: "owner", tenantId: "tenant" }];
test("B-05 source identity comes from a server credential binding, never request actor or tenant", () => {
  const authenticate = sourceTruthAuthenticator(members);
  assert.deepEqual(authenticate({ headers: { authorization: `Bearer ${token}` }, body: { actorId: "intruder", tenantId: "other" } }), { actorId: "owner", tenantId: "tenant" });
  for (const authorization of [undefined, "Bearer wrong", "Basic owner", `Bearer ${token}\nother`]) {
    assert.throws(() => authenticate({ headers: { authorization, "x-traqen-user-id": "owner" }, body: { actorId: "owner" } }), { code: "SOURCE_AUTHENTICATION_REQUIRED" });
  }
});
test("B-05 empty or ambiguous server identity bindings fail closed", () => {
  assert.throws(() => sourceTruthAuthenticator([]), { code: "SOURCE_AUTH_CONFIGURATION_REQUIRED" });
  assert.throws(() => sourceTruthAuthenticator([...members, { ...members[0], actorId: "other" }]), { code: "SOURCE_AUTH_CONFIGURATION_REQUIRED" });
});
