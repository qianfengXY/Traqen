import { createHash } from "node:crypto";

import { compileDeterministicFacts } from "../../src/deterministic-facts/extraction/compile.js";

export function verifiedF002Records({ workspaceId, bundleId, componentId, profile, path = "src/evidence.js", source = "export function evidence() {}\n", mediaType = "text/javascript" }) {
  const bytes = Buffer.from(source, "utf8");
  const compiled = compileDeterministicFacts({ workspaceId, bundleId, profile, materials: [{
    componentId, pathBytes: Buffer.from(path, "utf8").toString("base64url"), bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType,
  }] });
  const records = [
    ...compiled.materials.map((payload) => ({ kind: "MATERIAL", id: payload.materialId, payload })),
    ...compiled.objects.map((payload) => ({ kind: "OBJECT", id: payload.objectId, payload })),
    ...compiled.evidence.map((payload) => ({ kind: "EVIDENCE", id: payload.evidenceId, payload })),
    ...compiled.facts.map((payload) => ({ kind: "FACT", id: payload.factId, payload })),
    ...compiled.gaps.map((payload) => ({ kind: "GAP", id: payload.gapId, payload })),
  ];
  return { records, materialId: compiled.materials[0].materialId, factIds: compiled.facts.map((fact) => fact.factId) };
}
