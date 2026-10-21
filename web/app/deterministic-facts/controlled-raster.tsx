"use client";

/* eslint-disable @next/next/no-img-element -- Only member-authorized, digest-checked local blobs; never an optimization proxy or external source. */

import { useEffect, useMemo, useState } from "react";
import { rasterImageHeader } from "../../../src/deterministic-facts/raster-image.js";

type Decoded = { bytes: Uint8Array; url: string | null; width: number; height: number; error: string | null };

export function ControlledRaster({ bytes, mediaType, label }: { bytes: Uint8Array; mediaType: string; label: string }) {
  const header = useMemo(() => rasterImageHeader(bytes), [bytes]);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [zoom, setZoom] = useState(1);
  const current = decoded?.bytes === bytes ? decoded : null;
  const allowed = header?.mediaType === mediaType;
  useEffect(() => {
    if (!allowed || !header) return;
    let active = true;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
    const probe = new Image();
    probe.src = url;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DECODE_TIMEOUT")), 8000); });
    void Promise.race([probe.decode(), deadline]).then(() => {
      const width = probe.naturalWidth, height = probe.naturalHeight;
      // EXIF orientation may exchange the two dimensions, but may not invent
      // another pixel extent beyond the already bounded header.
      if (!((width === header.width && height === header.height) || (height === header.width && width === header.height))) throw new Error("DECODE_DIMENSION_MISMATCH");
      if (active) setDecoded({ bytes, url, width, height, error: null });
    }).catch(() => {
      URL.revokeObjectURL(url);
      if (active) setDecoded({ bytes, url: null, width: 0, height: 0, error: "图片无法在受控预算内解码；没有将其当作活动文档或换成其他材料。" });
    }).finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      probe.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [allowed, bytes, header, mediaType]);
  return <div className="f002-raster">
    {!allowed ? <p className="f002-notice" role="alert">图片格式或像素尺寸不满足受控展示条件；原始冻结材料未改写。</p>
      : current?.error ? <p className="f002-notice" role="alert">{current.error}</p>
      : !current?.url ? <p role="status">正在校验原图解码与尺寸…</p>
      : <>
        <p className="f002-caption">原图 {current.width} × {current.height} · 仅呈现像素，不推断业务含义。</p>
        <div className="f002-actions">
          <button className="button" disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .25))}>缩小原图</button>
          <button className="button" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .25))}>放大原图</button>
          <button className="button" onClick={() => setZoom(1)}>原图 100%</button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="f002-image-scroll" tabIndex={0} aria-label="固定版本原图，可独立滚动">
          <img src={current.url} alt={label} style={{ maxWidth: "none", width: `${current.width * zoom}px`, height: `${current.height * zoom}px` }} />
        </div>
      </>}
  </div>;
}
