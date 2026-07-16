import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const deployedFiles = ["artifact.js", "order-service.js", "router.js", "server.js"];

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function describeOrderPlatformArtifact() {
  const entries = [];
  for (const file of deployedFiles) {
    const content = await readFile(new URL(file, import.meta.url));
    entries.push({ file, digest: sha256(content) });
  }
  const digest = sha256(JSON.stringify(entries));
  return Object.freeze({
    id: `ORDER-PLATFORM-${digest.slice(-16)}`,
    digest,
    files: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}
