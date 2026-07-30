import { contentId, deepFreeze } from "../domain/index.js";

const secretName = /(?:password|secret|token|api[_-]?key)/i;

export function extractTestConfigResultFacts(artifact, content) {
  const facts = [];
  if (artifact.kind === "CONFIG") {
    for (const match of content.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]/gm)) {
      facts.push({
        id: contentId("CONFIG-FACT", { artifactId: artifact.id, key: match[1] }),
        type: "CONFIG_KEY",
        artifactId: artifact.id,
        key: secretName.test(match[1]) ? "[REDACTED_KEY]" : match[1],
        valuePresent: true,
        value: null,
        sourceSpan: { start: match.index, end: match.index + match[0].length },
      });
    }
  }
  if (artifact.kind === "TEST") {
    for (const match of content.matchAll(/\b(?:test|it)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      facts.push({
        id: contentId("TEST-ASSET-FACT", { artifactId: artifact.id, name: match[1] }),
        type: "TEST_ASSET",
        artifactId: artifact.id,
        name: match[1],
        provesExecution: false,
        sourceSpan: { start: match.index, end: match.index + match[0].length },
      });
    }
  }
  if (artifact.kind === "RESULT") {
    facts.push({
      id: contentId("RESULT-ASSET-FACT", { artifactId: artifact.id, digest: artifact.contentDigest }),
      type: "EXECUTION_ARTIFACT",
      artifactId: artifact.id,
      provesVerification: false,
    });
  }
  return deepFreeze(facts);
}
