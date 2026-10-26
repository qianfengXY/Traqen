export class F003Error extends Error {
  constructor(code, message, { status = 409, details = null } = {}) {
    super(message); this.name = "F003Error"; this.code = code; this.status = status; this.details = details;
  }
}
// Internal lifecycle signal, never accepted from model output or HTTP input.
export class F003HostShutdown extends Error {
  constructor() { super("F003 host is shutting down"); this.name = "F003HostShutdown"; }
}
export function requireF003(condition, code, message, options) {
  if (!condition) throw new F003Error(code, message, options);
}
