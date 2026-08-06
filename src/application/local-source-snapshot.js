import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ArtifactInventoryScanner } from "../scanner/index.js";

export class LocalSourceSnapshotCapture {
  constructor({ allowlistedRoots, snapshotRoot, maxFileBytes = 1024 * 1024, clock = () => new Date() }) {
    this.snapshotRoot = path.resolve(snapshotRoot);
    if (this.snapshotRoot === path.parse(this.snapshotRoot).root || this.snapshotRoot === path.resolve(os.homedir())) {
      throw new TypeError("snapshotRoot cannot be the filesystem root or home directory");
    }
    this.scanner = new ArtifactInventoryScanner({ allowlistedRoots, maxFileBytes, clock });
  }

  async capture({ projectId, snapshotManifestId, rootPath, sourceDigest }) {
    void sourceDigest;
    await mkdir(this.snapshotRoot, { recursive: true });
    const target = path.join(this.snapshotRoot, snapshotManifestId);
    const existing = await this.#readSealedInventory(projectId, snapshotManifestId);
    if (existing) {
      return existing;
    }
    const staging = path.join(this.snapshotRoot, `.staging-${snapshotManifestId}-${randomUUID()}`);
    await mkdir(staging, { recursive: false });
    const createdDirectories = new Set([staging]);
    try {
      const { inventory, capturedFiles } = await this.scanner.capture({
        projectId, snapshotManifestId, rootPath,
      });
      for (const { artifact, content } of capturedFiles) {
        const destination = path.join(staging, ...artifact.relativePath.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        let directory = path.dirname(destination);
        while (directory === staging || directory.startsWith(`${staging}${path.sep}`)) {
          createdDirectories.add(directory);
          if (directory === staging) break;
          directory = path.dirname(directory);
        }
        await writeFile(destination, content, { mode: 0o440, flag: "wx" });
        const persisted = await readFile(destination);
        const digest = `sha256:${createHash("sha256").update(persisted).digest("hex")}`;
        if (digest !== artifact.contentDigest) throw new TypeError(`Snapshot digest mismatch for ${artifact.relativePath}`);
        await chmod(destination, 0o440);
      }
      await writeFile(path.join(staging, ".traqen-inventory.json"), JSON.stringify(inventory), {
        encoding: "utf8",
        mode: 0o440,
        flag: "wx",
      });
      await writeFile(path.join(staging, ".traqen-sealed"), inventory.id, {
        encoding: "utf8",
        mode: 0o440,
        flag: "wx",
      });
      for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
        await chmod(directory, 0o550);
      }
      await rename(staging, target);
      return inventory;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async loadExisting({ projectId, snapshotManifestId }) {
    await mkdir(this.snapshotRoot, { recursive: true });
    const existing = await this.#readSealedInventory(projectId, snapshotManifestId);
    if (!existing) {
      throw new TypeError(`Sealed source Snapshot ${snapshotManifestId} is unavailable for historical reanalysis`);
    }
    return existing;
  }

  async #readSealedInventory(projectId, snapshotManifestId) {
    const target = path.join(this.snapshotRoot, snapshotManifestId);
    const existing = await readFile(path.join(target, ".traqen-inventory.json"), "utf8")
      .then((content) => JSON.parse(content))
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!existing) return null;
    if (existing.projectId !== projectId || existing.snapshotManifestId !== snapshotManifestId) {
      throw new TypeError("Sealed Snapshot inventory identity does not match the capture request");
    }
    const seal = await readFile(path.join(target, ".traqen-sealed"), "utf8");
    if (seal !== existing.id) throw new TypeError("Sealed Snapshot inventory digest marker is invalid");
    return existing;
  }
}
