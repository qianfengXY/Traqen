import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";
import { withTimeout } from "./timeout.js";
import { interpolateValue } from "./values.js";

const seedTypes = new Set(["SEED", "SEED_API", "SEED_DATABASE"]);

function requireObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerPolicyError(`${fieldName} must be an object`);
  }
  return value;
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RunnerPolicyError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function evidenceDetails(value, fieldName) {
  if (value === undefined || value === null) return null;
  try {
    return structuredClone(value);
  } catch {
    throw new RunnerExecutionError(`${fieldName} must be structured-clone serializable`);
  }
}

function handlerResult(value, fieldName) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerExecutionError(`${fieldName} must return an object`);
  }
  return value;
}

export class FixtureLifecycleExecutor {
  #handlerResolver;
  #timeoutMs;

  constructor({ handlerResolver, timeoutMs = 10_000 } = {}) {
    if (typeof handlerResolver !== "function") throw new TypeError("handlerResolver must be a function");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
    this.#handlerResolver = handlerResolver;
    this.#timeoutMs = timeoutMs;
  }

  async createSession(testSpec, context) {
    if (testSpec.environment.operationLevel !== "CONTROLLED_WRITE") {
      throw new RunnerPolicyError("Fixture lifecycle sessions are only valid for CONTROLLED_WRITE");
    }
    const seeds = testSpec.preconditions.filter((item) => seedTypes.has(item.type));
    if (seeds.length !== 1) {
      throw new RunnerPolicyError("CONTROLLED_WRITE requires exactly one trusted Seed precondition");
    }
    const seed = requireObject(seeds[0], "Seed precondition");
    const seedRef = requireString(seed.seedRef, "Seed precondition seedRef");
    const cleanup = requireObject(testSpec.cleanup, "TestSpec cleanup");
    const strategy = requireString(cleanup.strategy, "TestSpec cleanup strategy");
    const definition = context.targetPolicy.fixtureCatalog?.[seedRef];
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new RunnerPolicyError(`Seed ${seedRef} is not allowlisted by the target policy`);
    }
    if (
      !Array.isArray(definition.cleanupStrategies) ||
      !definition.cleanupStrategies.includes(strategy)
    ) {
      throw new RunnerPolicyError(`Cleanup strategy ${strategy} is not allowlisted for Seed ${seedRef}`);
    }
    const handler = await this.#handlerResolver(seedRef, {
      projectId: context.projectId,
      target: testSpec.environment.target,
      targetPolicy: context.targetPolicy,
    });
    if (typeof handler?.setup !== "function" || typeof handler?.cleanup !== "function") {
      throw new RunnerPolicyError(`Trusted fixture handler ${seedRef} is unavailable`);
    }
    const protocolVersion = requireString(
      definition.protocolVersion ?? "1.0.0",
      `fixtureCatalog.${seedRef}.protocolVersion`,
    );
    const compensationRef = definition.compensationRef == null
      ? null
      : requireString(definition.compensationRef, `fixtureCatalog.${seedRef}.compensationRef`);

    return Object.freeze({
      seedRef,
      compensationRef,
      setup: async (variables) => {
        const resolvedSeed = interpolateValue(seed, variables);
        const output = handlerResult(
          await withTimeout(
            (signal) => handler.setup(resolvedSeed, { ...context, signal }),
            this.#timeoutMs,
            `Fixture setup ${seedRef}`,
          ),
          `Fixture setup ${seedRef}`,
        );
        const bindings = output.bindings ?? {};
        if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) {
          throw new RunnerExecutionError(`Fixture setup ${seedRef} bindings must be an object`);
        }
        return {
          bindings: structuredClone(bindings),
          state: output.state ?? null,
          result: {
            status: "PASS",
            seedRef,
            protocolVersion,
            details: evidenceDetails(output.evidence, `Fixture setup ${seedRef} evidence`),
          },
        };
      },
      cleanup: async ({ variables, state, setupSucceeded }) => {
        const resolvedCleanup = interpolateValue(cleanup, variables);
        const output = handlerResult(
          await withTimeout(
            (signal) => handler.cleanup({
              seed: interpolateValue(seed, variables),
              cleanup: resolvedCleanup,
              state,
              setupSucceeded,
            }, { ...context, signal }),
            this.#timeoutMs,
            `Fixture cleanup ${seedRef}`,
          ),
          `Fixture cleanup ${seedRef}`,
        );
        return {
          status: "PASS",
          seedRef,
          strategy,
          protocolVersion,
          details: evidenceDetails(output.evidence, `Fixture cleanup ${seedRef} evidence`),
        };
      },
    });
  }
}
