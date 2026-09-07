import { parseArgs } from "node:util";
import { SourceTruthError, requireValue } from "../source-truth/errors.js";
import { administerSourceTruth } from "../source-truth/administration.js";

const usage = `F001 部署维护工具（不读取 .env，不默认连接任何数据库）
  provision-members --config FILE --database-config FILE --operator NAME
  grant --config FILE --database-config FILE --operator NAME --workspace ID --tenant ID --member ID --role READ|MAINTAIN|REVOKED
  backup --config FILE --database-config FILE --operator NAME
  verify --config FILE --set ID --operator NAME
  import --config FILE --database-config FILE --set ID --operator NAME
  restore --config FILE --database-config TARGET_FILE --target-root EMPTY_DIRECTORY --set ID --operator NAME

FILE 须为服务账号持有的私有绝对路径。database-config 是只含 host、port、database、user、password 的 JSON；host 必须为明确的本机 PostgreSQL socket。
restore 只写新的空数据库和空专用目录，原数据库可离线。成功后仍需启动前安全核验；未完成任务等待用户核对恢复点。没有删除、覆盖或绕过加密/独立故障域的开关。
`;

try {
  const { values, positionals } = parseArgs({ options: Object.fromEntries(["config", "database-config", "operator", "workspace", "tenant", "member", "role", "set", "target-root"].map((key) => [key, { type: "string" }])), allowPositionals: true, strict: true });
  const command = positionals[0];
  if (positionals.length === 1 && command === "help") process.stdout.write(usage);
  else {
    requireValue(positionals.length === 1 && ["provision-members", "grant", "backup", "verify", "import", "restore"].includes(command), "SOURCE_ADMIN_ARGUMENT_REQUIRED", "请先使用 help 查看明确的操作参数", { status: 400 });
    for (const key of ["config", "operator", ...(command !== "verify" ? ["database-config"] : []), ...(["verify", "import", "restore"].includes(command) ? ["set"] : []), ...(command === "restore" ? ["target-root"] : []), ...(command === "grant" ? ["workspace", "tenant", "member", "role"] : [])])
      requireValue(typeof values[key] === "string" && values[key].trim(), "SOURCE_ADMIN_ARGUMENT_REQUIRED", `缺少明确参数 --${key}`, { status: 400 });
    process.stdout.write(`${JSON.stringify(await administerSourceTruth(command, values))}\n`);
  }
} catch (error) {
  const known = error instanceof SourceTruthError;
  process.stderr.write(`${JSON.stringify({ code: known ? error.code : "SOURCE_ADMIN_FAILED", message: known ? error.message : "维护操作失败；请检查私有配置与服务状态，不假定已经完成" })}\n`);
  process.exitCode = 1;
}
