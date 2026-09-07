export class SourceTruthError extends Error {
  constructor(code, message, { status = 409, details = null, cause } = {}) {
    super(message, { cause });
    this.name = "SourceTruthError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function fail(code, message, options) { throw new SourceTruthError(code, message, options); }

export function requireValue(condition, code, message, options) {
  if (!condition) fail(code, message, options);
}
