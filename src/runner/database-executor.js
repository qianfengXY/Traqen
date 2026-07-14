import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";
import { withTimeout } from "./timeout.js";

const forbiddenSql = /\b(?:insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|copy|vacuum|analyze|refresh|reindex|cluster|comment|listen|notify|set|reset)\b/i;

export function assertReadOnlySql(sql) {
  if (typeof sql !== "string" || sql.trim() === "") throw new RunnerPolicyError("Query catalog SQL is empty");
  const normalized = sql.trim().replace(/;$/, "");
  if (normalized.includes(";") || normalized.includes("--") || normalized.includes("/*")) {
    throw new RunnerPolicyError("Read-only SQL must contain exactly one uncommented statement");
  }
  if (!/^(?:select|with)\b/i.test(normalized) || forbiddenSql.test(normalized)) {
    throw new RunnerPolicyError("Database executor accepts only allowlisted read-only SELECT statements");
  }
  return normalized;
}

export class DatabaseExecutor {
  #databaseResolver;
  #timeoutMs;
  #maxRows;

  constructor({ databaseResolver, timeoutMs = 10_000, maxRows = 1_000 } = {}) {
    if (typeof databaseResolver !== "function") throw new TypeError("databaseResolver must be a function");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxRows) || maxRows < 1) throw new TypeError("maxRows must be a positive integer");
    this.#databaseResolver = databaseResolver;
    this.#timeoutMs = timeoutMs;
    this.#maxRows = maxRows;
  }

  async execute(step, { targetPolicy }) {
    if (typeof step.queryRef !== "string" || step.queryRef === "") {
      throw new RunnerPolicyError("DATABASE step requires queryRef; raw SQL is forbidden in TestSpec");
    }
    if (Object.hasOwn(step, "sql") || Object.hasOwn(step, "query")) {
      throw new RunnerPolicyError("Raw SQL is forbidden in TestSpec; use an allowlisted queryRef");
    }
    const queryDefinition = targetPolicy.queryCatalog?.[step.queryRef];
    if (!queryDefinition?.safeRead) {
      throw new RunnerPolicyError(`Database queryRef ${step.queryRef} is not allowlisted as safeRead`);
    }
    const sql = assertReadOnlySql(queryDefinition.sql);
    const parameters = step.parameters ?? [];
    if (!Array.isArray(parameters)) throw new RunnerPolicyError("DATABASE step parameters must be an array");
    const database = await this.#databaseResolver(targetPolicy.databaseRef);
    if (typeof database?.query !== "function") {
      throw new RunnerPolicyError(`Database adapter ${targetPolicy.databaseRef} is unavailable`);
    }

    const started = performance.now();
    const result = await withTimeout(
      (signal) => database.query(sql, parameters, { signal, readOnly: true }),
      this.#timeoutMs,
      `Database query ${step.queryRef}`,
    );
    if (!Array.isArray(result?.rows)) throw new RunnerExecutionError("Database adapter returned no rows array");
    const maxRows = Math.min(queryDefinition.maxRows ?? this.#maxRows, this.#maxRows);
    if (!Number.isInteger(maxRows) || maxRows < 1) throw new RunnerPolicyError("Query maxRows must be positive");
    if (result.rows.length > maxRows) {
      throw new RunnerExecutionError(`Database query ${step.queryRef} exceeded ${maxRows} rows`);
    }
    return {
      id: step.id,
      executor: "DATABASE",
      status: "PASS",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      queryRef: step.queryRef,
      parameters,
      rows: structuredClone(result.rows),
    };
  }
}
