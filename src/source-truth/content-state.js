// Inspection projection only: VERIFIED storage may be an LFS pointer, not its
// external body. Neither this expression nor acceptance changes signed entries.
// Column expressions are supplied by these internal query builders, never HTTP.
export function contentAvailabilitySql(entry = "entry", disposition = "disposition") {
  return `CASE WHEN ${entry}->>'kind'='DIRECTORY' THEN 'METADATA'
    WHEN ${disposition} IS NULL THEN 'PENDING'
    WHEN ${disposition}->>'disposition'='VERIFIED' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(${disposition}->'gaps','[]'::jsonb)) content_gap
      WHERE content_gap->>'ruleCode' IN ('GIT_LFS_EXTERNAL','GIT_SUBMODULE_EXTERNAL')) THEN 'VERIFIED'
    ELSE 'MISSING' END`;
}
