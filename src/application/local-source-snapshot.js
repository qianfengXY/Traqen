import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson, createArtifactInventory } from "../domain/index.js";
import { ArtifactInventoryScanner } from "../scanner/index.js";

function isContainedPath(parent, candidate) {
  return candidate !== parent && candidate.startsWith(`${parent}${path.sep}`);
}

function emitVerificationEvent(observer, event) {
  if (typeof observer !== "function") return;
  try {
    observer(Object.freeze(event));
  } catch {
    // Observability must never change Snapshot integrity decisions.
  }
}

function statSignature(metadata) {
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.nlink,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].join(":");
}

async function mapWithWorkers(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  let failure = null;
  const next = async () => {
    while (!failure) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(limit, Math.max(1, values.length)) },
    next,
  ));
  if (failure) throw failure;
  return results;
}

function requireSnapshotManifestId(value) {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === ".."
    || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new TypeError("snapshotManifestId must be a single safe path segment");
  }
  return value;
}

function snapshotDirectoryFor(snapshotRoot, snapshotManifestId) {
  return path.join(path.resolve(snapshotRoot), requireSnapshotManifestId(snapshotManifestId));
}

async function readSnapshotMetadataFile(absolute, encoding = null) {
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError("Snapshot metadata must be a non-symlink file");
  }
  return readFile(absolute, encoding ?? undefined);
}

function verifySealedInventoryIntegrity(inventory) {
  try {
    if (inventory?.sealed !== true) throw new TypeError("Sealed Snapshot inventory must be sealed");
    const createdAt = new Date(inventory.createdAt);
    const normalized = createArtifactInventory(inventory, () => createdAt);
    if (canonicalJson(normalized) !== canonicalJson(inventory)) {
      throw new TypeError("Sealed Snapshot inventory does not match its content-derived identity");
    }
    return normalized;
  } catch (error) {
    throw new TypeError("Sealed Snapshot inventory integrity verification failed", { cause: error });
  }
}

async function createVerificationContext({ snapshotRoot, snapshotManifestId, inventoryId }) {
  const root = path.resolve(snapshotRoot);
  const snapshotDirectory = snapshotDirectoryFor(root, snapshotManifestId);
  if (!isContainedPath(root, snapshotDirectory)) {
    throw new TypeError("Snapshot directory escaped the configured Snapshot root");
  }
  const directoryMetadata = await lstat(snapshotDirectory, { bigint: true });
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new TypeError("Snapshot package must be a non-symlink directory");
  }
  const [realRoot, realSnapshotDirectory, seal] = await Promise.all([
    realpath(root),
    realpath(snapshotDirectory),
    readSnapshotMetadataFile(path.join(snapshotDirectory, ".traqen-sealed"), "utf8"),
  ]);
  if (!isContainedPath(realRoot, realSnapshotDirectory)) {
    throw new TypeError("Snapshot package escaped the configured Snapshot root");
  }
  if (seal !== inventoryId) throw new TypeError("Sealed Snapshot inventory digest marker is invalid");
  return {
    snapshotDirectory,
    realSnapshotDirectory,
    snapshotDirectorySignature: statSignature(directoryMetadata),
  };
}

async function readVerifiedArtifactPayload(context, artifact) {
  const absolute = path.resolve(context.snapshotDirectory, ...artifact.relativePath.split("/"));
  if (!isContainedPath(context.snapshotDirectory, absolute)) {
    throw new TypeError("Artifact escaped the immutable Snapshot root");
  }
  const metadata = await lstat(absolute, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError("Artifact must be a non-symlink file");
  }
  const realArtifact = await realpath(absolute);
  if (!isContainedPath(context.realSnapshotDirectory, realArtifact)) {
    throw new TypeError("Artifact escaped the immutable Snapshot root");
  }
  const content = await readFile(realArtifact);
  const metadataAfterRead = await lstat(absolute, { bigint: true });
  if (statSignature(metadataAfterRead) !== statSignature(metadata)) {
    throw new TypeError("Snapshot Artifact changed during digest verification");
  }
  const contentDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (contentDigest !== artifact.contentDigest) {
    throw new TypeError("Snapshot Artifact digest verification failed");
  }
  return { content, signature: statSignature(metadataAfterRead) };
}

export async function readVerifiedLocalSnapshotArtifact({
  snapshotRoot, snapshotManifestId, inventoryId, artifact,
}) {
  const context = await createVerificationContext({ snapshotRoot, snapshotManifestId, inventoryId });
  const { content } = await readVerifiedArtifactPayload(context, artifact);
  return content;
}

function artifactDirectoryPaths(snapshotDirectory, includedArtifacts) {
  const directories = new Set();
  for (const artifact of includedArtifacts) {
    let relativeDirectory = path.posix.dirname(artifact.relativePath);
    while (relativeDirectory !== ".") {
      const absolute = path.resolve(snapshotDirectory, ...relativeDirectory.split("/"));
      if (!isContainedPath(snapshotDirectory, absolute)) {
        throw new TypeError("Artifact directory escaped the immutable Snapshot root");
      }
      directories.add(absolute);
      relativeDirectory = path.posix.dirname(relativeDirectory);
    }
  }
  return [...directories].sort();
}

