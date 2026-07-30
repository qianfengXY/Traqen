import { chmod, copyFile, mkdir, realpath, writeFile } from "node:fs/promises";
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
    const inventory = await this.scanner.scan({ projectId, snapshotManifestId, rootPath, sourceDigest });
    const root = await realpath(rootPath);
    const target = path.join(this.snapshotRoot, snapshotManifestId);
    await mkdir(target, { recursive: false });
    const createdDirectories = new Set([target]);
    for (const artifact of inventory.artifacts) {
      if (artifact.disposition !== "INCLUDED") continue;
      const source = path.join(root, ...artifact.path.split("/"));
      const destination = path.join(target, ...artifact.path.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      let directory = path.dirname(destination);
      while (directory === target || directory.startsWith(`${target}${path.sep}`)) {
        createdDirectories.add(directory);
        if (directory === target) break;
        directory = path.dirname(directory);
      }
      await copyFile(source, destination);
      await chmod(destination, 0o440);
    }
    await writeFile(path.join(target, ".traqen-inventory.json"), JSON.stringify(inventory), {
      encoding: "utf8",
      mode: 0o440,
      flag: "wx",
    });
    for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
      await chmod(directory, 0o550);
    }
    return inventory;
  }
}
