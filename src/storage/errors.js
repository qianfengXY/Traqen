export class PersistenceConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PersistenceConflictError";
  }
}

export class RunnerAttestationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerAttestationError";
  }
}
