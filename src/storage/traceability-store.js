export class TraceabilityStore {
  async appendSnapshotManifest(_projectId, _manifest) {
    throw new Error("appendSnapshotManifest must be implemented");
  }

  async appendTraceChainRevision(_projectId, _chain, _options = {}) {
    throw new Error("appendTraceChainRevision must be implemented");
  }

  async getCurrentTraceChain(_projectId, _chainId) {
    throw new Error("getCurrentTraceChain must be implemented");
  }
}
