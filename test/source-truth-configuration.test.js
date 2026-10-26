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
import { AuthService } from "../src/auth/service.js";
import { AuthRepository } from "../src/auth/repository.js";
import { contextualDatabase } from "../src/auth/database.js";
import { request as httpRequest } from "node:http";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const credential = "f001-isolated-production-test-token";
const publicOrigin = "https://source-truth.example.test";

// The production listener sits behind HTTPS and validates its canonical Host.
// Fetch deliberately replaces Host; use the native transport to exercise the
// real loopback gateway contract without disabling the production host guard.
async function gatewayRequest(url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, response => {
      const chunks = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) request.destroy(new Error("Owned response exceeds test budget")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => resolve(new Response([204, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.setTimeout(10000, () => request.destroy(new Error("Owned request timeout")));
    request.on("error", reject); request.end();
  });
}

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

async function production(t, cluster, database, configuration, keyFile, { development = false } = {}) {
  const uri = new URL(`postgresql://f001_test@localhost/${database.name}`);
  uri.searchParams.set("host", cluster.socket);
  const child = spawn(process.execPath, [development ? "src/api/dev-server.js" : "src/api/production-server.js"], { cwd: projectRoot,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", HOST: "127.0.0.1", PORT: "0", POSTGRES_SSL: "disable",
      DATABASE_URL: uri.href, TRAQEN_AUTH_KEY_FILE: keyFile, TRAQEN_PUBLIC_ORIGIN: development ? "http://127.0.0.1:6236" : publicOrigin,
      TRAQEN_AUTH_DEVELOPMENT_DATA: path.join(path.dirname(keyFile), "isolated-development"),
      ANALYSIS_MODEL_STORE_PATH: "", SOURCE_TRUTH_CONFIG: configuration },
    stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-8000); });
  t.after(async () => { if (child.exitCode === null) { child.kill("SIGTERM"); await exited; } });
  const outcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Isolated production startup timed out")), 15000);
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-8000);
      const found = /Traqen (?:development )?API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
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
  const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(database.db)), key: secret });
  const account = await identity.initialize({ login: "owner", displayName: "Isolated owner", password: "isolated-production-password1" });
  await identity.migrate({ bindings: [{ principalId: "owner", accountId: account.id }], owners: [{ workspaceId: "workspace", accountId: account.id }],
    grants: [], confirmed: true, requestedBy: "DEPLOYMENT" });
  const session = await identity.login({ login: "owner", password: "isolated-production-password1" });
  const headers = { host: new URL(publicOrigin).host, cookie: `__Host-traqen_session=${session.token}` };
  const configuration = path.join(root, "source-truth.json");
  const config = { version: 1, storage: { root: path.join(root, "source-truth"), keyVersion: "fixture-v1", keyFiles: { "fixture-v1": keyFile },
    recoveryKeyFiles: { "fixture-v1": recoveryFile }, recoveryOwner: "fixture-operator", minFreeBytes: "1048576" },
    postgres: { binDirectory: cluster.bin },
    members: [{ actorId: "owner", tenantId: "tenant", tokenDigest: createHash("sha256").update(credential).digest("hex") }],
    origins: ["http://127.0.0.1:3188"], git: { targets: [] }, resources: { maxFileBytes: "1048576", maxTotalBytes: "16777216", maxEntries: 1000, maxChunkBytes: 4096, maxBatchEntries: 100 } };
  await writeFile(configuration, JSON.stringify(config), { mode: 0o600 });
  await t.test("protected native filesystem and real database open the authenticated Source Truth endpoint", async (st) => {
    const running = await production(st, cluster, database, configuration, keyFile);
    assert.ok(running.base, running.errors);
    const response = await gatewayRequest(`${running.base}/v1/workspaces/workspace/source-truth`, { headers });
    assert.equal(response.status, 200, `the production process must mount the persistent source handler: ${response.status === 200 ? "OK" : JSON.stringify(await response.clone().json())}`);
    const data = await response.json();
    assert.equal(data.actor.actorId, "owner"); assert.equal(data.storage.ready, true);
    assert.equal(data.backup.status, "NOT_CONFIGURED");
    assert.equal(JSON.stringify(data).includes(root), false);
    assert.equal(JSON.stringify(data).includes(secret.toString("base64")), false);
    const business = await gatewayRequest(`${running.base}/v1/workspaces/workspace/business-knowledge`, { headers });
    assert.equal(business.status, 200, "the real production listener must mount F003 behind current F008 identity");
    assert.deepEqual((await business.json()).investigations, []);
    const wrongHost = await gatewayRequest(`${running.base}/v1/workspaces/workspace/business-knowledge`, { headers: { ...headers, host: "wrong.test" } });
    assert.equal(wrongHost.status, 403); assert.equal((await wrongHost.json()).error.code, "AUTH_HOST_REJECTED");
    const facts = await gatewayRequest(`${running.base}/v1/workspaces/workspace/deterministic-facts`, { headers });
    assert.equal(facts.status, 200);
    assert.equal((await facts.json()).consumer.configured, true, "production F002 must use the actual persistent F003 resolver");
    const legacyBusiness = await gatewayRequest(`${running.base}/v1/workspaces/workspace/business-knowledge`, { headers: { host: headers.host, authorization: `Bearer ${credential}` } });
    assert.equal(legacyBusiness.status, 401);
    const forbidden = await gatewayRequest(`${running.base}/v1/workspaces/workspace/source-truth`, { headers: { host: headers.host, authorization: `Bearer ${credential}` } });
    assert.equal(forbidden.status, 401);
    const preflight = await gatewayRequest(`${running.base}/v1/workspaces/workspace/source-truth/draft`, { method: "OPTIONS", headers: {
      ...headers, origin: config.origins[0], "access-control-request-method": "PUT", "access-control-request-headers": "content-type" } });
    assert.equal(preflight.headers.get("access-control-allow-origin"), config.origins[0], "the source-specific origin must work in a real browser, not only direct HTTP clients");
    const businessPreflight = await gatewayRequest(`${running.base}/v1/workspaces/workspace/business-knowledge`, { method: "OPTIONS", headers: { ...headers, origin: config.origins[0] } });
    assert.equal(businessPreflight.headers.get("access-control-allow-origin"), config.origins[0]);
    const unrelated = await gatewayRequest(`${running.base}/v1/workspaces`, { method: "OPTIONS", headers: { ...headers, origin: config.origins[0] } });
    assert.equal(unrelated.headers.get("access-control-allow-origin"), null, "source origin permission does not widen unrelated legacy API CORS");
    running.child.kill("SIGTERM"); await running.exited;
  });
  await t.test("the explicit native development entry shares F001, F006 and current identity with the same knowledge assembly", async st => {
    const running = await production(st, cluster, database, configuration, keyFile, { development: true });
    assert.ok(running.base, running.errors);
    const headers = { host: "127.0.0.1:6236", cookie: `traqen_dev_session=${session.token}` };
    for (const route of ["source-truth", "deterministic-facts", "business-knowledge"]) {
      const response = await gatewayRequest(`${running.base}/v1/workspaces/workspace/${route}`, { headers });
      assert.equal(response.status, 200, `development must mount ${route} using the same explicit native data store`);
      if (route === "deterministic-facts") assert.equal((await response.json()).consumer.configured, true);
    }
    running.child.kill("SIGTERM"); await running.exited;
  });
  await t.test("a world-readable configuration fails before opening an HTTP listener", async (st) => {
    await chmod(configuration, 0o644);
    const stopped = await production(st, cluster, database, configuration, keyFile);
    assert.equal(stopped.base, undefined, "unsafe configuration cannot be silently ignored by production startup");
    assert.notEqual(stopped.code, 0);
    assert.match(stopped.errors, /SOURCE_CONFIGURATION_PRIVATE_REQUIRED/);
    assert.equal(stopped.errors.includes(credential), false);
  });
});
