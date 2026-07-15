import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function localDevelopmentConfig(env = {}) {
  const apiPort = 3100;
  const webPort = 3000;
  const allowedOrigins = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    ...(env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ]);

  return {
    apiHost: "127.0.0.1",
    apiPort,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    webHost: "127.0.0.1",
    webPort,
    webUrl: `http://127.0.0.1:${webPort}`,
    corsAllowedOrigins: [...allowedOrigins].join(","),
  };
}

export function missingDevelopmentDependencies(root = repositoryRoot) {
  const required = [
    path.join(root, "node_modules/pg/package.json"),
    path.join(root, "web/node_modules/vinext/package.json"),
  ];
  return required.filter((file) => !existsSync(file));
}

export function supportsFullStackNode(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

export function webDevelopmentCommand({
  root = repositoryRoot,
  execPath = process.execPath,
  config = localDevelopmentConfig(),
} = {}) {
  return {
    command: execPath,
    args: [
      path.join(root, "web/node_modules/vinext/dist/cli.js"),
      "dev",
      "--host", config.webHost,
      "--port", String(config.webPort),
    ],
    cwd: path.join(root, "web"),
  };
}

export async function startDevelopment({ env = process.env, root = repositoryRoot } = {}) {
  if (!supportsFullStackNode()) {
    throw new Error(`Full-stack development requires Node.js 22.13 or newer; current version is ${process.versions.node}.`);
  }
  const missing = missingDevelopmentDependencies(root);
  if (missing.length > 0) {
    throw new Error("Development dependencies are missing. Run `npm run setup` once, then retry `npm run dev`.");
  }

  const config = localDevelopmentConfig(env);
  const web = webDevelopmentCommand({ root, config });
  const children = [
    spawn(process.execPath, ["src/api/dev-server.js"], {
      cwd: root,
      env: {
        ...env,
        HOST: config.apiHost,
        PORT: String(config.apiPort),
        CORS_ALLOWED_ORIGINS: config.corsAllowedOrigins,
      },
      stdio: "inherit",
    }),
    spawn(web.command, web.args, {
      cwd: web.cwd,
      env: {
        ...env,
        WRANGLER_LOG_PATH: env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
      },
      stdio: "inherit",
    }),
  ];

  process.stdout.write([
    "Traqen local development is starting:",
    `  Web: ${config.webUrl}`,
    `  API: ${config.apiUrl}`,
    "Press Ctrl+C to stop both processes.",
    "",
  ].join("\n"));

  let stopping = false;
  let requestedExitCode = 0;
  let forceTimer;

  const stop = (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    requestedExitCode = exitCode;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    forceTimer = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, 5_000);
    forceTimer.unref();
  };

  const onSigint = () => stop(0);
  const onSigterm = () => stop(0);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await new Promise((resolve) => {
      let exited = 0;
      for (const child of children) {
        child.once("error", (error) => {
          process.stderr.write(`Failed to start a development process: ${error.message}\n`);
          stop(1);
        });
        child.once("exit", (code, signal) => {
          exited += 1;
          if (!stopping) {
            const reason = signal ? `signal ${signal}` : `exit code ${code}`;
            process.stderr.write(`A development process stopped unexpectedly (${reason}).\n`);
            stop(code === 0 ? 1 : (code ?? 1));
          }
          if (exited === children.length) resolve();
        });
      }
    });
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  if (requestedExitCode !== 0) process.exitCode = requestedExitCode;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startDevelopment().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
