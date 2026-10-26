import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authenticatedDevelopmentApplication } from "../auth/development.js";
import { createTraceabilityHttpServer } from "./http-server.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = process.env.TRAQEN_DEVELOPMENT_SOURCE_ROOT ?? repositoryRoot;
if (!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('The development instance must bind a loopback host');
const runtime = await authenticatedDevelopmentApplication({...process.env,TRAQEN_AUTH_DEVELOPMENT:'true'});
const { application, corsAllowedOrigins } = runtime;
const server = createTraceabilityHttpServer({ application, corsAllowedOrigins, auth: runtime.identity.http,
 ...runtime.knowledgeRuntime?.httpOptions,
 onInternalError:(error,requestId)=>process.stderr.write(JSON.stringify({requestId,type:error.constructor.name,code:error.code,constraint:error.constraint,frames:error.stack?.split('\n').slice(1,5)})+'\n') });

try {
  await runtime.start();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  process.stdout.write(`Traqen development API listening on http://${host}:${address.port}\n`);
  process.stdout.write(`Isolated reference analysis source allowlist: ${sourceRoot}\n`);
  process.stdout.write("This isolated development instance uses local data only; it is not production evidence.\n");
} catch (error) { await runtime.close(); throw error; }

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  try { await runtime.close(); } finally { await closed; }
  process.stdout.write(`Traqen development API stopped after ${signal}\n`);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  void shutdown(signal).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
});
