"use client";

import { useState, type ReactElement, type SyntheticEvent } from "react";
import { projectEvidenceDirectory, type DirectoryNode } from "./directory.ts";
import { evidenceRecordTitle as title, evidenceMatchDescription, type EvidenceFilters } from "./search.ts";
import type { Coverage, FactRecord } from "./types.ts";

const parentReasons: Record<string, string> = {
  PARENT_NOT_LOADED: "父项当前未加载，保留独立定位", PARENT_OUTSIDE_MATERIAL: "父项不属于同一材料，不补连线",
  PARENT_CYCLE: "父项引用成环，不猜层级", PARENT_INVALID: "父项定位无效", PARENT_DEPTH_LIMIT: "层级超出本次显示边界，保留独立定位",
};

export function DirectoryView({ materials, objects, filters, coverage, selectedId, selectedKind, readingMaterialId, expandedDirectory, onExpansion, select }: {
  materials: FactRecord[]; objects: FactRecord[]; filters: EvidenceFilters; coverage: Coverage | null;
  selectedId?: string; selectedKind?: string; readingMaterialId?: string;
  expandedDirectory: string[]; onExpansion: (keys: string[]) => void; select: (record: FactRecord, line?: number) => void;
}) {
  const [notice, setNotice] = useState("");
  const groups = projectEvidenceDirectory(materials, objects, filters, coverage);
  const toggle = (key: string, event: SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open, expanded = new Set(expandedDirectory);
    if (open === expanded.has(key)) return;
    if (open && expanded.size >= 64) { event.currentTarget.open = false; setNotice("最多保存 64 项目录展开偏好；请先关闭其他项。没有替换阅读定位。"); return; }
    if (open) expanded.add(key); else expanded.delete(key);
    setNotice(""); onExpansion([...expanded]);
  };
  const object = (node: DirectoryNode): ReactElement => <li key={node.record.id} data-directory-object={node.record.id}>
    <button data-directory-select="true" aria-current={selectedKind === "OBJECT" && selectedId === node.record.id ? "true" : undefined}
      onClick={() => select(node.record, node.record.payload.anchor?.lineStart)}>{title(node.record)}<small>{node.record.payload.kind} · {node.record.id}</small>
      {node.fields.length > 0 && <small>{evidenceMatchDescription(node.fields)}</small>}{node.reason && <small>{parentReasons[node.reason]}</small>}</button>
    {node.children.length > 0 && <details open={expandedDirectory.includes(`OBJECT:${node.record.id}`)} onToggle={event => toggle(`OBJECT:${node.record.id}`, event)}>
      <summary>展开 {title(node.record)} 的已声明子对象</summary><ul>{node.children.map(object)}</ul>
    </details>}
  </li>;
  return <>
    {notice && <p role="status">{notice}</p>}
    {!groups.length && <p className="f002-empty" role="status">{filters.processingStatus && !coverage ? "处置状态未确认；没有按未知状态自动放开筛选。" : "没有匹配材料或材料内对象；保留条件，可清除筛选或继续加载。无匹配不等于正文不可读，也不等于没有已提取事实。"}</p>}
    <ul className="f002-directory-tree">{groups.map(group => {
      const material = group.material, key = `MATERIAL:${material.id}`;
      const dispositions = coverage?.items.filter(item => item.materialId === material.id).map(item => `${item.capabilityId}: ${item.status}`);
      return <li key={material.id} data-directory-material={material.id} data-reading-material={readingMaterialId === material.id ? "true" : undefined}>
        <button aria-current={selectedKind === "MATERIAL" && selectedId === material.id ? "true" : undefined} onClick={() => select(material)} title={title(material)}>
          {title(material)}<small>{material.payload.kind} · {material.payload.contentAvailable === false ? "正文不可用" : "受控可读"}</small>
          {group.fields.length > 0 && <small>{evidenceMatchDescription(group.fields)}</small>}
          <small>{dispositions?.join("；") || "能力处置尚未确认"}</small>
          {material.payload.componentId && <small title={material.payload.componentId}>组件：{material.payload.componentId.slice(0, 12)}…</small>}
        </button>
        {group.objects.length > 0 ? <details open={expandedDirectory.includes(key)} onToggle={event => toggle(key, event)}>
          <summary>展开材料内已加载对象</summary><ul>{group.objects.map(object)}</ul>
        </details> : <small>本加载页没有可展开对象；材料仍可独立读取。</small>}
      </li>;
    })}</ul>
    <p className="f002-caption">仅显示当前获准的加载页。材料归属按完整编号；父项仅用服务端明确引用。未提供父结构时不补层级，不从同名或同路径推断业务关联。</p>
  </>;
}
