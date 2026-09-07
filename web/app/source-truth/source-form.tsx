"use client";

import type { DraftInput, FrozenVersion, SourceInput } from "./types.ts";

const createSource = (kind: SourceInput["kind"]): SourceInput => ({ sourceId: crypto.randomUUID(), kind, mode: "UPDATE", label: kind === "GIT" ? "Git 源码" : "本机目录", ...(kind === "GIT" ? { url: "", ref: "HEAD", root: null, credentialRef: null } : {}) });

export function SourceForm({ input, versions, disabled, gitEnabled, onChange, onPickDirectory, directoryName }: {
  input: DraftInput; versions: FrozenVersion[]; disabled: boolean; gitEnabled: boolean; onChange: (input: DraftInput) => void; onPickDirectory: () => void; directoryName: string | null;
}) {
  const selectedVersion = versions.find((version) => version.id === input.baselineBundleId);
  const changeSource = (kind: SourceInput["kind"], source: SourceInput) => onChange({ ...input, sources: input.sources.map((item) => item.kind === kind ? source : item) });
  return <div className="st-source-form">
    <label>版本基线<select disabled={disabled} value={input.baselineBundleId ?? ""} onChange={(event) => onChange({ baselineBundleId: event.target.value || null, sources: input.sources.map((source) => source.mode === "REUSE" ? createSource(source.kind) : source) })}>
      <option value="">不设基线 · 首次或全量新版本</option>
      {versions.map((version) => <option key={version.id} value={version.id}>{new Date(version.publishedAt).toLocaleString("zh-CN")} · {version.id.slice(0, 12)}</option>)}
    </select></label>
    <p className="st-muted">全量、增量都得到逻辑完整的新包。增量只传缺少的字节，不要求复制全部旧材料；目录的新增、修改和删除仍需完整核对。</p>
    <div className="st-source-cards">{(["GIT", "DIRECTORY_UPLOAD"] as const).map((kind) => {
      const source = input.sources.find((source) => source.kind === kind);
      const previous = selectedVersion?.components.find((component) => component.kind === kind);
      return <section className={`st-source-card ${source ? "selected" : ""}`} key={kind}>
        <label className="st-check"><input type="checkbox" checked={Boolean(source)} disabled={disabled || (kind === "GIT" && !gitEnabled && !source)} onChange={(event) => onChange({ ...input, sources: event.target.checked ? [...input.sources, createSource(kind)] : input.sources.filter((source) => source.kind !== kind) })} /><strong>{kind === "GIT" ? "Git 仓库" : "上传目录"}</strong></label>
        <p className="st-muted">{kind === "GIT" ? "读取授权 HTTPS 仓库，锁定精确 commit，不读取工作树。" : "完整读取你所选目录，不需要声明目录外材料。"}</p>
        {kind === "GIT" && !gitEnabled && <p className="st-callout warning">平台尚未配置 Git 只读采集目标。</p>}
        {source && <>
          <label>来源名称<input disabled={disabled} value={source.label} maxLength={200} onChange={(event) => changeSource(kind, { ...source, label: event.target.value })} /></label>
          {input.baselineBundleId && <label>本版处理<select disabled={disabled} value={source.mode} onChange={(event) => {
            if (event.target.value === "REUSE" && previous) changeSource(kind, { kind, sourceId: previous.sourceId, mode: "REUSE", label: source.label, componentId: previous.id });
            else changeSource(kind, { ...createSource(kind), ...source, mode: "UPDATE", componentId: null });
          }}><option value="UPDATE">更新此来源</option><option value="REUSE" disabled={!previous}>沿用基线中的精确组件</option></select></label>}
          {source.mode === "REUSE" ? <p className="st-callout">沿用组件 <code>{source.componentId}</code>。无需重新选择目录或上传。</p> : kind === "GIT" ? <>
            <label>仓库 HTTPS 地址<input type="url" disabled={disabled} value={source.url ?? ""} placeholder="https://git.example.com/team/system.git" onChange={(event) => changeSource(kind, { ...source, url: event.target.value })} /></label>
            <label>版本或分支<input disabled={disabled} value={source.ref ?? "HEAD"} onChange={(event) => changeSource(kind, { ...source, ref: event.target.value })} /></label>
            <label>目录根（留空代表全仓库）<input disabled={disabled} value={source.root ?? source.scope?.root ?? ""} placeholder="例如 services/orders" onChange={(event) => changeSource(kind, { ...source, root: event.target.value || null, scope: undefined })} /></label>
            <label>已登记的只读连接引用（可选）<input disabled={disabled} value={source.credentialRef ?? ""} placeholder="连接引用，不是密码或 Token" onChange={(event) => changeSource(kind, { ...source, credentialRef: event.target.value || null })} /></label>
            {!disabled && <button className="st-link" type="button" onClick={() => changeSource(kind, createSource(kind))}>登记另一个 Git 仓库</button>}
          </> : <>
            <button type="button" className="button" disabled={disabled} onClick={onPickDirectory}>{directoryName ? "重新选择目录" : "选择本机目录"}</button>
            <p>{directoryName ?? "可在第 4 站选择或重新授权目录"}</p>
            <small>目录是逐文件完整读取的上传版本，不是 Git commit，也不承诺操作系统级原子目录快照。请在读取和传输期间保持材料不变。</small>
          </>}
          <p className="st-muted">独立来源 <code>{source.sourceId}</code></p>
        </>}
      </section>;
    })}</div>
    <p className="st-callout">只读采集，不执行文件、脚本、安装命令或 Agent。两类来源保留独立命名空间，同名路径不互相覆盖。安全规则和资源上限由平台固定，不提供 glob 排除入口。</p>
  </div>;
}
