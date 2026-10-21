// Ownership heartbeat, not permission to extend an expired lease. The supplied
// renewal must recheck database time, generation and current authorization.
export function maintainLease(renew, leaseMs) {
  let stopped = false, failure = null, timer, pending = Promise.resolve();
  const controller = new AbortController();
  const schedule = () => {
    timer = setTimeout(() => {
      pending = Promise.resolve().then(renew).then(() => { failure = null; }).catch(error => { failure = error; })
        .then(() => {
          if (stopped) return;
          if (!failure || /^(?:08\w{3}|ECONNRESET|ETIMEDOUT|EPIPE|57P01|40001|40P01)$/.test(failure.code ?? "")) schedule();
          else controller.abort(failure);
        });
    }, Math.max(1, Math.floor(leaseMs / 3)));
    timer.unref();
  };
  schedule();
  return { signal: controller.signal, assertActive() { if (failure) throw failure; },
    async stop() { stopped = true; clearTimeout(timer); await pending; } };
}
