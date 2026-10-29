import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { seedSourceDatabase } from "./source-truth-database.js";
import { sourceTruthTestRoot, sourceTruthTestEnvironment } from "./source-truth-test-paths.js";

const execute = promisify(execFile);

// A new owned cluster per fixture. No DATABASE_URL, .env, TCP listener, service
// registration or existing cluster is ever used. Its private directory is kept
// for diagnosis; shutdown affects only the child process started here.
export async function isolatedPostgres(t, { binaries = process.env.F001_TEST_PG_BIN, parent } = {}) {
  if (!binaries || !path.isAbsolute(binaries)) throw new Error("F001_TEST_PG_BIN must name an installed PostgreSQL bin directory");
  const bin = await realpath(binaries);
  const root = await sourceTruthTestRoot("tq-f001-pg", parent);
  // Keep the socket role short enough for macOS sockaddr_un, independent of
  // the nesting/filename lengths of the retained evidence and data directory.
  const data = path.join(root, "data"), socket = await sourceTruthTestRoot("s");
  if (Buffer.byteLength(path.join(socket, ".s.PGSQL.5432")) >= (process.platform === "darwin" ? 104 : 108))
    throw new Error("Project-local PostgreSQL socket pathname exceeds the native limit");
  const env = { ...await sourceTruthTestEnvironment(root), PATH: `${bin}:/usr/bin:/bin` };
  await execute(path.join(bin, "initdb"), ["-D", data, "--username=f001_test", "--encoding=UTF8", "--no-locale", "--auth-local=trust", "--auth-host=reject"], { env, timeout: 30000, maxBuffer: 1024 * 1024 });
  const pools = new Set();
  const connection = (database = "postgres") => ({ host: socket, port: 5432, database, user: "f001_test", password: "", ssl: false,
    max: 8, connectionTimeoutMillis: 2000, statement_timeout: 15000, application_name: "f001-isolated-test" });
  let child = null, exit = null, tail = "";
  async function start() {
    child = spawn(path.join(bin, "postgres"), ["-D", data, "-k", socket, "-h", "", "-c", "unix_socket_permissions=0700", "-c", "max_connections=24", "-c", "shared_buffers=16MB"], { env, stdio: ["ignore", "pipe", "pipe"] });
    exit = once(child, "exit");
    for (const output of [child.stdout, child.stderr]) output.on("data", (chunk) => { tail = (tail + chunk.toString()).slice(-8192); });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error(`Isolated PostgreSQL exited during startup: ${tail}`);
      const client = new pg.Client(connection());
      try { await client.connect(); await client.query("SELECT 1"); return; }
      catch { await setTimeout(25); }
      finally { await client.end().catch(() => {}); }
    }
    throw new Error(`Isolated PostgreSQL startup deadline exceeded: ${tail}`);
  }
  async function stop() {
    await Promise.all([...pools].map((pool) => pool.end())); pools.clear();
    if (child && child.exitCode === null) { child.kill("SIGINT"); await exit; }
    child = null;
  }
  async function crash() {
    // PostgreSQL immediate shutdown aborts active transactions and forces WAL
    // recovery at the next start. Signal only the child this fixture spawned;
    // never resolve a PID from a port, service name or another cluster.
    if (!child || child.exitCode !== null) throw new Error("No owned PostgreSQL child is running");
    child.kill("SIGQUIT");
    await exit;
    child = null;
    // Keep client pools until callers have observed/released interrupted work.
    // restart()/stop() closes them after the failed transaction has unwound.
  }
  t.after(stop);
  await start();
  function pool(database = "postgres") {
    const result = new pg.Pool(connection(database));
    result.exec = (sql) => result.query(sql);
    // An immediate-shutdown test can disconnect a checked-out transaction
    // while its JS barrier is held. Its next query still rejects, but the
    // client's asynchronous error event must not escape the owned fixture.
    result.on("connect", client => client.on("error", () => {}));
    result.on("error", () => {}); // Restart tests deliberately disconnect idle clients.
    pools.add(result);
    return result;
  }
  async function createDatabase({ seed = true } = {}) {
    const name = `f001_${randomUUID().replaceAll("-", "")}`;
    await pool().query(`CREATE DATABASE "${name}"`);
    const db = pool(name);
    return { name, ...(seed ? await seedSourceDatabase(db) : { db }) };
  }
  return { root, data, socket, bin, env, connection, pool, createDatabase, stop, start, crash,
    async restart() { await stop(); await start(); } };
}
