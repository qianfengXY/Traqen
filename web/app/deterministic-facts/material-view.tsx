"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeterministicFactsClient } from "./client.ts";
import { useEvidenceResource } from "./use-resource.ts";
import type { FactRecord } from "./types.ts";
import { boundedTextRange, controlledTextWindow } from "./text-window.ts";
import { ControlledRaster } from "./controlled-raster.tsx";
import { isEvidenceShortcut } from "./keyboard.ts";

export function MaterialView({ client, versionId, material, line, lineEnd, windowLine, onLine, onRange, onWindowLine, onAccessLost }: {
  client: DeterministicFactsClient; versionId: string; material: FactRecord | null; line?: number; lineEnd?: number; windowLine?: number;
  onLine: (line: number) => void; onRange: (start: number, end: number, windowLine?: number) => void;
  onWindowLine: (line: number) => void; onAccessLost: (error: Error) => void;
}) {
  const [wrap, setWrap] = useState(true);
  const reader = useRef<HTMLDivElement>(null);
  const materialId = material?.id;
  const load = useCallback((bound: DeterministicFactsClient) => materialId ? bound.material(versionId, materialId) : Promise.resolve(null), [versionId, materialId]);
  const resource = useEvidenceResource(client, `${versionId}:${materialId ?? "none"}`, load, onAccessLost);
  const display = resource.data, error = resource.error;
  const page = useMemo(() => display && !display.mediaType.startsWith("image/") && display.mediaType !== "application/octet-stream"
    ? controlledTextWindow(display.bytes, windowLine ?? line ?? 1, 200, boundedTextRange(line ?? 1, lineEnd ?? line ?? 1)) : null, [display, line, lineEnd, windowLine]);
  useEffect(() => { reader.current?.querySelector(`[data-line="${windowLine ?? line ?? 1}"]`)?.scrollIntoView({ block: "nearest" }); }, [line, windowLine, display]);
  const extend = (to: number) => onRange(Math.min(line ?? 1, to), Math.max(line ?? 1, to));
  return <section className="f002-reading" aria-label="受控材料阅读区">
    <header><h2>{material?.payload.displayPath ?? "材料阅读"}</h2><div className="f002-actions"><button className="button" onClick={() => setWrap(value => !value)}>{wrap ? "关闭软换行" : "开启软换行"}</button></div></header>
    {!material ? <p className="f002-empty">从材料目录选择一项；没有提取出事实的材料也可在权限内读取。</p>
      : error ? <div role="alert"><p>材料读取未完成，不代表原材料不存在。</p><p>{error.message}</p><button className="button" onClick={resource.retry}>重试固定材料</button></div>
      : !display ? <p role="status">正在复验权限、读取冻结材料并校验展示摘要…</p>
      : <>
        {display.redacted && <p className="f002-notice" role="status">{display.transform === "CONFIG_SECRET_PRESENTATION_REFUSAL" ? "⚠ 此材料的敏感值无法安全定位，受控展示已拒绝。" : "⚠ 显示的是脱敏副本；原始冻结字节未改写。"} 展示位置不代表未经变换的源字节范围。</p>}
        <dl className="f002-digests"><dt>原始摘要</dt><dd>{display.originalDigest}</dd><dt>展示摘要</dt><dd>{display.displayDigest}</dd><dt>可读引用</dt><dd>{display.readableRef}</dd></dl>
        {display.mediaType.startsWith("image/") ? <ControlledRaster key={`${versionId}:${materialId}`} bytes={display.bytes} mediaType={display.mediaType} label={material.payload.displayPath ?? "获准的冻结材料原图"} />
          : display.mediaType === "application/octet-stream" ? <p>已校验受控字节。此二进制格式不能作为可执行文档展示；请查看元数据及明确限制。</p>
          : page && <>{!page.anchorPresent || !page.selectionPresent ? <p className="f002-notice" role="alert">固定的展示行范围 {line ?? 1}–{lineEnd ?? line ?? 1} 或页面定位在当前展示中不可用（共 {page.totalLines} 行）；没有改选另一范围。<button className="button" onClick={() => onRange(1, 1, 1)}>明确查看展示首行</button></p> : <>
            <div className="f002-actions" aria-label="受控材料分页"><button className="button" disabled={page.previousLine === null} onClick={() => page.previousLine !== null && onWindowLine(page.previousLine)}>上一页</button><span>展示行 {page.startLine}–{page.endLine} / {page.totalLines} · 每页最多 200 行</span><button className="button" disabled={page.nextLine === null} onClick={() => page.nextLine !== null && onWindowLine(page.nextLine)}>下一页</button></div>
            <p className="f002-caption" data-selected-range={`${line ?? 1}:${lineEnd ?? line ?? 1}`}>选中展示行 {line ?? 1}–{lineEnd ?? line ?? 1}。单击行号定位；Shift + 点击或 Shift + Enter／空格扩展范围。翻页不替换选中范围。</p>
            <button className="button" disabled={(line ?? 1) >= page.startLine && (line ?? 1) <= (page.endLine ?? 0)} onClick={() => onWindowLine(line ?? 1)}>返回选中范围起点</button>
            <div className={`f002-code ${wrap ? "wrap" : ""}`} ref={reader} tabIndex={0} aria-label="材料正文，带物理行定位">
              {page.rows.map(row => <div data-line={row.line} key={row.line} className={row.selected ? "selected" : ""}><button aria-label={`定位第 ${row.line} 行`}
                onClick={event => event.shiftKey ? extend(row.line) : onLine(row.line)}
                onKeyDown={event => { if (isEvidenceShortcut(event.nativeEvent, ["Enter", " "], true)) { event.preventDefault(); extend(row.line); } }}>{row.line}</button><code>{row.text || " "}</code></div>)}
            </div></>}</>}
      </>}
  </section>;
}
