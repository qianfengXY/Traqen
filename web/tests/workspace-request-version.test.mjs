import assert from "node:assert/strict";
import test from "node:test";

import { staleWorkspaceRequestResponse } from "../app/workspace-client.ts";

test("a slower response cannot overwrite a newer selection inside the same Workspace", () => {
  const context = { workspaceId: "WORKSPACE-001", contextVersion: 7 };
  const olderRequestVersion = 11;
  const newerRequestVersion = 12;

  assert.equal(
    staleWorkspaceRequestResponse(context, context, olderRequestVersion, newerRequestVersion),
    true,
  );
  assert.equal(
    staleWorkspaceRequestResponse(context, context, newerRequestVersion, newerRequestVersion),
    false,
  );
});

test("controlled revision responses accept Revision 2 when Revision 1 completes last", async () => {
  const context = { workspaceId: "WORKSPACE-001", contextVersion: 7 };
  let currentRequestVersion = 0;
  const accepted = [];
  let resolveFirst;
  let resolveSecond;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const second = new Promise((resolve) => { resolveSecond = resolve; });
  const run = async (response) => {
    const requestVersion = ++currentRequestVersion;
    const result = await response;
    if (!staleWorkspaceRequestResponse(context, context, requestVersion, currentRequestVersion)) {
      accepted.push(result);
    }
  };
  const firstRun = run(first);
  const secondRun = run(second);
  resolveSecond("REVISION-2");
  await secondRun;
  resolveFirst("REVISION-1");
  await firstRun;
  assert.deepEqual(accepted, ["REVISION-2"]);
});
