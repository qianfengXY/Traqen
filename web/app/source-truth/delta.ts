import type { FrozenVersion } from "./types.ts";

type VersionSources = Pick<FrozenVersion, "components">;

export function deltaSources(target: VersionSources, baseline?: VersionSources) {
  const sources = new Map(target.components.map((source) => [source.sourceId, source]));
  for (const source of baseline?.components ?? []) {
    if (!sources.has(source.sourceId)) sources.set(source.sourceId, source);
  }
  return [...sources.values()];
}

export function selectedDeltaSource(sources: VersionSources["components"], selected: string) {
  return sources.some((source) => source.sourceId === selected) ? selected : sources[0]?.sourceId ?? "";
}
