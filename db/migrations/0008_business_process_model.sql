CREATE TABLE business_process_model (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  feature_id text NOT NULL,
  feature_version integer NOT NULL CHECK (feature_version > 0),
  model_payload jsonb NOT NULL CHECK (jsonb_typeof(model_payload) = 'object'),
  authority_actor_id text NOT NULL REFERENCES principal(id),
  authority_actor_role text NOT NULL CHECK (btrim(authority_actor_role) <> ''),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id, version),
  FOREIGN KEY (project_id, feature_id, feature_version)
    REFERENCES feature_version(project_id, feature_id, version)
);

CREATE INDEX idx_business_process_model_feature
  ON business_process_model(project_id, feature_id, version DESC, created_at DESC);
