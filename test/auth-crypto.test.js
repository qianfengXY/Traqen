import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword, safeDestination } from "../src/auth/crypto.js";

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
test("return destination stays on validated product routes", () => {
  for (const target of ["https://evil.test/", "//evil.test/", "/\\evil.test", "javascript:alert(1)", "/api/v1/auth/logout", "/?next=https://evil.test"]) assert.equal(safeDestination(target), "/");
  assert.equal(safeDestination("/?view=workspace&workspaceId=W1"), "/?view=workspace&workspaceId=W1");
});
