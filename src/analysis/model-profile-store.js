import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const formatVersion = 1;

export function defaultAnalysisModelProfileStorePath() {
  return join(homedir(), ".traqen", "analysis-model-profiles.enc.json");
}

function preferNewestProfile(existing, incoming) {
  if (!existing) return incoming;
  if ((incoming.revision ?? 0) > (existing.revision ?? 0)) return incoming;
  if ((incoming.revision ?? 0) < (existing.revision ?? 0)) return existing;
  return incoming.currentRevisionId === existing.currentRevisionId ? incoming : existing;
}

function mergeBy(values, keyOf, chooser = (_existing, incoming) => incoming) {
  const merged = new Map();
  for (const value of values.flat()) {
    const key = keyOf(value);
    merged.set(key, chooser(merged.get(key), value));
  }
  return [...merged.values()];
}

export class EncryptedAnalysisModelProfileStore {
  constructor({ filePath = defaultAnalysisModelProfileStorePath(), keyPath = `${filePath}.key` } = {}) {
    if (typeof filePath !== "string" || filePath.trim() === "") throw new TypeError("analysis model profile store path is required");
    if (typeof keyPath !== "string" || keyPath.trim() === "") throw new TypeError("analysis model profile key path is required");
    this.filePath = filePath;
    this.keyPath = keyPath;
  }

  #key({ create }) {
    if (existsSync(this.keyPath)) {
      const key = readFileSync(this.keyPath);
      if (key.length !== 32) throw new Error("Traqen model profile encryption key must contain exactly 32 bytes");
      return key;
    }
    if (!create) throw new Error("Traqen model profile encryption key is missing");
    mkdirSync(dirname(this.keyPath), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    writeFileSync(this.keyPath, key, { mode: 0o600, flag: "wx" });
    chmodSync(this.keyPath, 0o600);
    return key;
  }

  load() {
    if (!existsSync(this.filePath)) return { profiles: [], revisions: [], credentialHandles: [], environmentCredentialHandles: [] };
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope?.version !== formatVersion || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
      throw new Error("Traqen model profile store has an unsupported encrypted format");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key({ create: false }), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!Array.isArray(value?.profiles)) throw new Error("Traqen model profile store does not contain profiles[]");
    return {
      profiles: value.profiles,
      revisions: Array.isArray(value.revisions) ? value.revisions : [],
      credentialHandles: Array.isArray(value.credentialHandles) ? value.credentialHandles : [],
      environmentCredentialHandles: Array.isArray(value.environmentCredentialHandles) ? value.environmentCredentialHandles : [],
    };
  }

  #withWriteLock(operation) {
    const lockPath = `${this.filePath}.lock`;
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        try {
          return operation();
        } finally {
          rmdirSync(lockPath);
        }
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        Atomics.wait(waiter, 0, 0, 10);
      }
    }
    const error = new Error("Timed out waiting for the analysis model credential store lock");
    error.code = "ANALYSIS_MODEL_PROFILE_STORE_BUSY";
    throw error;
  }

  #write(value) {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const key = this.#key({ create: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const envelope = JSON.stringify({ version: formatVersion, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, envelope, { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, this.filePath);
    chmodSync(this.filePath, 0o600);
  }

  save(value) {
    if (!value || !Array.isArray(value.profiles)) throw new TypeError("analysis model profile store value requires profiles[]");
    return this.#withWriteLock(() => {
      const existing = this.load();
      this.#write({
        profiles: mergeBy([existing.profiles, value.profiles], ({ id }) => id, preferNewestProfile),
        revisions: mergeBy([existing.revisions, value.revisions ?? []], ({ currentRevisionId }) => currentRevisionId),
        credentialHandles: mergeBy([existing.credentialHandles, value.credentialHandles ?? []], ({ id }) => id),
        environmentCredentialHandles: mergeBy([existing.environmentCredentialHandles, value.environmentCredentialHandles ?? []], ({ profileId }) => profileId),
      });
    });
  }

  saveCredentialHandles(value) {
    if (!value || !Array.isArray(value.credentialHandles)) throw new TypeError("analysis model credential store value requires credentialHandles[]");
    return this.#withWriteLock(() => {
      const existing = this.load();
      this.#write({
        ...existing,
        credentialHandles: mergeBy([existing.credentialHandles, value.credentialHandles], ({ id }) => id),
        environmentCredentialHandles: mergeBy([existing.environmentCredentialHandles, value.environmentCredentialHandles ?? []], ({ profileId }) => profileId),
      });
    });
  }
}
