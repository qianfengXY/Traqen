import { deepFreeze } from "./canonical-json.js";
import {
  BusinessStateKind,
  DesignElementType,
  assertEnum,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./model.js";

function optionalString(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, fieldName);
}

function uniqueById(items, fieldName, normalize) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError(`${fieldName} must be a non-empty array`);
  const normalized = items.map((item, index) => normalize(item, `${fieldName}[${index}]`));
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    throw new TypeError(`${fieldName} ids must be unique`);
  }
  return normalized;
}

function stringArray(value, fieldName, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new TypeError(`${fieldName} must be ${required ? "a non-empty" : "an"} array`);
  }
  const result = value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return result;
}

function factRefs(value, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  const result = value.map((item, index) => ({
    snapshotManifestId: requireNonEmptyString(item?.snapshotManifestId, `${fieldName}[${index}].snapshotManifestId`),
    factId: requireNonEmptyString(item?.factId, `${fieldName}[${index}].factId`),
  }));
  const identities = result.map((item) => `${item.snapshotManifestId}\u0000${item.factId}`);
  if (new Set(identities).size !== identities.length) throw new TypeError(`${fieldName} must not contain duplicates`);
  return result;
}

function normalizeActor(item, fieldName) {
  return {
    id: requireNonEmptyString(item?.id, `${fieldName}.id`),
    name: requireNonEmptyString(item?.name, `${fieldName}.name`),
    role: requireNonEmptyString(item?.role, `${fieldName}.role`),
    responsibilities: stringArray(item?.responsibilities, `${fieldName}.responsibilities`),
  };
}

function normalizeState(item, fieldName) {
  return {
    id: requireNonEmptyString(item?.id, `${fieldName}.id`),
    name: requireNonEmptyString(item?.name, `${fieldName}.name`),
    kind: assertEnum(BusinessStateKind, item?.kind, `${fieldName}.kind`),
    description: optionalString(item?.description, `${fieldName}.description`),
  };
}

function normalizeTransition(item, fieldName) {
  return {
    id: requireNonEmptyString(item?.id, `${fieldName}.id`),
    name: requireNonEmptyString(item?.name, `${fieldName}.name`),
    fromStateId: requireNonEmptyString(item?.fromStateId, `${fieldName}.fromStateId`),
    toStateId: requireNonEmptyString(item?.toStateId, `${fieldName}.toStateId`),
    trigger: requireNonEmptyString(item?.trigger, `${fieldName}.trigger`),
    actorIds: stringArray(item?.actorIds, `${fieldName}.actorIds`, { required: true }),
    guards: stringArray(item?.guards, `${fieldName}.guards`),
    exception: optionalString(item?.exception, `${fieldName}.exception`),
    nextFeatureId: optionalString(item?.nextFeatureId, `${fieldName}.nextFeatureId`),
    implementationFactRefs: factRefs(item?.implementationFactRefs, `${fieldName}.implementationFactRefs`),
  };
}

function normalizeDesignElement(item, fieldName) {
  return {
    id: requireNonEmptyString(item?.id, `${fieldName}.id`),
    name: requireNonEmptyString(item?.name, `${fieldName}.name`),
    type: assertEnum(DesignElementType, item?.type, `${fieldName}.type`),
    description: optionalString(item?.description, `${fieldName}.description`),
    implementationFactRefs: factRefs(item?.implementationFactRefs, `${fieldName}.implementationFactRefs`),
  };
}

export function createBusinessProcessModel(input, clock = () => new Date()) {
  const actors = uniqueById(input?.actors, "processModel.actors", normalizeActor);
  const states = uniqueById(input?.states, "processModel.states", normalizeState);
  const transitions = uniqueById(input?.transitions, "processModel.transitions", normalizeTransition);
  const designElements = input?.designElements === undefined
    ? []
    : uniqueById(input.designElements, "processModel.designElements", normalizeDesignElement);
  const actorIds = new Set(actors.map((item) => item.id));
  const stateIds = new Set(states.map((item) => item.id));
  if (states.filter((item) => item.kind === BusinessStateKind.INITIAL).length !== 1) {
    throw new TypeError("processModel.states must contain exactly one INITIAL state");
  }
  if (!states.some((item) => item.kind === BusinessStateKind.TERMINAL)) {
    throw new TypeError("processModel.states must contain at least one TERMINAL state");
  }
  for (const transition of transitions) {
    if (!stateIds.has(transition.fromStateId) || !stateIds.has(transition.toStateId)) {
      throw new TypeError(`Transition ${transition.id} must reference states in the same process model`);
    }
    if (transition.actorIds.some((id) => !actorIds.has(id))) {
      throw new TypeError(`Transition ${transition.id} must reference actors in the same process model`);
    }
    if (transition.fromStateId === transition.toStateId) {
      throw new TypeError(`Transition ${transition.id} must change business state`);
    }
  }
  const reachable = new Set(states.filter((item) => item.kind === BusinessStateKind.INITIAL).map((item) => item.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of transitions) {
      if (reachable.has(transition.fromStateId) && !reachable.has(transition.toStateId)) {
        reachable.add(transition.toStateId);
        changed = true;
      }
    }
  }
  const unreachable = states.filter((item) => !reachable.has(item.id)).map((item) => item.id);
  if (unreachable.length > 0) throw new TypeError(`processModel contains unreachable states: ${unreachable.join(", ")}`);

  return deepFreeze({
    id: requireNonEmptyString(input?.id, "processModel.id"),
    version: requirePositiveInteger(input?.version, "processModel.version"),
    featureId: requireNonEmptyString(input?.featureId, "processModel.featureId"),
    featureVersion: requirePositiveInteger(input?.featureVersion, "processModel.featureVersion"),
    name: requireNonEmptyString(input?.name, "processModel.name"),
    description: optionalString(input?.description, "processModel.description"),
    actors,
    states,
    transitions,
    designElements,
    authority: {
      actorId: requireNonEmptyString(input?.authority?.actorId, "processModel.authority.actorId"),
      actorRole: requireNonEmptyString(input?.authority?.actorRole, "processModel.authority.actorRole"),
      rationale: requireNonEmptyString(input?.authority?.rationale, "processModel.authority.rationale"),
      decisionRefs: stringArray(input?.authority?.decisionRefs, "processModel.authority.decisionRefs"),
      confirmedAt: input?.authority?.confirmedAt ?? clock().toISOString(),
    },
    createdAt: input?.createdAt ?? clock().toISOString(),
  });
}

export function listBusinessProcessFactRefs(processModel) {
  const refs = [
    ...processModel.transitions.flatMap((item) => item.implementationFactRefs),
    ...processModel.designElements.flatMap((item) => item.implementationFactRefs),
  ];
  return [...new Map(refs.map((item) => [`${item.snapshotManifestId}\u0000${item.factId}`, item])).values()];
}
