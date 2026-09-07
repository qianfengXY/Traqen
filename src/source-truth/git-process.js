import { spawn } from "node:child_process";
import { SourceTruthError, requireValue } from "./errors.js";

export class GitProcess {
  constructor({ executable = "/usr/bin/git", timeoutMs = 60000, maxPackBytes = 256 * 1024 * 1024, maxProcesses = 2 } = {}) {
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.maxPackBytes = maxPackBytes;
    this.maxProcesses = maxProcesses;
    this.active = 0;
    this.peakProcesses = 0;
  }

  async *stream(args, { cwd, config = [], maxBytes = 1024 * 1024, signal, input = null } = {}) {
    requireValue(this.active < this.maxProcesses, "SOURCE_GIT_BUSY", "Git 采集并发已满，请稍后重试", { status: 429 });
    this.active++;
    this.peakProcesses = Math.max(this.peakProcesses, this.active);
    const pairs = [["credential.helper", ""], ["core.hooksPath", "/dev/null"], ["protocol.allow", "never"],
      ["protocol.https.allow", "always"], ["http.followRedirects", "false"], ["http.proxy", ""],
      ["http.sslVerify", "true"], ["http.lowSpeedLimit", "1"], ["http.lowSpeedTime", "15"],
      ["protocol.version", "2"], ["fetch.fsckObjects", "true"], ["transfer.fsckObjects", "true"],
      ["gc.auto", "0"], ["maintenance.auto", "false"], ["pack.threads", "1"],
      ["pack.windowMemory", "16m"], ["pack.deltaCacheSize", "16m"], ["core.packedGitLimit", "32m"],
      ["fetch.unpackLimit", "1"], ["fetch.writeCommitGraph", "false"], ...config];
    const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: String(pairs.length) };
    pairs.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
    // Fixed trusted wrapper: no source-controlled command is evaluated. POSIX
    // file-size limit is a per-file guard; aggregate quota is separately owned
    // by deployment/capture reservations, not inferred from this limit.
    const child = spawn("/bin/sh", ["-c", 'umask 077; ulimit -f "$1" || exit 125; shift; exec "$@"', "source-truth-git",
      String(Math.max(1, Math.floor(this.maxPackBytes / 1024))), this.executable, ...args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let failure = null;
    const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* process already closed */ } };
    const done = new Promise((resolve) => {
      child.on("error", (error) => { failure = error; resolve({ code: null }); });
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    // Discard untrusted stderr: Git errors can contain remote-controlled text,
    // credentials or paths. Public errors use stable platform codes below.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    const timer = setTimeout(stop, this.timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    let size = 0;
    try {
      for await (const chunk of child.stdout) {
        size += chunk.length;
        requireValue(size <= maxBytes, "SOURCE_GIT_RESOURCE_LIMIT", "Git 输出超过资源上限，不能截断后继续");
        yield chunk;
      }
      const result = await done;
      if (failure || result.code !== 0) throw new SourceTruthError("SOURCE_GIT_TRANSFER_FAILED", "Git 对象读取或传输失败；检查授权、来源和资源后重试", { status: 503 });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      stop();
      await done;
      this.active--;
    }
  }

  async run(args, options = {}) {
    const chunks = [];
    for await (const chunk of this.stream(args, options)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
}
