import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import https from "node:https";

const exec = promisify(execFile);
export async function gitFixture(t, { maxOutputBytes = 1024 * 1024, transformResponse = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "traqen-source-git-test-"));
  const work = path.join(root, "author");
  await mkdir(work);
  // Fixture commits need their exit status, never the O(file-count) summary.
  // Keep the output bound rather than increasing it for a large source tree.
  const git = async (...args) => (await exec("/usr/bin/git", args[0] === "commit" ? ["commit", "--quiet", ...args.slice(1)] : args, { cwd: work, maxBuffer: maxOutputBytes, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } })).stdout.trim();
  await git("init", "-b", "main");
  await writeFile(path.join(work, "README.md"), "fixture version A\n");
  await mkdir(path.join(work, "src"));
  await writeFile(path.join(work, "src", "orders.js"), "throw new Error('SOURCE_MUST_NEVER_EXECUTE');\n");
  await git("add", ".");
  await git("commit", "-m", "A");
  const commitA = await git("rev-parse", "HEAD");
  await git("clone", "--bare", work, path.join(root, "repo.git"));
  await exec("/opt/homebrew/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(root, "key.pem"), "-out", path.join(root, "ca.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { maxBuffer: 100000 });
  const server = https.createServer({ key: await readFile(path.join(root, "key.pem")), cert: await readFile(path.join(root, "ca.pem")) }, (request, response) => {
    const url = new URL(request.url, "https://localhost");
    if (url.pathname.startsWith("/redirect")) { response.writeHead(302, { location: "https://127.0.0.1:1/secret" }); response.end(); return; }
    const process = spawn("/usr/bin/git", ["http-backend"], { env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers["content-type"] ?? "", HTTP_GIT_PROTOCOL: request.headers["git-protocol"] ?? "", REMOTE_ADDR: "127.0.0.1" }, stdio: ["pipe", "pipe", "ignore"] });
    request.pipe(process.stdin);
    process.stdin.on("error", () => {});
    let prefix = Buffer.alloc(0);
    const headers = (chunk) => {
      prefix = Buffer.concat([prefix, chunk]);
      const boundary = prefix.indexOf("\r\n\r\n");
      if (boundary < 0) { if (prefix.length > 16384) { process.kill(); response.destroy(); } return; }
      process.stdout.off("data", headers);
      const values = {};
      let status = 200;
      for (const line of prefix.subarray(0, boundary).toString().split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const name = line.slice(0, colon).toLowerCase();
        if (name === "status") status = Number(line.slice(colon + 1).trim().split(" ")[0]);
        else values[name] = line.slice(colon + 1).trim();
      }
      response.writeHead(status, values);
      // Test-only response backpressure lets real native fetches be interrupted
      // mid-pack; it does not manufacture client-side Git lock files.
      const body = transformResponse?.(request) ?? response;
      if (body !== response) {
        body.pipe(response);
        body.on("error", () => response.destroy());
        response.on("close", () => body.destroy());
      }
      body.write(prefix.subarray(boundary + 4));
      process.stdout.pipe(body);
    };
    process.stdout.on("data", headers);
    response.on("close", () => process.kill());
    process.on("error", () => response.destroy());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `https://127.0.0.1:${server.address().port}`;
  return { root, work, git, commitA, origin, url: `${origin}/repo.git`, targets: [{ origin, allowedAddresses: ["127.0.0.1"], caFile: path.join(root, "ca.pem") }],
    async update() {
      await writeFile(path.join(work, "README.md"), "fixture version B\n");
      await git("add", "."); await git("commit", "-m", "B");
      await git("push", path.join(root, "repo.git"), "main");
      return git("rev-parse", "HEAD");
    } };
}
