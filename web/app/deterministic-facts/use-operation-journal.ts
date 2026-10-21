"use client";

import { useEffect, useState } from "react";
import { OperationJournal, type InputDraft, type JournalContext, type OperationEnvelope, type PendingOperation } from "./operations.ts";

export function useOperationJournal(context: JournalContext) {
  const [restored] = useState(() => {
    try {
      if (typeof window === "undefined") return { journal: null, draft: {}, pending: null, error: null };
      const journal = new OperationJournal(window.localStorage, context);
      const state = journal.read();
      return { journal, ...state, error: null };
    } catch (error) {
      return { journal: null, draft: {}, pending: null, error: error instanceof Error ? error : new Error("本地恢复记录不可读，不能自动重建操作。") };
    }
  });
  const [draft, setDraft] = useState<InputDraft>(restored.draft);
  const [pending, setPending] = useState<PendingOperation | null>(restored.pending);
  const [error, setError] = useState<Error | null>(restored.error);
  const transact = <T,>(action: (journal: OperationJournal) => T): T => {
    try {
      if (!restored.journal) throw new Error("本地恢复记录不可用；未发送写操作。");
      const value = action(restored.journal);
      const state = restored.journal.read();
      setDraft(state.draft); setPending(state.pending); setError(null);
      return value;
    } catch (error) { setError(error instanceof Error ? error : new Error("本地操作记录未保存。")); throw error; }
  };
  useEffect(() => {
    // Persisted drafts are recoverable after a fresh authorization check, but
    // still warn before discarding the current interactive work or unknown op.
    if (!pending && !Object.values(draft).some(value => Array.isArray(value) ? value.length : Boolean(value))) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft, pending]);
  return { draft, pending, error, available: !!restored.journal && !error,
    saveDraft: (draft: InputDraft) => transact(journal => journal.saveDraft(draft)),
    begin: (operation: PendingOperation) => transact(journal => journal.begin(operation)),
    resolve: (response: OperationEnvelope) => transact(journal => journal.resolve(response)),
    reject: (operationId: string) => transact(journal => journal.reject(operationId)) };
}
