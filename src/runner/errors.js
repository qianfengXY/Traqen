export class RunnerPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerPolicyError";
  }
}

export class RunnerExecutionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerExecutionError";
  }
}