async function readArtifactStatSignature(context, artifact) {
  const absolute = path.resolve(context.snapshotDirectory, ...artifact.relativePath.split("/"));
  if (!isContainedPath(context.snapshotDirectory, absolute)) {
    throw new TypeError("Artifact escaped the immutable Snapshot root");
  }
  const metadata = await lstat(absolute, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError("Artifact must be a non-symlink file");
  }
  return statSignature(metadata);
}

async function readDirectoryStatSignatures(context, includedArtifacts) {
  const directories = artifactDirectoryPaths(context.snapshotDirectory, includedArtifacts);
  return mapWithWorkers(directories, 16, async (absolute) => {
    const metadata = await lstat(absolute, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("Artifact directory must be a non-symlink directory");
    }
    return [path.relative(context.snapshotDirectory, absolute), statSignature(metadata)];
  });
}

function verificationStateDigest(context, directorySignatures, artifactSignatures, includedArtifacts) {
  const digest = createHash("sha256");
  digest.update(`snapshot\0${context.snapshotDirectorySignature}\0`);
  for (const [relativePath, signature] of directorySignatures) {
    digest.update(`directory\0${relativePath}\0${signature}\0`);
  }
  for (let index = 0; index < includedArtifacts.length; index += 1) {
    digest.update(`artifact\0${includedArtifacts[index].relativePath}\0${artifactSignatures[index]}\0`);
  }
  return `sha256:${digest.digest("hex")}`;
}

export async function verifyLocalSnapshotArtifactPayloads({
  snapshotRoot, snapshotManifestId, inventory, verificationObserver = null,
}) {
  const includedArtifacts = inventory.artifacts.filter(({ disposition }) => disposition === "INCLUDED");
  emitVerificationEvent(verificationObserver, {
    type: "FULL_PAYLOAD_VERIFICATION_STARTED",
    snapshotManifestId,
    inventoryId: inventory.id,
    artifactCount: includedArtifacts.length,
  });
  try {
    const context = await createVerificationContext({
      snapshotRoot,
      snapshotManifestId,
      inventoryId: inventory.id,
    });
    const directorySignatures = await readDirectoryStatSignatures(context, includedArtifacts);
    const artifactSignatures = await mapWithWorkers(includedArtifacts, 8, async (artifact) => {
      emitVerificationEvent(verificationObserver, {
        type: "ARTIFACT_PAYLOAD_READ_STARTED",
        snapshotManifestId,
        inventoryId: inventory.id,
        artifactId: artifact.id,
        relativePath: artifact.relativePath,
      });
      try {
        const { signature } = await readVerifiedArtifactPayload(context, artifact);
        return signature;
      } catch (error) {
        emitVerificationEvent(verificationObserver, {
          type: "ARTIFACT_PAYLOAD_READ_FAILED",
          snapshotManifestId,
          inventoryId: inventory.id,
          artifactId: artifact.id,
          relativePath: artifact.relativePath,
        });
        throw error;
      }
    });
    const receipt = Object.freeze({
      inventoryId: inventory.id,
      artifactCount: includedArtifacts.length,
      stateDigest: verificationStateDigest(
        context,
        directorySignatures,
        artifactSignatures,
        includedArtifacts,
      ),
    });
    emitVerificationEvent(verificationObserver, {
      type: "FULL_PAYLOAD_VERIFICATION_SUCCEEDED",
      snapshotManifestId,
      inventoryId: inventory.id,
      artifactCount: includedArtifacts.length,
    });
    return receipt;
  } catch (error) {
    emitVerificationEvent(verificationObserver, {
      type: "FULL_PAYLOAD_VERIFICATION_FAILED",
      snapshotManifestId,
      inventoryId: inventory.id,
      artifactCount: includedArtifacts.length,
    });
    throw error;
  }
}

async function validateLocalSnapshotVerificationReceipt({
  snapshotRoot, snapshotManifestId, inventory, receipt, verificationObserver = null,
}) {
  const includedArtifacts = inventory.artifacts.filter(({ disposition }) => disposition === "INCLUDED");
  emitVerificationEvent(verificationObserver, {
    type: "VERIFICATION_RECEIPT_VALIDATION_STARTED",
    snapshotManifestId,
    inventoryId: inventory.id,
    artifactCount: includedArtifacts.length,
  });
  try {
    if (receipt.inventoryId !== inventory.id || receipt.artifactCount !== includedArtifacts.length) return false;
    const context = await createVerificationContext({
      snapshotRoot,
      snapshotManifestId,
      inventoryId: inventory.id,
    });
    const [directorySignatures, artifactSignatures] = await Promise.all([
      readDirectoryStatSignatures(context, includedArtifacts),
      mapWithWorkers(includedArtifacts, 32, (artifact) => readArtifactStatSignature(context, artifact)),
    ]);
    const valid = verificationStateDigest(
      context,
      directorySignatures,
      artifactSignatures,
      includedArtifacts,
    ) === receipt.stateDigest;
    emitVerificationEvent(verificationObserver, {
      type: valid ? "VERIFICATION_RECEIPT_VALID" : "VERIFICATION_RECEIPT_INVALID",
      snapshotManifestId,
      inventoryId: inventory.id,
      artifactCount: includedArtifacts.length,
    });
    return valid;
  } catch {
    emitVerificationEvent(verificationObserver, {
      type: "VERIFICATION_RECEIPT_INVALID",
      snapshotManifestId,
      inventoryId: inventory.id,
      artifactCount: includedArtifacts.length,
    });
    return false;
  }
}

