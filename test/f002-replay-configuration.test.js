import assert from "node:assert/strict";
import test from "node:test";

import { F002ReplayService } from "../src/deterministic-facts/replay-service.js";
import { F002RuleRegistry, installedF002Rules } from "../src/deterministic-facts/rules.js";
import { workerParse } from "../src/deterministic-facts/worker.js";

const unexpectedIO = () => { throw new Error("replay configuration must not read or write data"); };
const repository = { withMaintainedWorkspace: unexpectedIO, withAuthorizedWorkspace: unexpectedIO };
const admission = { inventory: unexpectedIO, readFile: unexpectedIO };

test("F002 replay rejects a custom registry with the native compiler before any source or repository access", () => {
  const ruleRegistry = new F002RuleRegistry();
  for (const compiler of [{}, { compile: workerParse }]) {
    assert.throws(() => new F002ReplayService(repository, { admission, ruleRegistry, ...compiler }), {
      name: "TypeError",
      message: "F002 replay custom rule registry requires a custom compiler",
    });
  }
});

test("F002 replay retains the installed native compiler and explicit custom compiler configurations", () => {
  assert.doesNotThrow(() => new F002ReplayService(repository, { admission }));
  assert.doesNotThrow(() => new F002ReplayService(repository, { admission, ruleRegistry: installedF002Rules, compile: workerParse }));
  const ruleRegistry = new F002RuleRegistry();
  const compile = unexpectedIO;
  const replay = new F002ReplayService(repository, { admission, ruleRegistry, compile });
  assert.equal(replay.ruleRegistry, ruleRegistry);
  assert.equal(replay.compile, compile);
});
