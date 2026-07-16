import { RunnerExecutionError } from "./errors.js";

export async function withTimeout(operation, timeoutMs, label) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new RunnerExecutionError(`${label} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
