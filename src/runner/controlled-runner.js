import {
  createExecutionEvidenceBundle,
  signExecutionEvidenceBundle,
  validateTestSpec,
} from "../domain/index.js";
import { evaluateAssertion } from "./assertions.js";
import { RunnerExecutionError, RunnerPolicyError } from "./errors.js";
import { authenticateRunnerTask, bindRunnerTaskPolicy } from "./task.js";
import { interpolateValue, redactValue, resolveVariables, uniqueRedactions } from "./values.js";

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function bindingManifest(execution, runner) {
  return {
    executionId: execution.id,
    testSpecId: execution.testSpecId,
    testSpecVersion: execution.testSpecVersion,
    snapshotManifestId: execution.snapshotManifestId,
    deploymentId: execution.deploymentId,
    runnerId: runner.id,
    runnerVersion: runner.version,
  };
}

function mergeFixtureBindings(variables, bindings) {
  const merged = { ...variables };
  for (const [name, value] of Object.entries(bindings)) {
    if (Object.hasOwn(merged, name)) {
      throw new RunnerPolicyError(`Fixture binding ${name} conflicts with a TestSpec variable`);
    }
    merged[name] = structuredClone(value);
  }
  return merged;
}

export class ControlledRunner {
  #runner;
  #runnerSecret;
  #targetPolicyResolver;
  #secretResolver;
  #executors;
  #fixtureLifecycle;
  #clock;
  #usedNonces;

