CREATE TABLE orders (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'CANCELLED')),
  submitted_by text,
  submitted_at timestamptz
);

CREATE TABLE order_submission_idempotency (
  order_id text NOT NULL REFERENCES orders(id),
  idempotency_key text NOT NULL,
  response_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, idempotency_key)
);
