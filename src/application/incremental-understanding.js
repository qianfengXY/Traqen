import { canonicalJson, contentId, deepFreeze, resolveUnderstandingMode } from "../domain/index.js";

export function compareUnderstandingSnapshots(previous, current) {
  const oldArtifacts = new Map((previous?.inventory?.artifacts ?? []).map((artifact) => [artifact.relativePath ?? artifact.path, artifact]));
  const newArtifacts = new Map(current.inventory.artifacts.map((artifact) => [artifact.relativePath ?? artifact.path, artifact]));
  const changes = [];
  for (const path of [...new Set([...oldArtifacts.keys(), ...newArtifacts.keys()])].sort()) {
    const before = oldArtifacts.get(path);
    const after = newArtifacts.get(path);
    if (!before) changes.push({ path, type: "ADDED", beforeArtifactId: null, afterArtifactId: after.id });
    else if (!after) changes.push({ path, type: "REMOVED", beforeArtifactId: before.id, afterArtifactId: null });
    else if (before.contentDigest !== after.contentDigest) {
      changes.push({ path, type: "MODIFIED", beforeArtifactId: before.id, afterArtifactId: after.id });
    }
  }
  return deepFreeze(changes);
}

export function planIncrementalUnderstanding(input) {
  const mode = resolveUnderstandingMode(input.requestedMode ?? "AUTO", input.currentGraphHead);
  const changes = mode === "FULL" ? input.current.inventory.artifacts.map(({ id, path }) => ({
    path, type: "ADDED", beforeArtifactId: null, afterArtifactId: id,
  })) : compareUnderstandingSnapshots(input.previous, input.current);
  const changedArtifactIds = new Set(changes.flatMap(({ beforeArtifactId, afterArtifactId }) =>
    [beforeArtifactId, afterArtifactId].filter(Boolean)));
  const directlyAffected = new Set(input.current.plan.workUnits
    .filter((unit) => unit.artifactIds.some((id) => changedArtifactIds.has(id)))
    .map(({ id }) => id));
  const reverseDependencies = new Map();
  for (const unit of input.current.plan.workUnits) {
    for (const dependency of unit.dependencies) {
      const dependents = reverseDependencies.get(dependency) ?? [];
      dependents.push(unit.id);
      reverseDependencies.set(dependency, dependents);
    }
  }
  const affected = new Set(directlyAffected);
  const pending = [...directlyAffected];
  while (pending.length > 0) {
    const dependency = pending.shift();
    for (const dependent of reverseDependencies.get(dependency) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      pending.push(dependent);
    }
  }
  const affectedWorkUnitIds = input.current.plan.workUnits
    .map(({ id }) => id)
    .filter((id) => affected.has(id));
  const reusedWorkUnitIds = input.current.plan.workUnits.map(({ id }) => id)
    .filter((id) => !affectedWorkUnitIds.includes(id));
  return deepFreeze({
    mode,
    baseRevisionId: mode === "INCREMENTAL" ? input.currentGraphHead.graphRevisionId : null,
    changes,
    affectedWorkUnitIds,
    reusedWorkUnitIds,
    changeSetId: contentId("UNDERSTANDING-CHANGE-SET", {
      from: input.previous?.inventory?.snapshotManifestId ?? null,
      to: input.current.inventory.snapshotManifestId,
      changes,
    }),
    revalidationPlan: {
      required: changes.length > 0,
      affectedArtifactIds: [...changedArtifactIds].sort(),
      affectedWorkUnitIds: [...affectedWorkUnitIds].sort(),
    },
  });
}

export function assertIncrementalEquivalence(incrementalGraph, fullGraph, explainedDeltaIds = []) {
  const ignored = new Set(explainedDeltaIds);
  const normalize = (graph) => ({
    nodes: (graph.nodes ?? []).filter(({ id }) => !ignored.has(id)).sort((a, b) => a.id.localeCompare(b.id)),
    edges: (graph.edges ?? []).filter(({ id }) => !ignored.has(id)).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const equivalent = canonicalJson(normalize(incrementalGraph)) === canonicalJson(normalize(fullGraph));
  return deepFreeze({ equivalent, rate: equivalent ? 1 : 0, explainedDeltaIds: [...ignored].sort() });
}
