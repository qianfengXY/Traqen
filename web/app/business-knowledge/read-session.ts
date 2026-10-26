import { BusinessKnowledgeClient, BusinessKnowledgeError } from "./client.ts";
import {SourceClientError} from "../source-truth/client.ts";
import {FactsClientError} from "../deterministic-facts/client.ts";

export const readStatus=(error:Error)=>error instanceof BusinessKnowledgeError||error instanceof SourceClientError||error instanceof FactsClientError?error.status:0;

type Snapshot = { client: BusinessKnowledgeClient | null; error: Error | null };
export class KnowledgeTransport {
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { client: null, error: null };
  private controller: AbortController | null = null;
  private base: string;
  private workspaceId: string;
  constructor(base: string, workspaceId: string) { this.base = base; this.workspaceId = workspaceId; }
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.snapshot.client && !this.snapshot.error) {
      this.controller = new AbortController();
      this.snapshot = { client: new BusinessKnowledgeClient(this.base, this.workspaceId, this.controller.signal), error: null };
      this.listeners.forEach(notify => notify());
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.controller?.abort(); this.controller = null; this.snapshot = { ...empty, error: this.snapshot.error }; }
    };
  };
  refuse = (error: Error) => {
    if (![401,403].includes(readStatus(error))) return;
    this.controller?.abort(); this.controller = null; this.snapshot = { client: null, error };
    this.listeners.forEach(notify => notify());
  };
}
const empty: Snapshot = { client: null, error: null };

// Only non-authoritative operation coordinates are persisted, never graph,
// source text, question, credentials, permissions or model answers.
export class StartReceipt {
  private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private key: string;
  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, workspaceId: string, actorId: string) {
    this.storage = storage; this.key = `traqen.business-start.${encodeURIComponent(actorId)}.${encodeURIComponent(workspaceId)}`;
  }
  read(): string | null {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value?.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)) throw Error("原提交坐标不可读，未发送新调查。");
    return value.operationId;
  }
  begin(operationId: string) {
    if (this.read()) throw Error("上次提交尚未核对，不能创建另一调查。");
    this.storage.setItem(this.key, JSON.stringify({ schemaVersion: 1, operationId }));
    if (this.read() !== operationId) throw Error("提交坐标未能持久保存，未发送调查。");
  }
  resolve(operationId: string) { if (this.read() === operationId) this.storage.removeItem(this.key); }
}
