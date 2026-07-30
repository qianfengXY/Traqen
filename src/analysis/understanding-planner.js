import { canonicalJson, contentId, deepFreeze } from "../domain/index.js";

const laneByKind = Object.freeze({
  DOCUMENT: "DOCUMENT_CONTRACT",
  CONTRACT: "DOCUMENT_CONTRACT",
  TEST: "TEST_CONFIG_RESULT",
  CONFIG: "TEST_CONFIG_RESULT",
  RESULT: "TEST_CONFIG_RESULT",
});

function laneFor(artifact) {
  if (artifact.disposition !== "INCLUDED") return "GAP";
  return laneByKind[artifact.kind] ?? "DIRECT_SOURCE";
}

function moduleFor(path) {
  const parts = path.split("/");
  if (parts.length === 1) return ".";
  if (["src", "test", "tests", "docs", "contracts", "web"].includes(parts[0])) {
    return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

export function createUnderstandingPlan(input, clock = () => new Date()) {
  if (!input?.inventory?.sealed) throw new TypeError("a sealed ArtifactInventory is required");
  const versions = {
    plannerVersion: input.plannerVersion,
    conventionVersion: input.conventionVersion,
    executionPolicyDigest: input.executionPolicyDigest,
  };
  for (const [name, value] of Object.entries(versions)) {
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  }
  if (input.truthSetDigest || input.truthSet || input.truthSetAnswers) {
    throw new TypeError("production UnderstandingPlan cannot contain Truth Set material");
  }
  const maxArtifacts = input.maxArtifactsPerPartition ?? 32;
  if (!Number.isSafeInteger(maxArtifacts) || maxArtifacts < 1 || maxArtifacts > 1000) {
    throw new RangeError("maxArtifactsPerPartition must be between 1 and 1000");
  }
  const grouped = new Map();
  for (const artifact of input.inventory.artifacts) {
    const lane = laneFor(artifact);
    const locality = moduleFor(artifact.path);
    const key = `${lane}\u0000${locality}`;
    const records = grouped.get(key) ?? [];
    records.push(artifact);
    grouped.set(key, records);
  }
  const partitions = [];
  for (const [groupKey, records] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [lane, locality] = groupKey.split("\u0000");
    for (let offset = 0; offset < records.length; offset += maxArtifacts) {
      const artifacts = records.slice(offset, offset + maxArtifacts);
      const identity = {
        snapshotManifestId: input.inventory.snapshotManifestId,
        lane,
        locality,
        shard: Math.floor(offset / maxArtifacts),
        artifactRanges: artifacts.map(({ id, contentDigest, byteSize }) => ({
          artifactId: id, contentDigest, startByte: 0, endByte: byteSize,
        })),
        ...versions,
      };
      partitions.push({
        id: contentId("UNDERSTANDING-PARTITION", identity),
        lane,
        locality,
        artifactIds: artifacts.map(({ id }) => id),
        disposition: lane === "GAP" ? "EXPLICIT_GAP" : lane === "DIRECT_SOURCE" ? "DIRECT_SOURCE" : "SPECIALIST",
        inputDigest: contentId("INPUT", identity),
      });
    }
  }
  const workUnits = partitions.map((partition) => ({
    id: contentId("UNDERSTANDING-WORK-UNIT", { partitionId: partition.id, kind: "LEAF" }),
    partitionId: partition.id,
    kind: partition.lane === "GAP" ? "GAP" : "LEAF",
    dependencies: [],
    artifactIds: partition.artifactIds,
    inputDigest: partition.inputDigest,
  }));
  const modules = [...new Set(partitions.map(({ locality }) => locality))].sort();
  for (const locality of modules) {
    const dependencies = workUnits.filter((unit) => {
      const partition = partitions.find(({ id }) => id === unit.partitionId);
      return partition?.locality === locality && unit.kind === "LEAF";
    }).map(({ id }) => id).sort();
    if (dependencies.length === 0) continue;
    workUnits.push({
      id: contentId("UNDERSTANDING-WORK-UNIT", { locality, dependencies, kind: "MODULE_SYNTHESIS" }),
      partitionId: null,
      kind: "MODULE_SYNTHESIS",
      dependencies,
      artifactIds: [],
      inputDigest: contentId("INPUT", { locality, dependencies, ...versions }),
    });
  }
  const moduleUnits = workUnits.filter(({ kind }) => kind === "MODULE_SYNTHESIS").map(({ id }) => id).sort();
  if (moduleUnits.length > 0) {
    workUnits.push({
      id: contentId("UNDERSTANDING-WORK-UNIT", { dependencies: moduleUnits, kind: "PROJECT_SYNTHESIS" }),
      partitionId: null,
      kind: "PROJECT_SYNTHESIS",
      dependencies: moduleUnits,
      artifactIds: [],
      inputDigest: contentId("INPUT", { dependencies: moduleUnits, ...versions }),
    });
  }
  const assigned = partitions.flatMap(({ artifactIds }) => artifactIds);
  const unassignedCount = input.inventory.artifacts.length - new Set(assigned).size;
  if (unassignedCount !== 0 || assigned.length !== input.inventory.artifacts.length) {
    throw new TypeError("UnderstandingPlan must assign every ArtifactInventory record exactly once");
  }
  const identity = {
    projectId: input.inventory.projectId,
    snapshotManifestId: input.inventory.snapshotManifestId,
    inventoryId: input.inventory.id,
    ...versions,
    partitions,
    workUnits,
  };
  return deepFreeze({
    id: contentId("UNDERSTANDING-PLAN", identity),
    ...identity,
    artifactCount: input.inventory.artifacts.length,
    assignedCount: assigned.length,
    unassignedCount,
    planDigest: contentId("PLAN", canonicalJson(identity)),
    createdAt: clock().toISOString(),
  });
}

export function appendFollowUpWorkUnit(plan, input) {
  const depth = input.depth ?? 1;
  if (depth > (input.maxDepth ?? 3) || plan.workUnits.filter(({ kind }) => kind === "FOLLOW_UP").length >= (input.maxFollowUps ?? 100)) {
    return deepFreeze({ plan, gap: { code: "UNEXPLORED_BUDGET_LIMIT", parentWorkUnitId: input.parentWorkUnitId } });
  }
  const parent = plan.workUnits.find(({ id }) => id === input.parentWorkUnitId);
  if (!parent) throw new TypeError("parentWorkUnitId does not exist");
  const workUnit = {
    id: contentId("UNDERSTANDING-WORK-UNIT", { parentWorkUnitId: parent.id, question: input.question, depth }),
    partitionId: parent.partitionId,
    kind: "FOLLOW_UP",
    dependencies: [parent.id],
    artifactIds: [...parent.artifactIds],
    inputDigest: contentId("INPUT", { parent: parent.inputDigest, question: input.question, depth }),
  };
  return deepFreeze({ plan: { ...structuredClone(plan), workUnits: [...plan.workUnits, workUnit] }, gap: null });
}
