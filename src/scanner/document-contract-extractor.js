import { contentId, deepFreeze } from "../domain/index.js";

export function extractDocumentContractFacts(artifact, content) {
  const facts = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  for (const match of content.matchAll(headingPattern)) {
    facts.push({
      id: contentId("DOCUMENT-FACT", { artifactId: artifact.id, index: match.index, text: match[2] }),
      type: "DOCUMENT_SECTION",
      artifactId: artifact.id,
      statement: match[2].trim(),
      sourceSpan: { start: match.index, end: match.index + match[0].length },
      authority: "OBSERVED_CANDIDATE_ONLY",
    });
  }
  const methodPattern = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_./{}:-]+)/g;
  for (const match of content.matchAll(methodPattern)) {
    facts.push({
      id: contentId("CONTRACT-FACT", { artifactId: artifact.id, index: match.index, value: match[0] }),
      type: "ENDPOINT_DECLARATION",
      artifactId: artifact.id,
      method: match[1],
      path: match[2],
      sourceSpan: { start: match.index, end: match.index + match[0].length },
      authority: "OBSERVED_CANDIDATE_ONLY",
    });
  }
  return deepFreeze(facts);
}
