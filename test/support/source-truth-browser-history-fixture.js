// Reopen a COPY of a retained F001 service pilot, never the original cluster.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";
import { SourceTruthRepository } from "../../src/source-truth/repository.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { sourceTruthAuthenticator } from "../../src/source-truth/authentication.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { createConfiguredApplication } from "../../src/api/application-bootstrap.js";
import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";

const execute = promisify(execFile);
async function regularTree(root) {
  const stat = await lstat(root);
  assert.ok(stat.isDirectory() || stat.isFile(), "retained fixture must not contain links or special files");
  if (stat.isDirectory()) for (const name of await readdir(root)) await regularTree(path.join(root, name));
}

export async function browserHistoryFixture(t, { pilotRoot, clusterRoot, binaries, expectedBundleIds, expectedFiles, access = "READ" }) {
  assert.ok(["READ", "MAINTAIN"].includes(access), "copied fixture access must be explicit");
  const pilot = await realpath(pilotRoot), original = await realpath(clusterRoot), bin = await realpath(binaries);
  assert.match(path.basename(pilot), /^tq-f001-pilot-[A-Za-z0-9]+$/);
  assert.match(path.basename(original), /^tq-f001-pg-[A-Za-z0-9]+$/);
  const sourceText = await readFile(path.join(pilot, "report.json"), "utf8"), sourceReport = JSON.parse(sourceText);
  assert.equal(sourceReport.status, "PASSED");
  assert.equal(sourceReport.scope, "REAL_POSTGRES_HTTPS_GIT_DIRECTORY_SERVICE_PILOT");
  assert.equal(sourceReport.totalFiles, expectedFiles);
  assert.deepEqual(sourceReport.bundleIds, expectedBundleIds);
  const originalData = path.join(original, "data"), originalBlobs = path.join(pilot, "managed-bytes");
  assert.equal((await readFile(path.join(originalData, "PG_VERSION"), "utf8")).trim(), "16");
  await assert.rejects(lstat(path.join(originalData, "postmaster.pid")), { code: "ENOENT" });
  assert.deepEqual(await readdir(path.join(originalData, "pg_tblspc")), []);
  const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: "C", TZ: "UTC" };
  const control = (await execute(path.join(bin, "pg_controldata"), [originalData], { env, timeout: 10000 })).stdout;
  assert.match(control, /Database cluster state:\s+shut down\s*\n/);
  const auto = await readFile(path.join(originalData, "postgresql.auto.conf"), "utf8");
  assert.ok(auto.split("\n").every((line) => !line.trim() || line.trim().startsWith("#")), "no inherited auto configuration");
  await regularTree(originalData); await regularTree(originalBlobs);
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "tq-f001-history-ui-"));
  const data = path.join(root, "data"), bytes = path.join(root, "bytes"), socket = path.join(root, "socket");
  await cp(originalData, data, { recursive: true, force: false, errorOnExist: true });
  await cp(originalBlobs, bytes, { recursive: true, force: false, errorOnExist: true });
  await mkdir(socket, { mode: 0o700 });
  const configFile = path.join(root, "postgresql.conf"), hbaFile = path.join(root, "pg_hba.conf");
  await writeFile(configFile, "# Only explicit command-line fixture settings are used.\n", { mode: 0o600, flag: "wx" });
  await writeFile(hbaFile, "local all f001_test trust\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n", { mode: 0o600, flag: "wx" });
  const child = spawn(path.join(bin, "postgres"), ["-D", data, "-k", socket, "-h", "", "-c", `config_file=${configFile}`, "-c", `hba_file=${hbaFile}`,
    "-c", "unix_socket_permissions=0700", "-c", "max_connections=24", "-c", "shared_buffers=16MB"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "", spawnError;
  child.on("error", (error) => { spawnError = error; });
  const exited = new Promise((resolve) => child.once("close", resolve));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (part) => { tail = (tail + part.toString()).slice(-8192); });
  const pools = new Set();
  t.after(async () => { await Promise.all([...pools].map((pool) => pool.end())); if (child.exitCode === null) child.kill("SIGINT"); await exited; });
  const connection = (database = "postgres") => ({ host: socket, port: 5432, database, user: "f001_test", password: "", ssl: false,
    max: 8, connectionTimeoutMillis: 2000, statement_timeout: 15000, application_name: "f001-retained-pilot-ui" });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.ok(!spawnError && child.exitCode === null, `copied fixture failed to start: ${spawnError?.message ?? tail}`);
    const probe = new pg.Client(connection());
    try { await probe.connect(); await probe.query("SELECT 1"); ready = true; break; }
    catch { await setTimeout(25); }
    finally { await probe.end().catch(() => {}); }
  }
  assert.ok(ready, `copied fixture startup deadline exceeded: ${tail}`);
  const pool = (database) => { const result = new pg.Pool(connection(database)); result.exec = (sql) => result.query(sql); pools.add(result); return result; };
  const admin = pool();
  const databases = (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'f001_%'")).rows;
  assert.equal(databases.length, 1, "the retained pilot must identify one fixture database");
  const db = pool(databases[0].datname);
  const frozen = (await db.query("SELECT id,payload FROM source_truth_bundle WHERE workspace_id='workspace' ORDER BY published_at,id")).rows;
  assert.deepEqual(frozen.map((row) => row.id), expectedBundleIds, "database and byte-store report must refer to the exact original pilot");
  const repository = new SourceTruthRepository(db);
  const blobs = await SourceTruthBlobStore.open({ root: bytes, keyVersion: "pilot", keys: { pilot: Buffer.alloc(32, 31) } });
  const services = sourceTruthServices({ repository, blobs, policy: capturePolicy() }); // No live Git source and no background worker.
  const token = access === "READ" ? "f001-history-read-only-fixture-token" : "f001-copied-capture-fixture-token";
  const authenticate = sourceTruthAuthenticator([{ tokenDigest: createHash("sha256").update(token).digest("hex"), actorId: access === "READ" ? "reader" : "owner", tenantId: "tenant" }]);
  const origins = ["http://127.0.0.1:3188", "http://localhost:3188"];
  const configured = createConfiguredApplication({ store: new PostgresTraceabilityStore(db), env: { CORS_ALLOWED_ORIGINS: origins.join(",") } });
  await configured.ready;
  const server = createTraceabilityHttpServer({ application: configured.application, corsAllowedOrigins: origins, sourceTruthAllowedOrigins: origins,
    apiBearerToken: token, sourceTruthHandler: createSourceTruthHttpHandler({ services, authenticate, allowedOrigins: origins }) });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3197, "127.0.0.1", resolve); });
  const apiBase = "http://127.0.0.1:3197";
  const read = async (route) => {
    const response = await fetch(`${apiBase}/v1/workspaces/workspace/source-truth${route}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); return response.json();
  };
  return { root, sourceReportHash: createHash("sha256").update(sourceText).digest("hex"), apiBase, token, read,
    async assertPriorHistoryUnchanged() { assert.deepEqual((await db.query("SELECT id,payload FROM source_truth_bundle WHERE workspace_id='workspace' AND id=ANY($1::text[]) ORDER BY published_at,id", [expectedBundleIds])).rows, frozen); },
    async assertHistoryUnchanged() { assert.deepEqual((await db.query("SELECT id,payload FROM source_truth_bundle WHERE workspace_id='workspace' ORDER BY published_at,id")).rows, frozen); } };
}
