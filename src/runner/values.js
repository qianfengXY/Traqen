import { RunnerPolicyError } from "./errors.js";

const templatePattern = /\$\{([^}]+)\}/g;
const sensitiveName =
  /(?:authorization|api[_-]?key|token|password|secret|certificate|private[_-]?key|credential|cookie|set-cookie)/i;

function lookupVariable(variables, path) {
  const segments = path.split(".");
  let value = variables;
  for (const segment of segments) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      throw new RunnerPolicyError(`Template variable ${path} is not defined`);
    }
    value = value[segment];
  }
  return value;
}

export function interpolateValue(value, variables) {
  if (typeof value === "string") {
    const matches = [...value.matchAll(templatePattern)];
    if (matches.length === 1 && matches[0][0] === value) {
      return lookupVariable(variables, matches[0][1]);
    }
    return value.replace(templatePattern, (_match, path) => String(lookupVariable(variables, path)));
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, variables));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, interpolateValue(child, variables)]),
    );
  }
  return value;
}

export async function resolveVariables(variables, secretResolver) {
  const resolved = {};
  const secretValues = new Set();
  for (const [name, value] of Object.entries(variables)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.secretRef === "string"
    ) {
      const secret = await secretResolver(value.secretRef);
      if (typeof secret !== "string" || secret === "") {
        throw new RunnerPolicyError(`Secret ${value.secretRef} could not be resolved`);
      }
      resolved[name] = secret;
      secretValues.add(secret);
    } else {
      resolved[name] = structuredClone(value);
    }
  }
  return { variables: resolved, secretValues };
}

export function redactValue(value, secretValues, path = "", redactions = []) {
  if (typeof value === "string") {
    let redacted = value;
    for (const secret of secretValues) {
      if (secret && redacted.includes(secret)) {
        redacted = redacted.split(secret).join("[REDACTED]");
        redactions.push(path || "/");
      }
    }
    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, secretValues, `${path}/${index}`, redactions));
  }
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const [name, child] of Object.entries(value)) {
      const childPath = `${path}/${name}`;
      if (sensitiveName.test(name)) {
        result[name] = "[REDACTED]";
        redactions.push(childPath);
      } else {
        result[name] = redactValue(child, secretValues, childPath, redactions);
      }
    }
    return result;
  }
  return value;
}

export function uniqueRedactions(redactions) {
  return [...new Set(redactions)].sort();
}
