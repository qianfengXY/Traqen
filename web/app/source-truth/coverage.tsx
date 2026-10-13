import type { FileCoverage } from "./types.ts";

export function combinedFileCoverage(components: { fileCoverage?: FileCoverage }[]): FileCoverage | null {
  if (!components.length || components.some(component => !component.fileCoverage)) return null;
  const sums = { total: BigInt(0), verified: BigInt(0), missing: BigInt(0), pending: BigInt(0) };
  for (const component of components) {
    const coverage = component.fileCoverage!;
    for (const key of ["total", "verified", "missing", "pending"] as const) {
      if (!/^\d+$/.test(coverage[key])) return null;
      sums[key] += BigInt(coverage[key]);
    }
  }
  if (sums.total !== sums.verified + sums.missing + sums.pending) return null;
  return Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, value.toString()])) as FileCoverage;
}

export function CoverageMetrics({ coverage }: { coverage: FileCoverage | null }) {
  return <div className="st-metrics" aria-label="文件内容覆盖（不含目录或接受计数）">{([["total", "清单总数"], ["verified", "内容已验证"], ["missing", "明确缺失"], ["pending", "文件待处置"]] as const).map(([key, label]) => <div key={key}><small>{label}</small><strong>{coverage?.[key] ?? "尚未对账"}</strong></div>)}</div>;
}
