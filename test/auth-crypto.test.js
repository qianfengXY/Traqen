import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword, totp, verifyTotp, sealSecret, openSecret, safeDestination } from "../src/auth/crypto.js";

test("password policy accepts eight Unicode characters and stores versioned independent salts", async () => {
  await assert.rejects(hashPassword("1234567"), /8/);
  const first = await hashPassword("密码一二三四五六");
  const second = await hashPassword("密码一二三四五六");
  assert.equal(first.algorithm, "scrypt-v1");
  assert.equal(first.N, 131072);
  assert.notEqual(first.salt, second.salt);
  assert.equal(await verifyPassword("密码一二三四五六", first), true);
  assert.equal(await verifyPassword("wrongpass", first), false);
});
test("TOTP matches RFC 6238 vector and rejects replayed counters", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totp(secret, 59000), "287082");
  assert.equal(verifyTotp(secret, "287082", 59000, -1), 1);
  assert.equal(verifyTotp(secret, "287082", 59000, 1), null);
  assert.equal(verifyTotp(secret, "123", 59000, -1), null);
});
test("authenticator secrets are authenticated and encrypted with deployment key", () => {
  const key = Buffer.alloc(32, 5);
  const sealed = sealSecret("MY-TOTP-SECRET", key);
  assert.equal(JSON.stringify(sealed).includes("MY-TOTP-SECRET"), false);
  assert.equal(openSecret(sealed, key), "MY-TOTP-SECRET");
  assert.throws(() => openSecret(sealed, Buffer.alloc(32, 6)));
});
test("return destination stays on validated product routes", () => {
  for (const target of ["https://evil.test/", "//evil.test/", "/\\evil.test", "javascript:alert(1)", "/api/v1/auth/logout", "/?next=https://evil.test"]) assert.equal(safeDestination(target), "/");
  assert.equal(safeDestination("/?view=workspace&workspaceId=W1"), "/?view=workspace&workspaceId=W1");
});
