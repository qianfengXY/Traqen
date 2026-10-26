import { randomUUID } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";

export const workKey = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const workText = (v, max = 16384) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
export function workFields(v, fields) {
  requireF003(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => fields.includes(k)),
    "F003_WORK_INPUT_INVALID", "工作请求包含未定义字段", { status:422 });
}
export async function readWorkRecord(tx, workspaceId, type, id) {
  return (await tx.query("SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type=$2 AND id=$3", [workspaceId,type,id])).rows[0]?.record_payload ?? null;
}
export async function appendWorkRecord(tx, workspaceId, type, value) {
  const record = { ...value, id:value.id ?? randomUUID(), workspaceId, createdAt:value.createdAt ?? new Date().toISOString() };
  await tx.query(`INSERT INTO understanding_record(project_id,record_type,id,analysis_run_id,status,record_payload,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
  [workspaceId,type,record.id,record.investigationId ?? null,record.status ?? null,JSON.stringify(record),record.createdAt]);
  const saved = await readWorkRecord(tx, workspaceId,type,record.id);
  requireF003(saved && canonicalEncode(saved) === canonicalEncode(record), "F003_WORK_RECORD_CONFLICT", "不可变工作记录已存在或操作键冲突");
  return saved;
}
export async function workOperation(tx, workspaceId, type, actorId, operationId, requestDigest) {
  const row=(await tx.query(`SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type=$2
    AND record_payload->>'actorId'=$3 AND record_payload->>'operationId'=$4`, [workspaceId,type,actorId,operationId])).rows[0]?.record_payload;
  requireF003(!row || row.requestDigest===requestDigest, "F003_OPERATION_CONFLICT", "此工作操作键已经绑定另一份请求");
  return row ?? null;
}
