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

export class ScannerAttestationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScannerAttestationError";
  }
}

export class SkillAttestationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SkillAttestationError";
  }
}

export class ReviewAuthenticationError extends Error {
  constructor(message = "A trusted reviewer identity is required") {
    super(message);
    this.name = "ReviewAuthenticationError";
  }
}

export class ReviewAuthorizationError extends Error {
  constructor(message = "The reviewer is not authorized for this decision") {
    super(message);
    this.name = "ReviewAuthorizationError";
  }
}
