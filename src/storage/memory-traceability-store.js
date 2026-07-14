import { canonicalJson, deepFreeze } from "../domain/index.js";
import { TraceabilityStore } from "./traceability-store.js";

function key(projectId, id) {
  return `${projectId}\u0000${id}`;
}

function manifestIdentity(manifest) {
  const { createdAt: _createdAt, ...identity } = manifest;
  return identity;
}

export class MemoryTraceabilityStore extends TraceabilityStore {
  #manifests = new Map();
  #chains = new Map();

  async appendSnapshotManifest(projectId, manifest) {
    const storageKey = key(projectId, manifest.id);
    const existing = this.#manifests.get(storageKey);
    if (existing && canonicalJson(manifestIdentity(existing)) !== canonicalJson(manifestIdentity(manifest))) {
      throw new Error(`Snapshot manifest ${manifest.id} conflicts with an existing immutable record`);
    }
    if (!existing) this.#manifests.set(storageKey, deepFreeze(structuredClone(manifest)));
    return manifest.id;
  }

  async appendTraceChainRevision(projectId, chain, options = {}) {
    if (!this.#manifests.has(key(projectId, chain.snapshotManifestId))) {
      throw new Error(`Snapshot manifest ${chain.snapshotManifestId} does not exist in project ${projectId}`);
    }
    const storageKey = key(projectId, chain.id);
    const revisions = this.#chains.get(storageKey) ?? [];
    const revision = revisions.length + 1;
    revisions.push(
      deepFreeze({
        ...structuredClone(chain),
        revision,
        scopeVersion: options.scopeVersion ?? 1,
      }),
    );
    this.#chains.set(storageKey, revisions);
    return Object.freeze({ chainId: chain.id, revision });
  }

  async getCurrentTraceChain(projectId, chainId) {
    const revisions = this.#chains.get(key(projectId, chainId));
    return revisions?.at(-1) ?? null;
  }
}
