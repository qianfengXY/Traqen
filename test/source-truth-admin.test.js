import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isolatedPostgres } from "./support/source-truth-postgres.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function admin(args) {
  const child = spawn(process.execPath, ["src/cli/source-truth-backup.js", ...args], { cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
  const [code] = await once(child, "exit");
  return { code, out, err };
}

test("administrator CLI explains explicit authority/configuration and does not infer production connection defaults", async () => {
  const help = await admin(["help"]);
  assert.equal(help.code, 0, help.err);
  assert.match(help.out, /restore/); assert.match(help.out, /--database-config/);
  const absent = await admin(["backup"]);
  assert.notEqual(absent.code, 0);
  assert.match(absent.err, /SOURCE_ADMIN_ARGUMENT_REQUIRED/);
});

test("administrator provisions configured human members and audited Workspace grants only on a protected explicit database", { skip: !process.env.F001_TEST_PG_BIN || process.platform !== "darwin", timeout: 60000 }, async (t) => {
  const pg = await isolatedPostgres(t), database = await pg.createDatabase();
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "tq-f001-admin-")));
  const key = path.join(directory, "key"), recovery = path.join(directory, "recovery");
  await writeFile(key, Buffer.alloc(32, 14), { mode: 0o600 }); await writeFile(recovery, Buffer.alloc(32, 14), { mode: 0o600 });
  const config = path.join(directory, "config.json"), dbConfig = path.join(directory, "database.json");
  await writeFile(config, JSON.stringify({ version: 1, storage: { root: path.join(directory, "store"), keyVersion: "test", keyFiles: { test: key }, recoveryKeyFiles: { test: recovery }, recoveryOwner: "test-admin" }, postgres: { binDirectory: pg.bin },
    members: [{ actorId: "new-reader", tenantId: "tenant", tokenDigest: createHash("sha256").update("unused-test-token").digest("hex") }], origins: [], git: { targets: [] }, resources: {} }), { mode: 0o600 });
  const { host, port, user, password } = pg.connection(database.name);
  await writeFile(dbConfig, JSON.stringify({ host, port, user, password, database: database.name }), { mode: 0o600 });
  const args = ["--config", config, "--database-config", dbConfig, "--operator", "fixture-admin"];
  const provisioned = await admin(["provision-members", ...args]);
  assert.equal(provisioned.code, 0, provisioned.err);
  assert.equal((await database.db.query("SELECT principal_type FROM principal WHERE id='new-reader'")).rows[0].principal_type, "USER");
  const granted = await admin(["grant", ...args, "--workspace", "workspace", "--tenant", "tenant", "--member", "new-reader", "--role", "READ"]);
  assert.equal(granted.code, 0, granted.err);
  assert.equal((await database.repository.authorize({ actorId: "new-reader", tenantId: "tenant" }, "workspace")).role, "READ");
  assert.equal((await database.db.query("SELECT count(*)::int AS n FROM source_truth_event WHERE event_type='ADMIN_GRANT_CHANGED'")).rows[0].n, 1);
  const otherTenant = await admin(["grant", ...args, "--workspace", "workspace2", "--tenant", "other", "--member", "new-reader", "--role", "MAINTAIN"]);
  assert.notEqual(otherTenant.code, 0); assert.match(otherTenant.err, /SOURCE_FORBIDDEN/);
  assert.equal(granted.out.includes(directory), false);
  const configured = JSON.parse(await readFile(config, "utf8"));
  configured.storage.root = path.join(directory, "lost-original-store");
  configured.storage.keyFiles.test = path.join(directory, "lost-original-active-key");
  configured.backup = { root: path.join(directory, "backup"), targetId: "test-backup", maxBytes: "536870912", mode: "MANUAL" };
  await writeFile(config, JSON.stringify(configured), { mode: 0o600 });
  const verification = await admin(["verify", "--config", config, "--operator", "fixture-admin", "--set", "11111111-1111-4111-8111-111111111111"]);
  assert.notEqual(verification.code, 0);
  assert.match(verification.err, /SOURCE_BACKUP_UNSEALED/, "offline verification must reach the target proof without needing the lost primary database, bytes or active key file");
});