  constructor({
    runner,
    runnerSecret,
    targetPolicyResolver,
    secretResolver,
    executors,
    fixtureLifecycle = null,
    nonceRegistry = new Set(),
    clock = () => new Date(),
  }) {
    this.#runner = Object.freeze({
      id: requireString(runner?.id, "runner.id"),
      version: requireString(runner?.version, "runner.version"),
    });
    this.#runnerSecret = requireString(runnerSecret, "runnerSecret");
    if (typeof targetPolicyResolver !== "function") {
      throw new TypeError("targetPolicyResolver must be a function");
    }
    if (typeof secretResolver !== "function") throw new TypeError("secretResolver must be a function");
    if (executors === null || typeof executors !== "object") throw new TypeError("executors must be an object");
    if (typeof nonceRegistry?.has !== "function" || typeof nonceRegistry?.add !== "function") {
      throw new TypeError("nonceRegistry must provide has(nonce) and add(nonce)");
    }
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#targetPolicyResolver = targetPolicyResolver;
    this.#secretResolver = secretResolver;
    this.#executors = new Map(Object.entries(executors));
    if (fixtureLifecycle !== null && typeof fixtureLifecycle?.createSession !== "function") {
      throw new TypeError("fixtureLifecycle must provide createSession(testSpec, context)");
    }
    this.#fixtureLifecycle = fixtureLifecycle;
    this.#usedNonces = nonceRegistry;
    this.#clock = clock;
  }

  #now() {
    const value = this.#clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new RunnerExecutionError("Runner clock returned an invalid Date");
    }
    return value.toISOString();
  }

  async run(attestedTask) {
    const acceptedAt = this.#clock();
    if (!(acceptedAt instanceof Date) || !Number.isFinite(acceptedAt.getTime())) {
      throw new RunnerExecutionError("Runner clock returned an invalid Date");
    }
    const authenticatedTask = authenticateRunnerTask(attestedTask, {
      runnerId: this.#runner.id,
      secret: this.#runnerSecret,
      now: acceptedAt,
      usedNonces: this.#usedNonces,
    });
    const targetPolicy = await this.#targetPolicyResolver(
      authenticatedTask.testSpec.environment?.target,
      authenticatedTask.projectId,
    );
    if (!targetPolicy) {
      throw new RunnerPolicyError(`Target ${authenticatedTask.testSpec.environment?.target} is not configured`);
    }
    const task = bindRunnerTaskPolicy(authenticatedTask, {
      policy: targetPolicy,
      usedNonces: this.#usedNonces,
    });
    const { projectId, executionId, testSpec, snapshotManifest } = task;
    const validation = validateTestSpec(testSpec, this.#clock);
    if (!validation.executable) {
      throw new RunnerPolicyError(
        `TestSpec is not executable: ${validation.violations.map((item) => item.code).join(", ")}`,
      );
    }
    if (!snapshotManifest?.complete) throw new RunnerPolicyError("Runner requires a complete snapshot manifest");
    const deploymentId = snapshotManifest.components?.deployment?.id;
    if (!deploymentId) throw new RunnerPolicyError("Snapshot manifest has no deployment component");
    if (testSpec.sourceSnapshotId && testSpec.sourceSnapshotId !== snapshotManifest.id) {
      throw new RunnerPolicyError("TestSpec sourceSnapshotId does not match the execution snapshot manifest");
    }

    if (!(targetPolicy.allowedOperationLevels ?? []).includes(testSpec.environment.operationLevel)) {
      throw new RunnerPolicyError(
        `Operation level ${testSpec.environment.operationLevel} is not allowed for target ${testSpec.environment.target}`,
      );
    }
    if (!["SAFE_READ", "CONTROLLED_WRITE"].includes(testSpec.environment.operationLevel)) {
      throw new RunnerPolicyError(
        `Runner does not execute operation level ${testSpec.environment.operationLevel}`,
      );
    }
    if (testSpec.environment.operationLevel === "CONTROLLED_WRITE" && !this.#fixtureLifecycle) {
      throw new RunnerPolicyError("CONTROLLED_WRITE requires a trusted fixture lifecycle executor");
    }

    const resolvedVariables = await resolveVariables(testSpec.variables, (secretRef) =>
      this.#secretResolver(secretRef, { projectId, target: testSpec.environment.target }),
    );
    let variables = resolvedVariables.variables;
    const { secretValues } = resolvedVariables;
    const startedAt = acceptedAt.toISOString();
    const rawStepResults = [];
    const stepResultsById = new Map();
    let rawSetupResult = { status: "SKIPPED" };
    let rawCleanupResult = { status: "SKIPPED" };
    let fixtureSession = null;
    let fixtureState = null;
    let setupSucceeded = false;
    let executionError = null;

    if (testSpec.environment.operationLevel === "CONTROLLED_WRITE") {
      fixtureSession = await this.#fixtureLifecycle.createSession(testSpec, {
        targetPolicy,
        projectId,
        operationLevel: testSpec.environment.operationLevel,
      });
      try {
        const setup = await fixtureSession.setup(variables);
        variables = mergeFixtureBindings(variables, setup.bindings);
        fixtureState = setup.state;
        rawSetupResult = setup.result;
        setupSucceeded = true;
      } catch (error) {
        executionError = error;
        rawSetupResult = {
          status: "ERROR",
          seedRef: fixtureSession.seedRef,
          message: error.message,
        };
      }
    }

    if (!executionError) {
      for (const step of testSpec.steps) {
        const executor = this.#executors.get(step.executor);
        if (!executor || typeof executor.execute !== "function") {
          executionError = new RunnerPolicyError(`Executor ${step.executor} is not configured`);
          rawStepResults.push({
            id: step.id,
            executor: step.executor,
            status: "ERROR",
            message: executionError.message,
          });
          break;
        }
        try {
          const resolvedStep = interpolateValue(step, variables);
          const result = await executor.execute(resolvedStep, {
            targetPolicy,
            projectId,
            operationLevel: testSpec.environment.operationLevel,
            secretValues,
          });
          rawStepResults.push(result);
          stepResultsById.set(step.id, result);
        } catch (error) {
          executionError = error;
          rawStepResults.push({
            id: step.id,
            executor: step.executor,
            status: "ERROR",
            message: error.message,
          });
          break;
        }
      }
    }

    const rawAssertionResults = testSpec.assertions.map((assertion) => {
      if (executionError) {
        return {
          id: assertion.id,
          status: "ERROR",
          message: `Assertion was not evaluated: ${executionError.message}`,
        };
      }
      try {
        return evaluateAssertion(assertion, stepResultsById);
      } catch (error) {
        return { id: assertion.id, status: "ERROR", message: error.message };
      }
    });

    if (fixtureSession) {
      try {
        rawCleanupResult = await fixtureSession.cleanup({
          variables,
          state: fixtureState,
          setupSucceeded,
        });
      } catch (error) {
        rawCleanupResult = {
          status: "ERROR",
          seedRef: fixtureSession.seedRef,
          message: error.message,
          isolationRequired: true,
          compensationRef: fixtureSession.compensationRef,
        };
      }
    }

    const executionRedactions = [];
    const setupResult = redactValue(rawSetupResult, secretValues, "/setup", executionRedactions);
    const stepResults = redactValue(rawStepResults, secretValues, "/stepResults", executionRedactions);
    const assertionResults = redactValue(
      rawAssertionResults,
      secretValues,
      "/assertionResults",
      executionRedactions,
    );
    const cleanupResult = redactValue(rawCleanupResult, secretValues, "/cleanup", executionRedactions);
    const finishedAt = this.#now();
    const execution = {
      id: executionId,
      testSpecId: testSpec.id,
      testSpecVersion: testSpec.version,
      snapshotManifestId: snapshotManifest.id,
      deploymentId,
      runner: this.#runner,
      completionReason: "COMPLETED",
      startedAt,
      finishedAt,
      attempts: [
        {
          number: 1,
          startedAt,
          finishedAt,
          phaseStatus: executionError ? "ERROR" : "PASS",
          setup: setupResult,
          stepResults,
          assertionResults,
          cleanup: cleanupResult,
        },
      ],
    };
    const commonBinding = bindingManifest(execution, this.#runner);
    const evidence = [];
    for (const stepResult of stepResults) {
      const redactions = [...executionRedactions];
      const manifest = redactValue(
        {
          ...commonBinding,
          stepResult,
          redactions: [],
        },
        secretValues,
        "",
        redactions,
      );
      manifest.redactions = uniqueRedactions(redactions);
      evidence.push({
        id: `EVIDENCE-${executionId}-${stepResult.id}`,
        type: stepResult.executor === "DATABASE" ? "DATABASE" : stepResult.executor === "HTTP" ? "HTTP" : "OTHER",
        freshness: "FRESH",
        manifest,
        createdAt: finishedAt,
      });
    }
    if (testSpec.environment.operationLevel === "CONTROLLED_WRITE") {
      evidence.push({
        id: `EVIDENCE-${executionId}-LIFECYCLE`,
        type: "OTHER",
        freshness: cleanupResult.status === "PASS" ? "FRESH" : "INCOMPLETE",
        manifest: {
          ...commonBinding,
          lifecycle: { setup: setupResult, cleanup: cleanupResult },
          redactions: uniqueRedactions(executionRedactions),
        },
        createdAt: finishedAt,
      });
    }
    const assertionManifest = {
      ...commonBinding,
      assertionResults,
      redactions: uniqueRedactions(executionRedactions),
    };
    evidence.push({
      id: `EVIDENCE-${executionId}-ASSERTIONS`,
      type: "ASSERTION",
      freshness: "FRESH",
      manifest: assertionManifest,
      createdAt: finishedAt,
    });

    const bundle = createExecutionEvidenceBundle({ execution, evidence }, () => new Date(finishedAt));
    return signExecutionEvidenceBundle(projectId, bundle, this.#runnerSecret);
  }

  async runAndSubmit(task, submitter) {
    if (typeof submitter !== "function") throw new TypeError("submitter must be a function");
    const bundle = await this.run(task);
    return submitter(task.projectId, bundle);
  }
}
