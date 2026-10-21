export class F002Error extends Error {
  constructor(code, message, { status = 409, details = null } = {}) {
    super(message);
    this.name = "F002Error";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function requireF002(condition, code, message, options) {
  if (!condition) throw new F002Error(code, message, options);
}
