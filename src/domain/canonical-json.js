import { createHash } from "node:crypto";

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeValue(value[key])]),
    );
  }

  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalizeValue(value));
}

export function contentId(prefix, value) {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `${prefix}-${digest.slice(0, 24)}`;
}

export function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
