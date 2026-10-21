"use client";

import { useEffect, useRef, useState } from "react";
import { emptyEvidenceView, rememberEvidenceView, restoreEvidenceView, type EvidenceView, type ViewIdentity } from "./view-state.ts";
import { emptyGraphViewport } from "./traversal.ts";

export function useEvidenceView(context: ViewIdentity) {
  const [snapshot, setSnapshot] = useState(() => {
    try { return { metadata: restoreEvidenceView(window.localStorage, context), recordId: context.recordId, recordKind: context.recordKind, error: "" }; }
    catch { return { metadata: emptyEvidenceView(), recordId: context.recordId, recordKind: context.recordKind, error: "阅读偏好未能恢复；没有读取旧身份的数据或替换固定引用。" }; }
  });
  const sameRecord = snapshot.recordId === context.recordId && snapshot.recordKind === context.recordKind;
  const sameRoot = context.graphRootId === undefined || snapshot.metadata.graphRootId === context.graphRootId;
  const metadata = { ...snapshot.metadata, readingLine: sameRecord ? snapshot.metadata.readingLine : 1, readingLineEnd: sameRecord ? snapshot.metadata.readingLineEnd : 1,
    readingWindowLine: sameRecord ? snapshot.metadata.readingWindowLine : 1, inspectorScrollTop: sameRecord ? snapshot.metadata.inspectorScrollTop : 0,
    graphRootId: context.graphRootId ?? snapshot.metadata.graphRootId, graphViewport: sameRoot ? snapshot.metadata.graphViewport : emptyGraphViewport() };
  const update = (patch: Partial<EvidenceView>, recordId = context.recordId, recordKind = context.recordKind) => {
    const next = { ...metadata, ...patch };
    let error = "";
    try { rememberEvidenceView(window.localStorage, { ...context, recordId, recordKind }, next); }
    catch { error = "阅读偏好尚未保存；本页仍可阅读，但刷新不能保证恢复当前位置。"; }
    setSnapshot({ metadata: next, recordId, recordKind, error });
  };
  return { ...metadata, error: snapshot.error, update };
}

export function useInspectorControls(view: ReturnType<typeof useEvidenceView>) {
  const reopenRef = useRef<HTMLButtonElement>(null), previouslyOpen = useRef(view.inspectorOpen);
  const [autoFocus, setAutoFocus] = useState(false);
  useEffect(() => {
    if (previouslyOpen.current && !view.inspectorOpen) reopenRef.current?.focus();
    previouslyOpen.current = view.inspectorOpen;
  }, [view.inspectorOpen]);
  const close = (scrollTop: number) => {
    setAutoFocus(false); view.update({ inspectorOpen: false, inspectorScrollTop: scrollTop });
  };
  const open = () => { setAutoFocus(true); view.update({ inspectorOpen: true }); };
  return { reopenRef, autoFocus, close, open };
}
