import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, stat, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { seedSourceDatabase } from "./source-truth-database.js";

const execute = promisify(execFile);

// The operator prepares these existing directories inside the project's
// .review-local/validation-runs before running a fixture. Never fill a missing
// child HOME/temp/cache with the host account's defaults.
export async function fixtureChildEnvironment(parent = process.env) {
  const required = ["HOME", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR"];
  const optional = ["NODE_COMPILE_CACHE", "PLAYWRIGHT_BROWSERS_PATH", "WRANGLER_LOG_PATH", "MINIFLARE_REGISTRY_PATH", "CHROME_LOG_FILE"];
  // Resolve this repository's common directory, including linked worktrees.
  // This is only pathname discovery, not a new source/HEAD admission system.
  const checkout = fileURLToPath(new URL("../../", import.meta.url)), dotGit = path.join(checkout, ".git");
  const metadata = await lstat(dotGit);
  let common;
  if (metadata.isDirectory()) common = await realpath(dotGit);
  else {
    if (!metadata.isFile()) throw new Error("Fixture checkout has no ordinary Git worktree metadata");
    const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(await readFile(dotGit, "utf8"));
    if (!match) throw new Error("Fixture checkout has no ordinary Git worktree metadata");
    const admin = path.resolve(checkout, match[1]);
    common = await realpath(path.resolve(admin, (await readFile(path.join(admin, "commondir"), "utf8")).trim()));
  }
  const root = path.join(path.dirname(common), ".review-local", "validation-runs");
  if (parent.TMPDIR !== root || await realpath(root) !== root)
    throw new Error("Fixture TMPDIR must be the canonical project .review-local/validation-runs directory");
  const environment = {};
  for (const name of [...required, ...optional]) {
    const value = parent[name];
    if (value === undefined && optional.includes(name)) continue;
    if (!path.isAbsolute(value ?? "")) throw new Error(`Fixture ${name} must name an audited project path`);
    const relative = path.relative(root, value);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Fixture ${name} is outside validation-runs`);
    // A log file may not exist yet; its parent must already be canonical.
    const file = name === "WRANGLER_LOG_PATH" || name === "CHROME_LOG_FILE";
    const directory = file ? path.dirname(value) : value;
    if (await realpath(directory) !== directory || !(await stat(directory)).isDirectory()) throw new Error(`Fixture ${name} has no canonical directory`);
    if (file) {
      try { if (await realpath(value) !== value || !(await stat(value)).isFile()) throw new Error(`Fixture ${name} is not a regular log file`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    environment[name] = value;
  }
  for (const name of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "NODE_DISABLE_COMPILE_CACHE", "WRANGLER_WRITE_LOGS", "WRANGLER_SEND_METRICS", "CLOUDFLARE_CF_FETCH_ENABLED"])
    if (parent[name] !== undefined) environment[name] = parent[name];
  return environment;
}

export function fixturePostgresSocketPrefix(root) {
  const prefix = path.join(root, "_p");
  // mkdtemp adds six characters. Include the real socket basename and NUL.
  if (Buffer.byteLength(path.join(`${prefix}XXXXXX`, "s", ".s.PGSQL.5432")) + 1 >= 104)
    throw new Error("Project PostgreSQL socket filename exceeds the platform limit");
  return prefix;
}

// A new owned cluster per fixture. No DATABASE_URL, .env, TCP listener, service
// registration or existing cluster is ever used. Its private directory is kept
// for diagnosis; shutdown affects only the child process started here.
export async function isolatedPostgres(t, { binaries = process.env.F001_TEST_PG_BIN, environment = process.env } = {}) {
  const inherited = await fixtureChildEnvironment(environment);
  const prefix = fixturePostgresSocketPrefix(inherited.TMPDIR);
  if (!binaries || !path.isAbsolute(binaries)) throw new Error("F001_TEST_PG_BIN must name an installed PostgreSQL bin directory");
  const bin = await realpath(binaries);
  const root = await mkdtemp(prefix);
  const data = path.join(root, "data"), socket = path.join(root, "s");
  await mkdir(socket, { mode: 0o700 });
  const env = { ...inherited, PATH: `${bin}:/usr/bin:/bin`, LC_ALL: "C", TZ: "UTC" };
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
