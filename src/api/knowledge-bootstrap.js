import { createF003Runtime } from "../business-knowledge/runtime.js";
import { createF002Runtime } from "../deterministic-facts/runtime.js";

// Both consumers use the same F001 authority. Construct the durable F003
// resolver first; no caller-provided investigation or legacy job is authority.
export async function createKnowledgeRuntime({ sourceRuntime, application, cursorSecret }) {
  const business = await createF003Runtime({ sourceRuntime, application });
  let facts;
  try {
    facts = await createF002Runtime({ sourceRuntime, cursorSecret, consumerResolver: business.services.investigations });
  } catch (error) {
    await business.close();
    throw error;
  }
  let starting = null, closing = null, draining = null, closed = false;
  const drain = () => draining ??= (async () => {
    // Fence both producers before waiting on startup or running work. F2 close
    // drains schedulers only: its reader, request services and F001 pool remain
    // available. Keep F3's RUNNING consumer lease until accepted C03 work has
    // finished, then abort/release unfinished model work for durable recovery.
    const failures = [];
    try { business.stopAccepting(); } catch (error) { failures.push(error); }
    try { await facts.close(); } catch (error) { failures.push(error); }
    try { await business.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Knowledge runtimes failed to drain");
  })();
  const close = () => closing ??= (async () => {
    closed = true;
    const drained = drain();
    // Observe rejection immediately while a concurrent startup unwinds.
    const settled = drained.catch(error => error);
    await starting?.catch(() => {});
    await settled;
    await drained;
  })();
  return {
    facts, business,
    httpOptions: {
      sourceTruthHandler: sourceRuntime.sourceTruthHandler,
      sourceTruthAllowedOrigins: sourceRuntime.configuration.origins,
      deterministicFactsHandler: facts.deterministicFactsHandler,
      deterministicFactsAllowedOrigins: sourceRuntime.configuration.origins,
      businessKnowledgeHandler: business.businessKnowledgeHandler,
      businessKnowledgeAllowedOrigins: sourceRuntime.configuration.origins,
    },
    start() {
      if (closed) return Promise.reject(new Error("Knowledge runtime is closed"));
      return starting ??= (async () => {
        // Recover existing technical requests before dispatching investigations.
        try { await facts.start(); if (!closed) await business.start(); }
        catch (error) { closed = true; await drain(); throw error; }
      })();
    },
    close,
  };
}
