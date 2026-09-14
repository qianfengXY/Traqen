import assert from "node:assert/strict";
import test from "node:test";
import { resolveGitTarget, validateGitRef } from "../src/source-truth/git-target.js";

const targets = [{ origin: "https://git.example.test" }];
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("B-05 Git target binds HTTPS origin to the actual resolved address", async () => {
  const result = await resolveGitTarget("https://git.example.test/team/repo.git", targets, lookup);
  assert.equal(result?.address, "93.184.216.34");
  assert.equal(result.origin, "https://git.example.test");
  assert.equal(result.curlResolve, "git.example.test:443:93.184.216.34");
  assert.equal(result.url, "https://git.example.test/team/repo.git");
});

test("B-05 unconfigured origins, credentials, paths and alternate protocols fail before lookup", async () => {
  let calls = 0;
  const probe = async () => { calls++; return lookup(); };
  for (const url of ["http://git.example.test/r", "ssh://git.example.test/r", "/local/repo", "file:///tmp/r", "https://user:secret@git.example.test/r", "https://attacker.test/r", "https://git.example.test/r?secret=x", "https://git.example.test/r#branch", "https://git.example.test:8443/r"]) {
    await assert.rejects(resolveGitTarget(url, targets, probe), { code: "SOURCE_GIT_TARGET_BLOCKED" });
  }
  assert.equal(calls, 0);
});

test("B-05 private, mapped, link-local and mixed DNS answers are blocked unless explicitly authorized", async () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "172.16.5.2", "192.168.4.3", "169.254.169.254", "0.0.0.0", "100.100.100.100", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    await assert.rejects(resolveGitTarget("https://git.example.test/r", targets, async () => [{ address, family: address.includes(":") ? 6 : 4 }]), { code: "SOURCE_GIT_TARGET_BLOCKED" });
  }
  await assert.rejects(resolveGitTarget("https://git.example.test/r", targets, async () => [
    { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 },
  ]), { code: "SOURCE_GIT_TARGET_BLOCKED" });
  const explicit = await resolveGitTarget("https://git.example.test/r", [{ origin: targets[0].origin, allowedAddresses: ["10.0.0.2"] }], async () => [{ address: "10.0.0.2", family: 4 }]);
  assert.equal(explicit.address, "10.0.0.2");
});

test("B-05 exact commit or unambiguous ref only; no revision expressions, options or wildcards", () => {
  for (const ref of ["HEAD", "main", "release/v1", "refs/tags/v1", "f".repeat(40), "a".repeat(64)]) assert.equal(validateGitRef(ref), ref);
  for (const ref of ["", "--upload-pack=evil", "main~1", "HEAD:file", "main\nnext", "../main", "refs/*", "@{-1}", "x.lock", "a..b"]) assert.throws(() => validateGitRef(ref), { code: "SOURCE_GIT_REF_INVALID" });
});
