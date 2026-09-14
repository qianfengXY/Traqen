// Read-only observers have their own concurrency fence; commands must never
// pause progress observation. Callers retain their response/selection fences.
export function observeSourceReads(read: () => Promise<void>, options: {
  signal?: AbortSignal; onError: (error: Error) => void; intervalMs?: number;
}) {
  let active = true, reading = false;
  const observe = async () => {
    if (!active || reading || options.signal?.aborted) return;
    reading = true;
    try { await read(); }
    catch (error) { if (active && !options.signal?.aborted) options.onError(error as Error); }
    finally { reading = false; }
  };
  const timer = setInterval(() => void observe(), options.intervalMs ?? 2500);
  const stop = () => { active = false; clearInterval(timer); options.signal?.removeEventListener("abort", stop); };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop(); else void observe();
  return stop;
}
