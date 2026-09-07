import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, chmod, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { readSourceTruthConfiguration } from "../src/source-truth/configuration.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const credential = "f001-isolated-production-test-token";

test("B-09 private configuration accepts an explicit aggregate Git watermark and rejects malformed values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f001-cache-configuration-"));
  const filename = path.join(root, "source-truth.json");
  const config = { version: 1, storage: { root: path.join(root, "private"), minFreeBytes: "1048576" },
    postgres: {}, git: { targets: [] }, origins: [], resources: { maxGitCacheBytes: "4294967296", maxPackBytes: 16777216 },
    members: [{ actorId: "owner", tenantId: "tenant", tokenDigest: createHash("sha256").update(credential).digest("hex") }] };
  await writeFile(filename, JSON.stringify(config), { mode: 0o600 });
  assert.equal((await readSourceTruthConfiguration(filename)).resources.maxGitCacheBytes, "4294967296");
  for (const value of [0, -1, "unlimited", ["4294967296"]]) {
    await writeFile(filename, JSON.stringify({ ...config, resources: { ...config.resources, maxGitCacheBytes: value } }));
    await assert.rejects(readSourceTruthConfiguration(filename), { code: "SOURCE_CONFIGURATION_INVALID" });
  }
});

async function production(t, cluster, database, configuration) {
  const uri = new URL(`postgresql://f001_test@localhost/${database.name}`);
  uri.searchParams.set("host", cluster.socket);
  const child = spawn(process.execPath, ["src/api/production-server.js"], { cwd: projectRoot,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", HOST: "127.0.0.1", PORT: "0", POSTGRES_SSL: "disable",
      DATABASE_URL: uri.href, API_BEARER_TOKEN: "f001-isolated-legacy-token", ANALYSIS_MODEL_STORE_PATH: "", SOURCE_TRUTH_CONFIG: configuration },
    stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-8000); });
  t.after(async () => { if (child.exitCode === null) { child.kill("SIGTERM"); await exited; } });
  const outcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Isolated production startup timed out")), 15000);
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-8000);
      const found = /Traqen API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (found) { clearTimeout(timer); resolve({ base: found[1], child, exited }); }
    });
    child.once("exit", (code) => { clearTimeout(timer); resolve({ code, errors }); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return outcome;
}

test("B-05/07 production entry binds persistent Source Truth, private config and current server-owned identity", { skip: !process.env.F001_TEST_PG_BIN || process.platform !== "darwin", timeout: 120000 }, async (t) => {
  const cleanup = [];
  const cluster = await isolatedPostgres({ after: (action) => cleanup.push(action) });
  t.after(async () => { for (const action of cleanup) await action(); });
  const database = await cluster.createDatabase();
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "tq-f001-production-")));
  const keyFile = path.join(root, "active.key"), recoveryFile = path.join(root, "recovery.key");
  const secret = Buffer.alloc(32, 45);
  await writeFile(keyFile, secret, { mode: 0o600 }); await writeFile(recoveryFile, secret, { mode: 0o600 });
  const configuration = path.join(root, "source-truth.json");
  const config = { version: 1, storage: { root: path.join(root, "source-truth"), keyVersion: "fixture-v1", keyFiles: { "fixture-v1": keyFile },
    recoveryKeyFiles: { "fixture-v1": recoveryFile }, recoveryOwner: "fixture-operator", minFreeBytes: "1048576" },
    postgres: { binDirectory: cluster.bin },
    members: [{ actorId: "owner", tenantId: "tenant", tokenDigest: createHash("sha256").update(credential).digest("hex") }],
    origins: ["http://127.0.0.1:3188"], git: { targets: [] }, resources: { maxFileBytes: "1048576", maxTotalBytes: "16777216", maxEntries: 1000, maxChunkBytes: 4096, maxBatchEntries: 100 } };
  await writeFile(configuration, JSON.stringify(config), { mode: 0o600 });
  await t.test("protected native filesystem and real database open the authenticated Source Truth endpoint", async (st) => {
    const running = await production(st, cluster, database, configuration);
    assert.ok(running.base, running.errors);
    const response = await fetch(`${running.base}/v1/workspaces/workspace/source-truth`, { headers: { authorization: `Bearer ${credential}` } });
    assert.equal(response.status, 200, "the production process must mount the persistent source handler, not return SOURCE_TRUTH_NOT_CONFIGURED");
    const data = await response.json();
    assert.equal(data.actor.actorId, "owner"); assert.equal(data.storage.ready, true);
    assert.equal(data.backup.status, "NOT_CONFIGURED");
    assert.equal(JSON.stringify(data).includes(root), false);
    assert.equal(JSON.stringify(data).includes(secret.toString("base64")), false);
    const forbidden = await fetch(`${running.base}/v1/workspaces/workspace/source-truth`, { headers: { authorization: "Bearer f001-isolated-legacy-token" } });
    assert.equal(forbidden.status, 401);
    const preflight = await fetch(`${running.base}/v1/workspaces/workspace/source-truth/draft`, { method: "OPTIONS", headers: {
      origin: config.origins[0], "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" } });
    assert.equal(preflight.headers.get("access-control-allow-origin"), config.origins[0], "the source-specific origin must work in a real browser, not only direct HTTP clients");
    const unrelated = await fetch(`${running.base}/v1/workspaces`, { method: "OPTIONS", headers: { origin: config.origins[0] } });
    assert.equal(unrelated.headers.get("access-control-allow-origin"), null, "source origin permission does not widen unrelated legacy API CORS");
    running.child.kill("SIGTERM"); await running.exited;
  });
  await t.test("a world-readable configuration fails before opening an HTTP listener", async (st) => {
    await chmod(configuration, 0o644);
    const stopped = await production(st, cluster, database, configuration);
    assert.equal(stopped.base, undefined, "unsafe configuration cannot be silently ignored by production startup");
    assert.notEqual(stopped.code, 0);
    assert.match(stopped.errors, /SOURCE_CONFIGURATION_PRIVATE_REQUIRED/);
    assert.equal(stopped.errors.includes(credential), false);
  });
});
