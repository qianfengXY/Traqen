-- Current request ownership is checked on claim, renew, seal and cancellation.
-- Keep lookup bounded without changing ownership or uniqueness semantics.
CREATE INDEX f002_request_derived_scope
  ON f002_request(workspace_id,derived_run_id,derived_scope_id);
