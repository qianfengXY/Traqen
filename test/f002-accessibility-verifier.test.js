import assert from "node:assert/strict";
import test from "node:test";
import { verifyProtocolComposition } from "./support/f002-accessibility-checks.mjs";

const candidate = [
  { type: "compositionstart", trusted: true, composing: null },
  { type: "compositionupdate", trusted: true, composing: null },
  { type: "input", trusted: true, composing: true },
];
const end = { type: "compositionend", trusted: false, composing: null };

test("the browser protocol verifier records scoped commit trust without claiming OS IME acceptance", () => {
  assert.deepEqual(verifyProtocolComposition([...candidate, end], "预览"), { protocolCommitTrust: false, osIme: "NOT_RUN" });
  assert.deepEqual(verifyProtocolComposition([...candidate, { ...end, trusted: true }], "预览"), { protocolCommitTrust: true, osIme: "NOT_RUN" });
});

test("an untrusted start update or composing input cannot pass as protocol renderer input", () => {
  for (let index = 0; index < candidate.length; index += 1) {
    const events = candidate.map((event, position) => position === index ? { ...event, trusted: false } : event);
    assert.throws(() => verifyProtocolComposition([...events, end], "预览"), /trusted renderer/);
  }
});

test("a missing duplicate incomplete or text-losing composition cannot pass the verifier", () => {
  assert.throws(() => verifyProtocolComposition(candidate, "预览"), /complete composition/);
  assert.throws(() => verifyProtocolComposition([...candidate, end, end], "预览"), /complete composition/);
  assert.throws(() => verifyProtocolComposition([...candidate, end, candidate[1]], "预览"), /compositionend/);
  assert.throws(() => verifyProtocolComposition([...candidate, end], "预"), /Chinese text/);
});
