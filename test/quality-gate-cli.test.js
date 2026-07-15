import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const cli = new URL("../src/cli/evaluate-quality-gate.js", import.meta.url).pathname;

async function gateServer(t, enforcement) {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/v1/projects/PROJECT-001/change-sets/CHANGESET-001/continuous-protection");
    assert.equal(request.headers["x-traqen-api-token"], "ci-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ qualityGate: { enforcement } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function args(baseUrl) {
  return [cli, "--base-url", baseUrl, "--project", "PROJECT-001", "--change-set", "CHANGESET-001"];
}

test("quality-gate CLI keeps advisory warnings successful and reads its token from the environment", async (t) => {
  const baseUrl = await gateServer(t, "WARN");
  const result = await execFile(process.execPath, args(baseUrl), {
    env: { ...process.env, TRAQEN_API_TOKEN: "ci-token" },
  });
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).qualityGate.enforcement, "WARN");
});

test("quality-gate CLI fails CI when server policy returns enforced failure", async (t) => {
  const baseUrl = await gateServer(t, "FAIL");
  await assert.rejects(
    execFile(process.execPath, args(baseUrl), {
      env: { ...process.env, TRAQEN_API_TOKEN: "ci-token" },
    }),
    (error) => error.code === 1 && JSON.parse(error.stdout).qualityGate.enforcement === "FAIL",
  );
});
