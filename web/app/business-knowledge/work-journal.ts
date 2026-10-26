import { bindingValid, workId } from "./work-types.ts";
import type {OperationKind,OperationLookup,WorkBinding} from './work-types.ts';
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OperationCoordinate = { operationId: string; resultId?: string; lookup?: OperationLookup };
function lookupValid(v:OperationLookup) {
  return v && ['CREATE_SESSION','QUESTION','FEEDBACK','CONTINUATION','ADOPT_GRAPH'].includes(v.kind)
    && (v.originSessionId===null||workId(v.originSessionId))
    && (v.originGraphRevisionId===null||workId(v.originGraphRevisionId))
    && typeof v.expectedRequestDigest==='string' && /^[a-f0-9]{64}$/.test(v.expectedRequestDigest)
    && !!v.expectedBinding && bindingValid(v.expectedBinding);
}
// Coordinates only: never permission, graph, raw material, model answer or a
// cached successful result. Every reopened coordinate is read from the server.
export class WorkJournal {
  private storage: Store;
  private key: string;
  constructor(storage: Store, workspace: string, actor: string, scope: string) {
    this.storage = storage;
    this.key = `traqen.work.${encodeURIComponent(actor)}.${encodeURIComponent(workspace)}.${encodeURIComponent(scope)}`;
  }
  read(): OperationCoordinate | null {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return null;
    const v = JSON.parse(raw);
    if (
      v?.schemaVersion !== 1 ||
      !workId(v.operationId) ||
      (v.resultId !== undefined && !workId(v.resultId)) ||
      (v.lookup !== undefined && !lookupValid(v.lookup))
    )
      throw Error("原次操作坐标不可读，未发送新操作。");
    return { operationId: v.operationId, ...(v.resultId ? { resultId: v.resultId } : {}), ...(v.lookup ? {lookup:v.lookup}: {}) };
  }
  begin(operationId = crypto.randomUUID(), lookup?:OperationLookup) {
    const old = this.read();
    if (old) throw Error("上次操作尚未核对；请先读取原次受理结果。");
    if (!workId(operationId) || (lookup!==undefined&&!lookupValid(lookup))) throw Error("操作坐标不合法，未发送。");
    const v = { schemaVersion: 1, operationId, ...(lookup?{lookup}: {}) };
    this.storage.setItem(this.key, JSON.stringify(v));
    if (this.read()?.operationId !== v.operationId) throw Error("操作坐标未保存，未发送。");
    return v.operationId;
  }
  accepted(operationId: string, resultId: string) {
    const old=this.read();
    if (old?.operationId !== operationId || !workId(resultId)) return;
    this.storage.setItem(this.key, JSON.stringify({ schemaVersion: 1, ...old, resultId }));
  }
  resolve(operationId: string) {
    if (this.read()?.operationId === operationId) this.storage.removeItem(this.key);
  }
}
// The HTTP contract hashes RFC8785 JSON. Keep browser encoding small and verify
// against server vectors; neither the original question nor authority is stored.
export function canonical(value:unknown):string {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string'){if(!value.isWellFormed())throw Error('请求包含无效字符');return JSON.stringify(value);}
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value)){if(Object.keys(value).length!==value.length)throw Error('无效数组');return `[${value.map(canonical).join(',')}]`;}
  if(value&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
    if(Object.getOwnPropertySymbols(value).length)throw Error('无效请求字段');
    return `{${Object.keys(value).sort().map(k=>`${canonical(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  }
  throw Error('请求不是可核对的JSON，未发送。');
}
export async function beginWorkOperation(journal:WorkJournal,kind:OperationKind,sessionId:string|null,binding:WorkBinding,input:{operationId:string}){
  const payload=kind==='CREATE_SESSION'?{revisionId:binding.graphRevisionId,input}:{sessionId,input};
  const bytes=new TextEncoder().encode(canonical(payload));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const expectedRequestDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  return journal.begin(input.operationId,{kind,originSessionId:sessionId,originGraphRevisionId:binding.graphRevisionId,expectedRequestDigest,expectedBinding:JSON.parse(JSON.stringify(binding))});
}
export function operationLookup(pending:OperationCoordinate,kind:OperationKind,sessionId:string|null,binding:WorkBinding):OperationLookup {
  if(pending.lookup&&(pending.lookup.kind!==kind||pending.lookup.originSessionId!==sessionId))throw Error('原操作类型或来源会话不符，保留坐标。');
  return {...(pending.lookup??{kind,originSessionId:sessionId,...(kind==='ADOPT_GRAPH'?{}:{originGraphRevisionId:binding.graphRevisionId,expectedBinding:binding})}),...(pending.resultId?{expectedResultId:pending.resultId}:{})};
}
export function journalSnapshot(store: { journal: WorkJournal | null; error: Error | null }) {
  try {
    return { ...store, pending: store.journal?.read() ?? null };
  } catch (cause) {
    return {
      journal: null,
      pending: null,
      error: cause instanceof Error ? cause : new Error("原操作坐标不可读，未发送新操作。"),
    };
  }
}
export function rememberSession(workspace: string, actor: string, id: string) {
  if (!workId(id)) return;
  const key = `traqen.work-visits.${encodeURIComponent(actor)}.${encodeURIComponent(workspace)}`;
  const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(raw)) throw Error("会话坐标清单不可读");
  window.localStorage.setItem(key, JSON.stringify([...new Set([id, ...raw.filter(workId)])]));
}
export function visitedSessions(workspace: string, actor: string): string[] {
  if (typeof window === "undefined") return [];
  const raw = JSON.parse(
    window.localStorage.getItem(
      `traqen.work-visits.${encodeURIComponent(actor)}.${encodeURIComponent(workspace)}`,
    ) ?? "[]",
  );
  if (!Array.isArray(raw) || !raw.every(workId)) throw Error("会话坐标清单不可读");
  return raw;
}
