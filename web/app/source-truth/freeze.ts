import type { SourceTruthClient } from "./client.ts";
import type { Candidate, Confirmation } from "./types.ts";

// Two durable server operations, one explicit user intent. Never retry here:
// an unconfirmed result must be reconciled against the original run first.
export async function freezeReviewedCandidate(client: Pick<SourceTruthClient, "request">, runId: string, candidate: Candidate, clientToken: string): Promise<void> {
  const confirmation = await client.request<Confirmation>(`/runs/${runId}/confirm`, "POST", {
    candidateId: candidate.id, gapSetId: candidate.gapSetId,
    ...(candidate.gapCount !== "0" ? { useGapAcceptances: true } : {}),
  });
  await client.request(`/runs/${runId}/seal`, "POST", { confirmationId: confirmation.id, clientToken });
}
