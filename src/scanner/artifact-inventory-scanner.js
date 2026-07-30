import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { createArtifactInventory } from "../domain/index.js";

const generatedDirectories = new Set(["node_modules", "dist", "build", "target", "out", ".next", "coverage", "vendor"]);
const secretNames = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|credentials(?:\..*)?)$/i;
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".jar", ".class", ".wasm"]);
const supportedExtensions = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".kt", ".go", ".py", ".rb", ".php", ".cs",
  ".json", ".sql", ".yaml", ".yml", ".xml", ".properties", ".gradle", ".kts", ".md", ".txt", ".html", ".css",
]);

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function artifactKind(relativePath) {
  if (/(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\./i.test(relativePath)) return "TEST";
  if (/(^|\/)(docs?|feature-specs|contracts)(\/|$)|\.(?:md|adoc|rst)$/i.test(relativePath)) return "DOCUMENT";
  if (/(^|\/)(results?|reports?)(\/|$)|\.(?:junit|tap)$/i.test(relativePath)) return "RESULT";
  if (/\.(?:json|ya?ml|xml|properties|toml|ini|gradle|kts)$/i.test(relativePath)) return "CONFIG";
  return "SOURCE";
}

function languageFor(extension) {
  return Object.freeze({
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".jsx": "javascript", ".java": "java", ".kt": "kotlin", ".go": "go", ".py": "python", ".rb": "ruby",
    ".php": "php", ".cs": "csharp", ".sql": "sql", ".md": "markdown", ".json": "json",
    ".yaml": "yaml", ".yml": "yaml", ".xml": "xml", ".html": "html", ".css": "css",
  })[extension] ?? null;
}

export class ArtifactInventoryScanner {
  constructor({ allowlistedRoots, maxFileBytes = 1024 * 1024, scannerVersion = "1.0.0", clock = () => new Date() }) {
    if (!Array.isArray(allowlistedRoots) || allowlistedRoots.length === 0) throw new TypeError("allowlistedRoots is required");
    this.allowlistedRoots = allowlistedRoots.map((root) => path.resolve(root));
    this.maxFileBytes = maxFileBytes;
    this.scannerVersion = scannerVersion;
    this.clock = clock;
  }

  async scan({ projectId, snapshotManifestId, sourceDigest, rootPath }) {
    const root = path.resolve(rootPath);
    const realRoot = await realpath(root);
    const realAllowedRoots = await Promise.all(this.allowlistedRoots.map((allowed) => realpath(allowed)));
    if (!realAllowedRoots.some((allowed) => realRoot === allowed || realRoot.startsWith(`${allowed}${path.sep}`))) {
      throw new TypeError("rootPath is outside the Local Runner allowlist");
    }
    const rootMetadata = await lstat(realRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new TypeError("rootPath must be a non-symlink directory");
    const artifacts = [];
    const visit = async (directory, inheritedGenerated = false) => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(realRoot, absolute).split(path.sep).join("/");
        if (entry.isSymbolicLink()) {
          artifacts.push({
            id: `ARTIFACT-${digest(relative).slice(7, 31)}`, path: relative, kind: "SOURCE", language: null,
            byteSize: 0, contentDigest: digest(""), disposition: "EXCLUDED", reason: "SYMLINK_FENCED",
          });
          continue;
        }
        const generated = inheritedGenerated || generatedDirectories.has(entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".git") {
            artifacts.push({
              id: `ARTIFACT-${digest(relative).slice(7, 31)}`, path: relative, kind: "CONFIG", language: null,
              byteSize: 0, contentDigest: digest(""), disposition: "EXCLUDED", reason: "VCS_INTERNAL",
            });
          } else if (generated) {
            artifacts.push({
              id: `ARTIFACT-${digest(relative).slice(7, 31)}`, path: relative, kind: "SOURCE", language: null,
              byteSize: 0, contentDigest: digest(""), disposition: "GENERATED", reason: "GENERATED_DIRECTORY_TREE",
            });
          } else {
            await visit(absolute, generated);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const metadata = await lstat(absolute);
        const extension = path.extname(entry.name).toLowerCase();
        let disposition = "INCLUDED";
        let reason;
        if (generated) [disposition, reason] = ["GENERATED", "GENERATED_DIRECTORY"];
        else if (secretNames.test(entry.name)) [disposition, reason] = ["SECRET_REDACTED", "SECRET_NAME_POLICY"];
        else if (binaryExtensions.has(extension)) [disposition, reason] = ["BINARY", "BINARY_EXTENSION"];
        else if (metadata.size > this.maxFileBytes) [disposition, reason] = ["OVERSIZED", "FILE_SIZE_LIMIT"];
        else if (!supportedExtensions.has(extension) && entry.name !== "Dockerfile" && entry.name !== "Makefile") {
          [disposition, reason] = ["UNSUPPORTED", "NO_DECLARED_EXTRACTOR"];
        }
        let content = Buffer.alloc(0);
        try {
          if (!["SECRET_REDACTED", "BINARY", "OVERSIZED", "GENERATED"].includes(disposition)) content = await readFile(absolute);
        } catch {
          disposition = "READ_FAILED";
          reason = "READ_ERROR";
        }
        artifacts.push({
          id: `ARTIFACT-${digest(relative).slice(7, 31)}`,
          path: relative,
          kind: artifactKind(relative),
          language: languageFor(extension),
          byteSize: metadata.size,
          contentDigest: digest(content),
          disposition,
          reason,
        });
      }
    };
    await visit(realRoot);
    return createArtifactInventory({
      projectId, snapshotManifestId, sourceDigest, scannerVersion: this.scannerVersion, sealed: true, artifacts,
    }, this.clock);
  }
}
