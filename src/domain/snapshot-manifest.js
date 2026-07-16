import { contentId, deepFreeze } from "./canonical-json.js";
import { requireIsoTimestamp, requireNonEmptyString } from "./model.js";

const requiredComponents = ["source", "build", "deployment", "runtime"];

function validateComponent(component, fieldName) {
  if (component === null || typeof component !== "object" || Array.isArray(component)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  requireNonEmptyString(component.id, `${fieldName}.id`);
  const digest = requireNonEmptyString(component.digest, `${fieldName}.digest`);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${fieldName}.digest must be a SHA-256 digest`);
  }
  return structuredClone(component);
}

export function createSnapshotManifest(input, clock = () => new Date()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("snapshot manifest input must be an object");
  }

  const components = {};
  const missingComponents = [];

  for (const componentName of requiredComponents) {
    const component = input[componentName] ?? input.components?.[componentName];
    if (component === undefined || component === null) {
      missingComponents.push(componentName);
      continue;
    }
    components[componentName] = validateComponent(component, componentName);
  }

  const failedSources = Array.isArray(input.failedSources)
    ? [...new Set(input.failedSources)].sort()
    : [];
  const observedFrom = requireNonEmptyString(input.observedFrom, "observedFrom");
  const observedTo = requireNonEmptyString(input.observedTo, "observedTo");
  const observedFromTimestamp = requireIsoTimestamp(observedFrom, "observedFrom");
  const observedToTimestamp = requireIsoTimestamp(observedTo, "observedTo");
  if (observedFromTimestamp > observedToTimestamp) {
    throw new RangeError("observedFrom must be earlier than or equal to observedTo");
  }
  const identity = {
    components,
    failedSources,
    observedFrom,
    observedTo,
  };

  return deepFreeze({
    id: contentId("SNAPSHOT-MANIFEST", identity),
    ...identity,
    complete: missingComponents.length === 0 && failedSources.length === 0,
    missingComponents,
    createdAt: clock().toISOString(),
  });
}
