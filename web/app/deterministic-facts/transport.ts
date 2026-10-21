import { DeterministicFactsClient } from "./client.ts";
import { SourceTruthClient } from "../source-truth/client.ts";

export type EvidenceClients = { facts: DeterministicFactsClient; sources: SourceTruthClient };

// An external transport lifecycle, not a React state reset. Subscribe after
// hydration; StrictMode resubscription gets fresh clients and fresh signals.
export class EvidenceTransport {
  private apiBase: string;
  private token: string;
  private workspaceId: string;
  private listeners = new Set<() => void>();
  private snapshot: EvidenceClients | null = null;
  private controller: AbortController | null = null;
  private blocked = false;
  constructor(apiBase: string, token: string, workspaceId: string) { this.apiBase = apiBase; this.token = token; this.workspaceId = workspaceId; }
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.snapshot && !this.blocked) {
      this.controller = new AbortController();
      this.snapshot = { facts: new DeterministicFactsClient(this.apiBase, this.token, this.workspaceId, this.controller.signal),
        sources: new SourceTruthClient(this.apiBase, this.token, this.workspaceId, this.controller.signal) };
      this.listeners.forEach(notify => notify());
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.controller?.abort(); this.controller = null; this.snapshot = null; }
    };
  };
  close() {
    this.blocked = true; this.controller?.abort(); this.controller = null; this.snapshot = null;
    this.listeners.forEach(notify => notify());
  }
}
