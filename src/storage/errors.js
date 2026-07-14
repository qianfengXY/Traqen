export class PersistenceConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PersistenceConflictError";
  }
}
