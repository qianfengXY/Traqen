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
