// Verification fixtures name the expected declaration kind and admitted material.
// A reference occurrence sharing that name is not the declaration being tested.
export function uniqueDeclaredObject(records, { materialId, kind, name, parentId }) {
  if (![materialId, kind, name].every(value => typeof value === "string" && value.length > 0)) throw new Error("Explicit material, object kind and declaration name are required");
  const matches = records.filter(record => record.kind === "OBJECT" && record.payload.materialId === materialId
    && record.payload.kind === kind && record.payload.name === name && (parentId === undefined || record.payload.parentId === parentId));
  if (matches.length !== 1) throw new Error(`Expected one ${kind} declaration named ${name}; found ${matches.length}`);
  return matches[0];
}
