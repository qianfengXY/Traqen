-- Replay is durable work, not a synchronous comparison result.  Historical
-- terminal rows remain immutable while QUEUED/RUNNING rows can recover a lost
-- worker lease without changing the referenced FactSet.
DROP TRIGGER f002_immutable_replay ON f002_replay;
ALTER TABLE f002_replay DROP CONSTRAINT f002_replay_status_check;
ALTER TABLE f002_replay
  ALTER COLUMN candidate_digest DROP NOT NULL,
  ADD COLUMN operation_id text,
  ADD COLUMN request_digest text,
  ADD COLUMN generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN worker_id text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN cancel_operation_id text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT f002_replay_status_check CHECK (status IN ('QUEUED','RUNNING','MATCH','DIFFERENT','FAILED','CANCELLED'));

CREATE UNIQUE INDEX f002_replay_operation_unique
  ON f002_replay(workspace_id,actor_id,operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX f002_replay_claimable
  ON f002_replay(workspace_id,status,lease_until,created_at);

CREATE FUNCTION f002_guard_replay_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'F002 replay rows are append-only';
  END IF;
  IF OLD.status IN ('MATCH','DIFFERENT','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'Terminal F002 replay rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER f002_guard_replay_lifecycle
  BEFORE UPDATE OR DELETE ON f002_replay
  FOR EACH ROW EXECUTE FUNCTION f002_guard_replay_lifecycle();
