ALTER TABLE feature_lineage
  ADD COLUMN decision_id text,
  ADD COLUMN actor_id text,
  ADD COLUMN actor_role text,
  ADD COLUMN rationale text;

CREATE UNIQUE INDEX feature_lineage_decision_id_unique
  ON feature_lineage (project_id, decision_id)
  WHERE decision_id IS NOT NULL;

CREATE TABLE feature_alias (
  project_id text NOT NULL,
  feature_id text NOT NULL,
  feature_version integer NOT NULL,
  alias text NOT NULL CHECK (btrim(alias) <> ''),
  alias_key text NOT NULL CHECK (btrim(alias_key) <> ''),
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, alias_key),
  FOREIGN KEY (project_id, feature_id, feature_version)
    REFERENCES feature_version(project_id, feature_id, version)
);
