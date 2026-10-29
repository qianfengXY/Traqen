// Test-process-only hardware probe double. The API/config/auth/blob/database
// implementations remain real. This is never a production launch option or
// evidence that these temporary directories are physically protected media.
import { registerHooks } from "node:module";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots = JSON.parse(process.env.F002_TEST_OWNED_VOLUME_ROOTS ?? "[]").map(root => realpathSync(root));
const temporary = realpathSync(tmpdir());
if (roots.length !== 2 || !roots.every(root => path.dirname(root) === temporary)
  || !roots.some(root => path.basename(root).startsWith("tq-f002-native-entry-"))
  || !roots.some(root => path.basename(root).startsWith("tq-f001-pg-") || /^_p[A-Za-z0-9]{6}$/.test(path.basename(root)))) throw Error("Exact owned fixture roots required");
const target = new URL("../../src/source-truth/volume-protection.js", import.meta.url).href;
const workerTarget = new URL("../../src/deterministic-facts/worker.js", import.meta.url).href;
const barrier = process.env.F002_TEST_OWNED_WORKER_BARRIER;
if (barrier && (path.dirname(barrier) !== roots.find(root => path.basename(root).startsWith("tq-f002-native-entry-"))
  || path.basename(barrier) !== "worker-barrier")) throw Error("Exact owned worker barrier required");
registerHooks({
  load(url, context, next) {
    if (url === workerTarget && barrier) return { format: "module", shortCircuit: true, source: `
      import { F002Worker as ActualWorker } from ${JSON.stringify(`${workerTarget}?actual`)};
      import { writeFile, access } from 'node:fs/promises';
      import { setTimeout as delay } from 'node:timers/promises';
      export * from ${JSON.stringify(`${workerTarget}?actual`)};
      export class F002Worker extends ActualWorker {
        async run(...args) {
          await writeFile(${JSON.stringify(`${barrier}.entered`)}, JSON.stringify({ runId: args[2], scopeId: args[3] }), { mode: 0o600 });
          const deadline = Date.now() + 60000;
          while (true) {
            try { await access(${JSON.stringify(`${barrier}.released`)}); break; } catch {}
            if (Date.now() >= deadline) throw Error('Owned test worker barrier deadline');
            await delay(20);
          }
          return super.run(...args);
        }
      }
    ` };
    if (url !== target) return next(url, context);
    return { format: "module", shortCircuit: true, source: `
      import { realpath } from 'node:fs/promises';
      import path from 'node:path';
      import { verifyProtectedVolume as actual } from ${JSON.stringify(`${target}?actual`)};
      export * from ${JSON.stringify(`${target}?actual`)};
      const roots = ${JSON.stringify(roots)};
      export async function verifyProtectedVolume(root, options = {}) {
        if (options.probe) return actual(root, options);
        const resolved = await realpath(root);
        if (!roots.some(parent => resolved === parent || resolved.startsWith(parent + path.sep)))
          throw Error('Volume mechanism double cannot inspect a non-owned root');
        return actual(root, { probe: async () => ({ encrypted: true, permissionsEnforced: true,
          persistent: true, filesystemId: 'EXPLICIT_F002_MECHANISM_DOUBLE_NOT_MEDIA_EVIDENCE' }) });
      }
    ` };
  },
});
