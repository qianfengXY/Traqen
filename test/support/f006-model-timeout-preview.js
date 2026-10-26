// Owned native fixture for this model-metadata UI test only. No real CLI runs.
import { writeFile } from "node:fs/promises";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { knowledgeServerFixture } from "./f002-f003-server-fixture.js";

const [webOrigin, receiptFile] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(webOrigin ?? "") || !receiptFile?.startsWith("/tmp/")) throw Error("Explicit owned origin and receipt required");
const cleanups = [], t = { after: callback => cleanups.push(callback) };
let finish;
const stopped = new Promise(resolve => { finish = resolve; });
process.once("SIGTERM", () => finish()); process.once("SIGINT", () => finish());
const timer = setTimeout(() => finish(), 30 * 60 * 1000);
let receipt, finalModelCalls;
try {
  const pg = await isolatedPostgres(t);
  const f = await knowledgeServerFixture(t, { database: () => pg.createDatabase(), webOrigin });
  receipt = { scope: "ISOLATED_F008_NATIVE_METADATA_ONLY", apiOrigin: f.runtime.origin, webOrigin, clusterRoot: pg.root,
    databaseName: f.runtime.db.name ?? null, modelCalls: f.model.calls.length, pid: process.pid };
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  await stopped;
  finalModelCalls = f.model.calls.length;
} finally {
  clearTimeout(timer);
  for (const cleanup of cleanups.reverse()) await cleanup();
  if (receipt) await writeFile(receiptFile, JSON.stringify({ ...receipt, closed: true, finalModelCalls }, null, 2));
}
