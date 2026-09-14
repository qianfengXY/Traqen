import { spawn } from "node:child_process";
import { realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { requireValue, SourceTruthError } from "./errors.js";

// Internal deployment tools only. PostgreSQL archive SQL is trusted application
// schema/data, never a repository file or an uploaded archive. No shell input,
// user-selected executable or database URL is accepted by a public endpoint.
export class SourcePostgresArchive {
  constructor({ binDirectory, connection, maxBytes = "68719476736", timeoutMs = 3600000 }) {
    Object.assign(this, { binDirectory, connection, maxBytes: BigInt(maxBytes), timeoutMs });
  }
  async prove(database) {
    const c = this.connection;
    requireValue(c && path.isAbsolute(c.host ?? "") && typeof c.database === "string" && c.database && typeof c.user === "string" && c.user,
      "SOURCE_DATABASE_PROTECTION_UNVERIFIED", "首期配套备份需要明确的本机受保护 PostgreSQL 连接，不能猜测远程数据库的静态保护", { status: 503 });
    const { rows } = await database.query("SELECT current_database() AS name,current_user AS username,inet_server_addr() AS address,current_setting('data_directory') AS data,current_setting('unix_socket_directories') AS sockets,current_setting('server_version_num') AS version");
    requireValue(rows[0]?.name === c.database && rows[0].username === c.user && rows[0].address === null,
      "SOURCE_DATABASE_BINDING_MISMATCH", "备份工具与运行数据库绑定不一致", { status: 503 });
    const socket = await realpath(c.host);
    let matched = false;
    for (const location of rows[0].sockets.split(",")) if (path.isAbsolute(location.trim()) && await realpath(location.trim()).catch(() => null) === socket) matched = true;
    requireValue(matched, "SOURCE_DATABASE_BINDING_MISMATCH", "备份工具未绑定运行数据库的私有 socket", { status: 503 });
    requireValue(path.isAbsolute(this.binDirectory ?? "") && this.maxBytes > 0n && this.maxBytes <= BigInt(Number.MAX_SAFE_INTEGER)
      && Number.isInteger(this.timeoutMs) && this.timeoutMs > 0 && this.timeoutMs <= 3600000,
    "SOURCE_BACKUP_CONFIGURATION_INVALID", "数据库备份工具或资源预算无效", { status: 503 });
    const data = await realpath(rows[0].data);
    const permissions = await lstat(data);
    requireValue(permissions.isDirectory() && (permissions.mode & 0o077) === 0, "SOURCE_DATABASE_PROTECTION_UNVERIFIED", "数据库目录权限未隔离", { status: 503 });
    return { data, database: c.database, version: rows[0].version };
  }
  environment() {
    const c = this.connection;
    requireValue([c.host, c.database, c.user, c.password ?? ""].every((v) => typeof v === "string" && !v.includes("\0")), "SOURCE_BACKUP_CONFIGURATION_INVALID", "数据库连接配置无效", { status: 503 });
    return { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", PGHOST: c.host, PGPORT: String(c.port ?? 5432), PGDATABASE: c.database,
      PGUSER: c.user, PGPASSWORD: c.password ?? "", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "traqen-source-backup" };
  }
  async run(program, args) {
    requireValue(["pg_dump", "pg_restore", "psql"].includes(program), "SOURCE_BACKUP_CONFIGURATION_INVALID", "未知数据库备份工具");
    const executable = await realpath(path.join(this.binDirectory, program));
    const stat = await lstat(executable);
    requireValue(stat.isFile() && !(stat.mode & 0o022), "SOURCE_BACKUP_CONFIGURATION_INVALID", "数据库工具不可由普通成员改写", { status: 503 });
    const child = spawn("/bin/sh", ["-c", 'umask 077; ulimit -f "$1" || exit 125; shift; exec "$@"', "source-backup-tool",
      String(Math.max(1, Number(this.maxBytes / 1024n))), executable, ...args], { env: this.environment(), stdio: ["ignore", "ignore", "pipe"], detached: true });
    let failed = false;
    // Do not expose PostgreSQL errors containing filesystem paths, credentials
    // or row contents. A bounded machine-readable diagnostic is emitted instead.
    child.stderr.resume();
    const done = new Promise((resolve) => { child.once("error", () => { failed = true; resolve(null); }); child.once("close", resolve); });
    const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
    const timer = setTimeout(stop, this.timeoutMs);
    try {
      const code = await done;
      if (failed || code !== 0) throw new SourceTruthError("SOURCE_DATABASE_ARCHIVE_FAILED", "数据库配套备份或隔离还原失败；原始材料保留，不能标记恢复完成", { status: 503 });
    } finally { clearTimeout(timer); stop(); }
  }
  async dump(snapshot, file) {
    requireValue(/^[A-Fa-f0-9-]+$/.test(snapshot), "SOURCE_BACKUP_WATERLINE_INVALID", "数据库水位无效");
    await this.run("pg_dump", ["--no-password", "--format=custom", "--compress=0", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${file}`]);
  }
  async sql(archive, output) { await this.run("pg_restore", ["--no-owner", "--no-privileges", `--file=${output}`, archive]); }
  async restore(sql) { await this.run("psql", ["--no-password", "--no-psqlrc", "--single-transaction", "--set=ON_ERROR_STOP=1", `--file=${sql}`]); }
}
