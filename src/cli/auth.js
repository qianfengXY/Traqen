import process from "node:process";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../storage/index.js";
import { contextualDatabase } from "../auth/database.js";
import { AuthRepository } from "../auth/repository.js";
import { AuthService } from "../auth/service.js";
import { privateFile, authPolicy } from "../auth/runtime.js";
import { demand } from "../auth/errors.js";

export async function readPassword(env = process.env, { input = process.stdin, output = process.stdout } = {}) {
  if (env.TRAQEN_AUTH_PASSWORD_FILE)
    return (await privateFile(env.TRAQEN_AUTH_PASSWORD_FILE, { maximum: 1026 })).toString("utf8").replace(/\r?\n$/, "");
  demand(
    input.isTTY,
    "AUTH_SECRET_FILE_REQUIRED",
    "非交互部署必须通过 TRAQEN_AUTH_PASSWORD_FILE 指定私有密码文件",
    400,
  );
  const silent = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    line = createInterface({ input, output: silent, terminal: true });
  try {
    output.write("设置密码（输入不回显）：");
    const first = await line.question("");
    output.write("\n再次输入密码：");
    const second = await line.question("");
    output.write("\n");
    demand(first === second, "AUTH_PASSWORD_MISMATCH", "两次密码不一致", 400);
    return first;
  } finally {
    line.close();
    silent.end();
  }
}
export async function runAuthCommand(args, env = process.env, { output = process.stdout } = {}) {
  const [command, ...tail] = args,
    options = {};
  demand(
    ["initialize", "inventory", "migrate", "recover", "trust-recovery-admin", "finish-recovery"].includes(command),
    "AUTH_COMMAND_INVALID",
    "使用 initialize、inventory、migrate、recover、trust-recovery-admin 或 finish-recovery",
    400,
  );
  for (let i = 0; i < tail.length; i += 2) {
    demand(
      ["--login", "--name", "--account-id", "--mapping-file"].includes(tail[i]) &&
        tail[i + 1] &&
        !tail[i + 1].startsWith("--"),
      "AUTH_COMMAND_INVALID",
      "参数无效；密码只能从终端隐藏输入或私有文件读取",
      400,
    );
    options[tail[i].slice(2)] = tail[i + 1];
  }
  let database, service;
  if (env.TRAQEN_AUTH_DEVELOPMENT === "true") {
    const { openDevelopmentIdentity } = await import("../auth/development.js");
    const runtime = await openDevelopmentIdentity(env);
    database = runtime.database;
    service = runtime.identity.service;
  } else {
    demand(env.DATABASE_URL, "AUTH_CONFIGURATION_INVALID", "需要 DATABASE_URL", 503);
    const ssl = env.POSTGRES_SSL === "disable" ? false : { rejectUnauthorized: env.POSTGRES_SSL !== "no-verify" };
    database = contextualDatabase(new pg.Pool({ connectionString: env.DATABASE_URL, ssl }));
    await applyMigrations(database, fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
    service = new AuthService({
      repository: new AuthRepository(database),
      key: await privateFile(env.TRAQEN_AUTH_KEY_FILE, { maximum: 32 }),
      policy: authPolicy(env),
    });
  }
  try {
    let result;
    if (command === "initialize")
      result = await service.initialize({
        login: options.login,
        displayName: options.name ?? options.login,
        password: await readPassword(env),
      });
    else if (command === "inventory") result = await service.inventory();
    else if (command === "migrate") {
      const mapping = JSON.parse((await privateFile(options["mapping-file"])).toString("utf8"));
      result = await service.migrate({ ...mapping, requestedBy: "DEPLOYMENT", confirmed: mapping.confirmed === true });
    } else if (command === "recover") result = await service.enterRecovery({ requestedBy: "DEPLOYMENT" });
    else if (command === "trust-recovery-admin")
      result = await service.trustRecoveryAdmin({
        accountId: options["account-id"],
        login: options.login,
        displayName: options.name,
        password: await readPassword(env),
        requestedBy: "DEPLOYMENT",
      });
    else if (command === "finish-recovery") {
      demand(
        env.TRAQEN_AUTH_RECOVERY_REVIEWED === "true",
        "AUTH_RECOVERY_CONFIRMATION_REQUIRED",
        "请明确设置 TRAQEN_AUTH_RECOVERY_REVIEWED=true，确认已复核账号、停用状态与空间授权",
        409,
      );
      result = await service.finishRecovery({ requestedBy: "DEPLOYMENT", confirmed: true });
    }
    output.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    await database.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runAuthCommand(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error.code ?? "AUTH_COMMAND_FAILED"}: ${error.code ? error.message : "管理操作失败，请检查部署配置"}\n`,
    );
    process.exitCode = 1;
  });
