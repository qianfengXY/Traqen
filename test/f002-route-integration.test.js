import assert from "node:assert/strict";
import test from "node:test";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";

test("technical evidence reaches its own handler without a legacy graph or analysis runtime", async t => {
  const visits = [];
  const server = createTraceabilityHttpServer({ application: {}, deterministicFactsHandler: async (request, response) => {
    visits.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ schemaVersion: 1, profiles: [], versions: [], activeRuns: [] }));
    return true;
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const route = "/v1/workspaces/workspace/deterministic-facts";
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
  assert.equal(response.status, 200);
  assert.deepEqual(visits, [route]);
  assert.equal((await response.json()).schemaVersion, 1);
});

test("unconfigured technical evidence reports an unavailable service instead of an unknown legacy route", async t => {
  const server = createTraceabilityHttpServer({ application: {} });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/deterministic-facts`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "F002_NOT_CONFIGURED");
});
