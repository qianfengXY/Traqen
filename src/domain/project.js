import { deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

const principalTypes = new Set(["USER", "SERVICE_ACCOUNT", "RUNNER"]);

function namedEntity(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return {
    id: requireNonEmptyString(value.id, `${fieldName}.id`),
    name: requireNonEmptyString(value.name, `${fieldName}.name`),
  };
}

export function createProjectFoundation(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("project foundation must be an object");
  }
  const organization = namedEntity(input.organization, "organization");
  const tenantInput = namedEntity(input.tenant, "tenant");
  const projectInput = namedEntity(input.project, "project");
  if (!Array.isArray(input.principals ?? [])) throw new TypeError("principals must be an array");
  const principals = (input.principals ?? []).map((principal, index) => {
    if (principal === null || typeof principal !== "object" || Array.isArray(principal)) {
      throw new TypeError(`principals[${index}] must be an object`);
    }
    const type = requireNonEmptyString(principal.type, `principals[${index}].type`).toUpperCase();
    if (!principalTypes.has(type)) throw new TypeError(`principals[${index}].type is not supported`);
    return {
      id: requireNonEmptyString(principal.id, `principals[${index}].id`),
      type,
      displayName: requireNonEmptyString(principal.displayName, `principals[${index}].displayName`),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(principals.map((principal) => principal.id)).size !== principals.length) {
    throw new TypeError("principals must use unique ids");
  }
  return deepFreeze({
    organization,
    tenant: { ...tenantInput, organizationId: organization.id },
    project: { ...projectInput, tenantId: tenantInput.id, status: "ACTIVE" },
    principals,
  });
}
