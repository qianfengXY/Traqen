// Real native PG, owned HTTPS Git and actual dev-server bootstrap. Only account
// setup is seeded. Capture/publication/tasks are exercised through normal HTTP.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { gitFixture } from "./source-truth-git-fixture.js";
import { cookieFixtureOrigin, cookieFixturePassword, fixtureCookieClient } from "./source-truth-browser-cookie-fixture.js";
import { AuthService } from "../../src/auth/service.js";
import { AuthRepository } from "../../src/auth/repository.js";
import { contextualDatabase } from "../../src/auth/database.js";
import { acceptanceFilesA, acceptanceFilesB } from "./f002-acceptance-assets.js";

const project = fileURLToPath(new URL("../../", import.meta.url));
export async function acceptanceNativeFixture(t, { origin } = {}) {
  origin = cookieFixtureOrigin(origin);
  const cleanups = [], registration = { after: fn => cleanups.push(fn) };
  let closed = false, child, exited, log = "", base, root, cluster, latestFiles = acceptanceFilesA;
  const children = [];
  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 15000);
    try { await exited; } finally { clearTimeout(timer); }
    assert.equal(child.exitCode, 0, "owned actual API must drain its source/F002/auth resources");
  }
  async function close() {
    if (closed) return; closed = true;
    const errors = [];
    for (const fn of [stop, ...cleanups.toReversed()]) try { await fn(); } catch (e) { errors.push(e); }
    if (root) await writeFile(path.join(root, "cleanup.json"), JSON.stringify({
      completedAt: new Date().toISOString(), apiChildren: children, apiExit: child ? { code: child.exitCode, signal: child.signalCode } : null,
      nativePgRoot: cluster?.root, ownedCleanupCompleted: errors.length === 0, errors: errors.map(e => e.message),
    }, null, 2), { mode: 0o600 });
    if (errors.length) throw new AggregateError(errors, "Owned F002 acceptance cleanup failed");
  }
  t.after(close);
  try {
    cluster = await isolatedPostgres(registration);
    const initial = await cluster.createDatabase();
    const source = await gitFixture(registration);
    await source.git("rm", "--", "src/orders.js"); // Only this helper's newly-created sentinel.
    async function commitFiles(files, label) {
      for (const filename of Object.keys(latestFiles)) if (!(filename in files)) await source.git("rm", "--", filename);
      for (const [filename, content] of Object.entries(files)) {
        assert.ok(!filename.startsWith("/") && !filename.split("/").includes(".."));
        const target = path.join(source.work, filename);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, content, { mode: 0o600 });
      }
      await source.git("add", "."); await source.git("commit", "-m", label);
      await source.git("push", path.join(source.root, "repo.git"), "main");
      latestFiles = files;
      return source.git("rev-parse", "HEAD");
    }
    const commitA = await commitFiles(acceptanceFilesA, "public bounded acceptance A");
    root = await mkdtemp(path.join(await realpath(tmpdir()), "tq-f002-native-entry-"));
    const store = path.join(root, "source-store"), keys = path.join(root, "keys"), recovery = path.join(root, "recovery");
    for (const directory of [store, keys, recovery]) await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(store, "source-truth-store.json"), '{"format":"Traqen.SourceTruthStore","version":1}', { flag: "wx", mode: 0o600 });
    const key = Buffer.alloc(32, 83), keyFile = path.join(keys, "auth.key"), blobKey = path.join(keys, "blob.key"), recoveryKey = path.join(recovery, "blob.key");
    for (const [filename, bytes] of [[keyFile, key], [blobKey, Buffer.alloc(32, 29)], [recoveryKey, Buffer.alloc(32, 29)]]) await writeFile(filename, bytes, { flag: "wx", mode: 0o600 });
    const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(initial.db)), key });
    const account = await identity.initialize({ login: "owner", displayName: "Technical acceptance owner", password: cookieFixturePassword });
    const adminSession = await identity.login({ login: "owner", password: cookieFixturePassword });
    const made = await identity.createAccount(adminSession.token, { login: "reader", displayName: "Technical acceptance reader" });
    await identity.setPassword({ credential: made.credential, password: cookieFixturePassword });
    await identity.migrate({ bindings: [{ principalId: "owner", accountId: account.id }, { principalId: "reader", accountId: made.account.id }],
      owners: [{ workspaceId: "workspace", accountId: account.id }], grants: [{ workspaceId: "workspace", accountId: made.account.id, roles: ["READ"] }],
      confirmed: true, requestedBy: "DEPLOYMENT" });
    const counts = (await initial.db.query("SELECT (SELECT count(*)::int FROM source_truth_run) AS sources,(SELECT count(*)::int FROM f002_run) AS facts")).rows[0];
    assert.deepEqual(counts, { sources: 0, facts: 0 }, "seed identity only; capture must come from HTTP");
    const configuration = { version: 1, storage: { root: store, keyVersion: "fixture", keyFiles: { fixture: blobKey },
      recoveryKeyFiles: { fixture: recoveryKey }, recoveryOwner: "owned-test", minFreeBytes: "0" },
      postgres: { binDirectory: cluster.bin }, members: [], origins: [origin], git: { targets: source.targets, credentials: [] }, resources: {} };
    const configFile = path.join(root, "source-config.json");
    await writeFile(configFile, JSON.stringify(configuration), { flag: "wx", mode: 0o600 });
    const databaseUrl = `postgresql://f001_test@localhost/${initial.name}?host=${encodeURIComponent(cluster.socket)}`;
    const cleanEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"].flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
    async function start() {
      child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./f002-owned-volume-loader.mjs", import.meta.url)), path.join(project, "src/api/dev-server.js")],
        { cwd: project, env: { ...cleanEnv, HOST: "127.0.0.1", PORT: "0", TRAQEN_AUTH_DEVELOPMENT: "true",
          TRAQEN_AUTH_DEVELOPMENT_DATA: path.join(root, "identity"), TRAQEN_AUTH_KEY_FILE: keyFile,
          TRAQEN_PUBLIC_ORIGIN: origin, SOURCE_TRUTH_CONFIG: configFile, DATABASE_URL: databaseUrl,
          F002_TEST_OWNED_VOLUME_ROOTS: JSON.stringify([root, cluster.root]) }, stdio: ["ignore", "pipe", "pipe"] });
      children.push(child.pid); exited = once(child, "exit");
      let current = "";
      for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { current += b.toString(); log += b.toString(); });
      const deadline = Date.now() + 60000;
      while (true) {
        const listening = /Traqen development API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(current);
        if (listening) { base = listening[1]; return; }
        assert.ok(child.exitCode === null && Date.now() < deadline, "actual acceptance API did not start: " + current.slice(-12000));
        await delay(50);
      }
    }
    cleanups.push(() => writeFile(path.join(root, "api.log"), log, { mode: 0o600 }));
    await start();
    return { root, source, cluster, origin, children, commitA,
      get base() { return base; }, get log() { return log; },
      pool: () => cluster.pool(initial.name),
      async client(login = "owner") { const client = fixtureCookieClient(base, origin); await client.login(login); return client; },
      advanceGit: () => commitFiles(acceptanceFilesB, "public bounded acceptance B: add modify delete retain"),
      async restart() { await stop(); await cluster.restart(); await start(); }, close,
      scope: "NATIVE_PG_REAL_HTTP_COOKIE_HTTPS_GIT_VOLUME_PROBE_MECHANISM_DOUBLE_NOT_MEDIA_BACKUP_PROOF_NO_MODELS" };
  } catch (error) { await close(); throw error; }
}
