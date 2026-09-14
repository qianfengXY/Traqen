-- Waiting tasks can become eligible after a browser closes its manifest or
-- completes the last file. Never rescan all 100k dispositions for every chunk.
CREATE INDEX source_truth_pending_material ON source_truth_entry(workspace_id,run_id,source_id,path_bytes)
  WHERE disposition IS NULL;
