export class AuthError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
export function demand(condition, code, message, status = 403, details) {
  if (!condition) throw new AuthError(status, code, message, details);
}
