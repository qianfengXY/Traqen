import assert from "node:assert/strict";
import { AuthRepository } from "../../src/auth/repository.js";
import { AuthService } from "../../src/auth/service.js";
import { contextualDatabase } from "../../src/auth/database.js";

// Only the synthetic sourceDatabase fixture's known identities. Never reopen
// legacy grants or reset auth_control after the real restore fence has closed it.
export async function recoverSourceFixtureIdentity(database) {
  const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(database)), key: Buffer.alloc(32, 29) });
  assert.equal((await identity.status()).recovery, true);
  const account = await identity.trustRecoveryAdmin({ login: "owned-recovery-admin", displayName: "Owned recovery administrator",
    password: "owned-recovery-password1", requestedBy: "OWNED_TEST_FIXTURE" });
  await identity.finishRecovery({ requestedBy: "OWNED_TEST_FIXTURE", confirmed: true });
  const administrator = await identity.login({ login: "owned-recovery-admin", password: "owned-recovery-password1" });
  const person = await identity.createAccount(administrator.token, { login: "owned-recovery-reader", displayName: "Owned recovery reader" });
  await identity.setPassword({ credential: person.credential, password: "owned-recovery-password2" });
  await identity.migrate({ bindings: [{ principalId: "owner", accountId: account.id }, { principalId: "reader", accountId: person.account.id }],
    owners: [{ workspaceId: "workspace", accountId: account.id }], grants: [{ workspaceId: "workspace", accountId: person.account.id, roles: ["READ"] }],
    confirmed: true, requestedBy: "OWNED_TEST_FIXTURE" });
  const session = await identity.login({ login: "owned-recovery-admin", password: "owned-recovery-password1" });
  assert.equal((await identity.status()).recovery, false);
  return { identity, session, readerAccountId: person.account.id };
}
