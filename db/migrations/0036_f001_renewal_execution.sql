-- Execution coordinates are not part of the immutable operation/acceptance
-- binding. A takeover fences the previous verifier before it can publish.
ALTER TABLE source_truth_publication_operation
  ADD COLUMN execution_generation integer NOT NULL DEFAULT 0 CHECK (execution_generation>=0),
  ADD COLUMN execution_id text,
  ADD COLUMN execution_until timestamptz,
  ADD COLUMN retry_after timestamptz,
  ADD COLUMN recovery_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN last_diagnostic jsonb;
CREATE INDEX source_truth_pending_renewal
  ON source_truth_publication_operation(retry_after,created_at)
  WHERE run_id IS NULL AND status='PREPARING' AND NOT recovery_blocked;