export class LocalSourceSnapshotCapture {
  #verificationReceipts = new Map();

  #verificationInFlight = new Map();

  constructor({
    allowlistedRoots,
    snapshotRoot,
    maxFileBytes = 1024 * 1024,
    clock = () => new Date(),
    verificationObserver = null,
    maxVerificationReceipts = 16,
  }) {
    this.snapshotRoot = path.resolve(snapshotRoot);
    if (this.snapshotRoot === path.parse(this.snapshotRoot).root || this.snapshotRoot === path.resolve(os.homedir())) {
      throw new TypeError("snapshotRoot cannot be the filesystem root or home directory");
    }
    if (verificationObserver !== null && typeof verificationObserver !== "function") {
      throw new TypeError("verificationObserver must be a function");
    }
    if (!Number.isSafeInteger(maxVerificationReceipts) || maxVerificationReceipts < 1) {
      throw new TypeError("maxVerificationReceipts must be a positive safe integer");
    }
    this.verificationObserver = verificationObserver;
    this.maxVerificationReceipts = maxVerificationReceipts;
    this.scanner = new ArtifactInventoryScanner({ allowlistedRoots, maxFileBytes, clock });
  }

  async capture({ projectId, snapshotManifestId, rootPath, sourceDigest }) {
    void sourceDigest;
    await mkdir(this.snapshotRoot, { recursive: true });
    const safeSnapshotManifestId = requireSnapshotManifestId(snapshotManifestId);
    const target = snapshotDirectoryFor(this.snapshotRoot, safeSnapshotManifestId);
    const existing = await this.#readSealedInventory(projectId, snapshotManifestId);
    if (existing) {
      await this.#ensureVerifiedPayloads(snapshotManifestId, existing);
      return existing;
    }
    const staging = path.join(this.snapshotRoot, `.staging-${safeSnapshotManifestId}-${randomUUID()}`);
    await mkdir(staging, { recursive: false });
    const createdDirectories = new Set([staging]);
    try {
      const { inventory, capturedFiles } = await this.scanner.capture({
        projectId, snapshotManifestId: safeSnapshotManifestId, rootPath,
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
    await this.#ensureVerifiedPayloads(snapshotManifestId, existing);
    return existing;
  }

  async #ensureVerifiedPayloads(snapshotManifestId, inventory) {
    const key = `${snapshotManifestId}\0${inventory.id}`;
    const inFlight = this.#verificationInFlight.get(key);
    if (inFlight) return inFlight;
    const verification = (async () => {
      const receipt = this.#verificationReceipts.get(key);
      if (receipt && await validateLocalSnapshotVerificationReceipt({
        snapshotRoot: this.snapshotRoot,
        snapshotManifestId,
        inventory,
        receipt,
        verificationObserver: this.verificationObserver,
      })) {
        this.#verificationReceipts.delete(key);
        this.#verificationReceipts.set(key, receipt);
        return;
      }
      this.#verificationReceipts.delete(key);
      const nextReceipt = await verifyLocalSnapshotArtifactPayloads({
        snapshotRoot: this.snapshotRoot,
        snapshotManifestId,
        inventory,
        verificationObserver: this.verificationObserver,
      });
      this.#verificationReceipts.set(key, nextReceipt);
      while (this.#verificationReceipts.size > this.maxVerificationReceipts) {
        this.#verificationReceipts.delete(this.#verificationReceipts.keys().next().value);
      }
    })();
    this.#verificationInFlight.set(key, verification);
    try {
      await verification;
    } finally {
      if (this.#verificationInFlight.get(key) === verification) {
        this.#verificationInFlight.delete(key);
      }
    }
  }

  async #readSealedInventory(projectId, snapshotManifestId) {
    const target = snapshotDirectoryFor(this.snapshotRoot, snapshotManifestId);
    const existing = await readSnapshotMetadataFile(path.join(target, ".traqen-inventory.json"), "utf8")
      .then((content) => verifySealedInventoryIntegrity(JSON.parse(content)))
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!existing) return null;
    if (existing.projectId !== projectId || existing.snapshotManifestId !== snapshotManifestId) {
      throw new TypeError("Sealed Snapshot inventory identity does not match the capture request");
    }
    const seal = await readSnapshotMetadataFile(path.join(target, ".traqen-sealed"), "utf8");
    if (seal !== existing.id) throw new TypeError("Sealed Snapshot inventory digest marker is invalid");
    return existing;
  }
}
