import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, writeFile, cp, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { candidateFixture } from "./source-truth-candidate-fixture.js";
import { owner } from "./source-truth-database.js";
import { SourcePublicationService } from "../../src/source-truth/publication-service.js";
import { AuthRepository } from "../../src/auth/repository.js";
import { AuthService } from "../../src/auth/service.js";
import { contextualDatabase } from "../../src/auth/database.js";
import { technicalF002Profile, createF002Runtime } from "../../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../../src/source-truth/admission-service.js";

export const independentPassword = "owned-independent-f0021";
const project = fileURLToPath(new URL("../../", import.meta.url));
// Node fetch may normalize Host to the API URL. The real same-origin proxy
// preserves the browser Host; model that transport with native HTTP, not by
// weakening AuthHttp.host or adding a trusted-proxy/Origin exception.
export function independentHttp(fixture, pathname, init = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(fixture.base + pathname, { method: init.method ?? "GET",
      headers: { host: new URL(fixture.origin).host, ...init.headers } }, response => {
      const bytes = [];
      response.on("data", chunk => bytes.push(chunk)); response.once("error", reject);
      response.once("end", () => {
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        resolve(new Response(Buffer.concat(bytes), { status: response.statusCode, headers }));
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error("owned native HTTP request timed out")));
    request.once("error", reject); request.end(init.body);
  });
}
export async function independentNativeFixture(t, { origin, queuedOnStart = false, holdWorker = false, failInitialScan = false } = {}) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  // node:test after hooks run in registration order. Drain the application
  // before its owned PG fixture is stopped, including assertion failures.
  let cleanup;
  t.after(() => cleanup?.());
  const cluster = await isolatedPostgres(t);
  let databaseName;
  const source = await candidateFixture(t, {
    database: async () => { const result = await cluster.createDatabase(); databaseName = result.name; return result; },
    entryPath: "evidence-sentinel.js", content: "export function EvidenceSentinelOct21() { return 42; }\n",
    additionalFiles: [{ entryPath: "not-selected.js", content: "export function MustNotExtractOutsideScope() { return 7; }\n" }],
  });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publisher = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publisher.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publisher.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "independent-f002-source" });
  const key = Buffer.alloc(32, 18);
  const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(source.db)), key });
  const account = await identity.initialize({ login: "owner", displayName: "Independent F002 Owner", password: independentPassword });
  await identity.migrate({ bindings: [{ principalId: owner.actorId, accountId: account.id }],
    owners: [{ workspaceId: "workspace", accountId: account.id }], grants: [], confirmed: true, requestedBy: "DEPLOYMENT" });
  source.repository.identityService = identity;
  let queuedRun;
  if (queuedOnStart) {
    const facts = await createF002Runtime({ sourceRuntime: { pool: source.db,
      services: { repository: source.repository, admission: new SourceAdmissionService(source.repository, source.candidates) },
      configuration: { members: [], origins: [origin] } }, cursorSecret: "owned-preexisting-run" });
    try {
      const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
      const inventory = await facts.services.admission.sourceAdmission.inventory(owner, "workspace", reference);
      queuedRun = await facts.services.admission.start(owner, "workspace", { operationId: "preexisting-native-startup-work",
        reference, profile: technicalF002Profile(), scopes: [{ selections: [{ kind: "COMPONENT", componentId: inventory.items[0].componentId }] }] });
    } finally { await facts.close(); }
  }
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "tq-f002-native-entry-"));
  const barrier = path.join(root, "worker-barrier");
  const store = path.join(root, "source-store"), keys = path.join(root, "keys"), recovery = path.join(root, "recovery");
  for (const directory of [store, keys, recovery]) await mkdir(directory, { mode: 0o700 });
  await writeFile(path.join(store, "source-truth-store.json"), '{"format":"Traqen.SourceTruthStore","version":1}', { mode: 0o600, flag: "wx" });
  await cp(source.blobs.root, path.join(store, "bytes"), { recursive: true, errorOnExist: true, force: false });
  const keyFile = path.join(keys, "auth.key"), blobKey = path.join(keys, "blob.key"), recoveryKey = path.join(recovery, "blob.key");
  for (const [filename, bytes] of [[keyFile, key], [blobKey, Buffer.alloc(32, 12)], [recoveryKey, Buffer.alloc(32, 12)]])
    await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
  const configuration = { version: 1, storage: { root: store, keyVersion: "test", keyFiles: { test: blobKey },
    recoveryKeyFiles: { test: recoveryKey }, recoveryOwner: "owned-test", minFreeBytes: "0" },
    postgres: { binDirectory: cluster.bin }, members: [], origins: [origin], git: { targets: [], credentials: [] }, resources: {} };
  const configFile = path.join(root, "source-config.json");
  await writeFile(configFile, JSON.stringify(configuration), { mode: 0o600, flag: "wx" });
  const databaseUrl = `postgresql://f001_test@localhost/${databaseName}?host=${encodeURIComponent(cluster.socket)}`;
  if (failInitialScan) await source.db.query("ALTER TABLE f002_scope RENAME TO f002_scope_owned_startup_fault");
  const cleanEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"].flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
  let child, exited, base, log = "", launchCount = 0;
  const children = [];
  async function start() {
    assert.ok(!child || child.exitCode !== null);
    child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./f002-owned-volume-loader.mjs", import.meta.url)),
      path.join(project, "src/api/dev-server.js")], { cwd: project, env: { ...cleanEnv, HOST: "127.0.0.1", PORT: "0",
        TRAQEN_AUTH_DEVELOPMENT: "true", TRAQEN_AUTH_DEVELOPMENT_DATA: path.join(root, "identity"),
        TRAQEN_AUTH_KEY_FILE: keyFile, TRAQEN_PUBLIC_ORIGIN: origin, SOURCE_TRUTH_CONFIG: configFile, DATABASE_URL: databaseUrl,
        F002_TEST_OWNED_VOLUME_ROOTS: JSON.stringify([root, cluster.root]),
        ...(holdWorker ? { F002_TEST_OWNED_WORKER_BARRIER: barrier } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    exited = once(child, "exit"); children.push(child.pid); launchCount++;
    let current = "";
    for (const output of [child.stdout, child.stderr]) output.on("data", bytes => { current += bytes.toString(); log += bytes.toString(); });
    const deadline = Date.now() + 60000;
    while (true) {
      const listening = /Traqen development API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(current);
      if (listening) { base = listening[1]; return; }
      if (failInitialScan && child.exitCode !== null) {
        assert.notEqual(child.exitCode, 0); assert.match(current, /f002_scope/); return;
      }
      assert.ok(child.exitCode === null && Date.now() < deadline, `owned development API failed: ${current.slice(-10000)}`);
      await delay(50);
    }
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => { if (child?.exitCode === null) child.kill("SIGKILL"); }, 15000);
    try { await exited; } finally { clearTimeout(timeout); }
    assert.equal(child.exitCode, 0, "owned API must close its F1/F2/database resources cleanly");
  }
  cleanup = async () => {
    // A failing assertion must not leave this fixture's worker barrier held.
    if (holdWorker) await writeFile(`${barrier}.released`, "released during owned cleanup", { mode: 0o600 });
    try { await stop(); }
    finally { await writeFile(path.join(root, "api.log"), log, { mode: 0o600, flag: "wx" }); }
  };
  await start();
  return { source, cluster, root, origin, children,
    get base() { return base; }, get log() { return log; }, get launches() { return launchCount; },
    metadata: { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id, profileId: technicalF002Profile().id, originalDigest: source.digest, queuedRun },
    pool: () => cluster.pool(databaseName),
    async waitForHeldWorker() {
      assert.equal(holdWorker, true); const deadline = Date.now() + 30000;
      while (true) {
        try { await access(`${barrier}.entered`); return; } catch {}
        assert.ok(Date.now() < deadline, "owned worker did not enter the deterministic barrier"); await delay(20);
      }
    },
    releaseWorker: () => writeFile(`${barrier}.released`, "explicit release", { mode: 0o600 }),
    async restart() { await stop(); await cluster.restart(); await start(); }, close: stop,
  };
}

export async function loginIndependentFixture(fixture) {
  const request = (pathname, init = {}) => independentHttp(fixture, pathname, init);
  const pre = await request("/v1/auth/csrf"); assert.equal(pre.status, 200, await pre.clone().text());
  const csrf = (await pre.json()).csrfToken, preCookie = pre.headers.get("set-cookie").split(";")[0];
  const logged = await request("/v1/auth/login", { method: "POST", headers: { cookie: preCookie, origin: fixture.origin,
    "x-traqen-csrf": csrf, "content-type": "application/json" }, body: JSON.stringify({ login: "owner", password: independentPassword }) });
  assert.equal(logged.status, 200, await logged.clone().text());
  const currentCsrf = (await logged.json()).csrfToken;
  const cookie = logged.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return (pathname, input) => request(pathname, { method: input === undefined ? "GET" : "POST",
    headers: { cookie, ...(input === undefined ? {} : { origin: fixture.origin, "x-traqen-csrf": currentCsrf, "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
