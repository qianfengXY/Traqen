import { execFile } from "node:child_process";
import path from "node:path";

import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RunnerPolicyError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function commandResult(error, stdout, stderr) {
  if (!error) return { exitCode: 0, stdout, stderr };
  if (Number.isInteger(error.code)) return { exitCode: error.code, stdout, stderr };
  throw new RunnerExecutionError(`Existing test process failed to execute: ${error.message}`);
}

export class ExistingTestExecutor {
  #timeoutMs;
  #maxOutputBytes;

  constructor({ timeoutMs = 60_000, maxOutputBytes = 1024 * 1024 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new TypeError("maxOutputBytes must be a positive integer");
    }
    this.#timeoutMs = timeoutMs;
    this.#maxOutputBytes = maxOutputBytes;
  }

  async execute(step, { targetPolicy, operationLevel }) {
    const testRef = requireString(step.testRef, "EXISTING_TEST step testRef");
    for (const forbidden of ["command", "args", "cwd", "env", "environment"]) {
      if (Object.hasOwn(step, forbidden)) {
        throw new RunnerPolicyError(`EXISTING_TEST step cannot supply ${forbidden}; use a trusted testRef`);
      }
    }
    const definition = targetPolicy.testCatalog?.[testRef];
    if (!definition?.trusted) throw new RunnerPolicyError(`Existing test ${testRef} is not trusted`);
    if (!(definition.allowedOperationLevels ?? []).includes(operationLevel)) {
      throw new RunnerPolicyError(`Existing test ${testRef} is not allowed for ${operationLevel}`);
    }
    const command = requireString(definition.command, `testCatalog.${testRef}.command`);
    if (!path.isAbsolute(command)) {
      throw new RunnerPolicyError(`Existing test ${testRef} command must be an absolute path`);
    }
    const cwd = requireString(definition.cwd, `testCatalog.${testRef}.cwd`);
    if (!path.isAbsolute(cwd)) {
      throw new RunnerPolicyError(`Existing test ${testRef} cwd must be an absolute path`);
    }
    const args = definition.args ?? [];
    if (
      !Array.isArray(args) ||
      args.length > 100 ||
      args.some((argument) => typeof argument !== "string" || argument.length > 4096)
    ) {
      throw new RunnerPolicyError(`Existing test ${testRef} args exceed the trusted command limits`);
    }
    const timeoutMs = Math.min(definition.timeoutMs ?? this.#timeoutMs, this.#timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RunnerPolicyError(`Existing test ${testRef} timeoutMs must be a positive integer`);
    }

    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      execFile(command, args, {
        cwd,
        env: {},
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: this.#maxOutputBytes,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        try {
          resolve(commandResult(error, stdout, stderr));
        } catch (executionError) {
          reject(executionError);
        }
      });
    });
    return {
      id: step.id,
      executor: "EXISTING_TEST",
      status: "PASS",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      testRef,
      command: { executable: command, args: structuredClone(args), cwd },
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
