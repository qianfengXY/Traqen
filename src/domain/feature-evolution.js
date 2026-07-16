import { deepFreeze } from "./canonical-json.js";
import { assertEnum, requireNonEmptyString, requirePositiveInteger } from "./model.js";

export const FeatureLineageRelation = Object.freeze(Object.fromEntries(
  ["PREDECESSOR_OF", "SUCCESSOR_OF", "MERGED_INTO", "SPLIT_INTO"].map((value) => [value, value]),
));

export function normalizeFeatureAlias(value) {
  return requireNonEmptyString(value, "featureAlias.alias").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function createFeatureAlias(input, clock = () => new Date()) {
  const alias = requireNonEmptyString(input?.alias, "featureAlias.alias").normalize("NFKC").trim();
  return deepFreeze({
    featureId: requireNonEmptyString(input?.featureId, "featureAlias.featureId"),
    featureVersion: requirePositiveInteger(input?.featureVersion, "featureAlias.featureVersion"),
    alias,
    aliasKey: normalizeFeatureAlias(alias),
    actorId: requireNonEmptyString(input?.actorId, "featureAlias.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "featureAlias.actorRole"),
    rationale: requireNonEmptyString(input?.rationale, "featureAlias.rationale"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function createFeatureLineage(input, clock = () => new Date()) {
  const predecessorFeatureId = requireNonEmptyString(
    input?.predecessorFeatureId,
    "featureLineage.predecessorFeatureId",
  );
  const successorFeatureId = requireNonEmptyString(input?.successorFeatureId, "featureLineage.successorFeatureId");
  if (predecessorFeatureId === successorFeatureId) throw new TypeError("Feature lineage cannot reference itself");
  return deepFreeze({
    id: requireNonEmptyString(input?.id, "featureLineage.id"),
    predecessorFeatureId,
    successorFeatureId,
    relationType: assertEnum(FeatureLineageRelation, input?.relationType, "featureLineage.relationType"),
    actorId: requireNonEmptyString(input?.actorId, "featureLineage.actorId"),
    actorRole: requireNonEmptyString(input?.actorRole, "featureLineage.actorRole"),
    rationale: requireNonEmptyString(input?.rationale, "featureLineage.rationale"),
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}
