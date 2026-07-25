import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const formatVersion = 1;

export function defaultAnalysisModelProfileStorePath() {
  return join(homedir(), ".traqen", "analysis-model-profiles.enc.json");
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
    if (!existsSync(this.filePath)) return { activeProfileId: null, profiles: [] };
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope?.version !== formatVersion || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
      throw new Error("Traqen model profile store has an unsupported encrypted format");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key({ create: false }), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!Array.isArray(value?.profiles)) throw new Error("Traqen model profile store does not contain profiles[]");
    return { activeProfileId: typeof value.activeProfileId === "string" ? value.activeProfileId : null, profiles: value.profiles };
  }

  save(value) {
    if (!value || !Array.isArray(value.profiles)) throw new TypeError("analysis model profile store value requires profiles[]");
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
}
