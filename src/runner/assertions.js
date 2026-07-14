import { canonicalJson } from "../domain/index.js";
import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";

function valuesEqual(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

function jsonPathValue(value, expression) {
  if (typeof expression !== "string" || !expression.startsWith("$.")) {
    throw new RunnerPolicyError(`Unsupported JSONPath expression: ${expression}`);
  }
  const tokens = expression
    .slice(2)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = value;
  for (const token of tokens) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, token)) {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

function result(id, actual, expected) {
  const passed = valuesEqual(actual, expected);
  return {
    id,
    status: passed ? "PASS" : "FAIL",
    actual,
    expected,
    message: passed ? null : `Expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`,
  };
}

export function evaluateAssertion(assertion, stepResults) {
  const step = stepResults.get(assertion.stepId);
  if (!step) throw new RunnerPolicyError(`Assertion ${assertion.id} references unknown step ${assertion.stepId}`);
  if (step.status !== "PASS") {
    throw new RunnerExecutionError(`Assertion ${assertion.id} cannot run because step ${assertion.stepId} failed`);
  }

  switch (assertion.type) {
    case "HTTP_STATUS":
      if (step.executor !== "HTTP") throw new RunnerPolicyError("HTTP_STATUS requires an HTTP step");
      return result(assertion.id, step.response.status, assertion.expected);
    case "RESPONSE_HEADER": {
      if (step.executor !== "HTTP") throw new RunnerPolicyError("RESPONSE_HEADER requires an HTTP step");
      const name = String(assertion.name ?? "").toLowerCase();
      if (!name) throw new RunnerPolicyError("RESPONSE_HEADER requires a header name");
      return result(assertion.id, step.response.headers[name] ?? null, assertion.expected);
    }
    case "JSON_PATH":
      if (step.executor !== "HTTP") throw new RunnerPolicyError("JSON_PATH requires an HTTP step");
      return result(assertion.id, jsonPathValue(step.response.json, assertion.expression), assertion.expected);
    case "DATABASE_ROW_COUNT":
      if (step.executor !== "DATABASE") throw new RunnerPolicyError("DATABASE_ROW_COUNT requires a DATABASE step");
      return result(assertion.id, step.rows.length, assertion.expected);
    case "DATABASE_FIELD": {
      if (step.executor !== "DATABASE") throw new RunnerPolicyError("DATABASE_FIELD requires a DATABASE step");
      const rowIndex = assertion.row ?? 0;
      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        throw new RunnerPolicyError("DATABASE_FIELD row must be a non-negative integer");
      }
      const field = String(assertion.field ?? "");
      if (!field) throw new RunnerPolicyError("DATABASE_FIELD requires a field");
      return result(assertion.id, step.rows[rowIndex]?.[field], assertion.expected);
    }
    default:
      throw new RunnerPolicyError(`Unsupported assertion type ${assertion.type}`);
  }
}
