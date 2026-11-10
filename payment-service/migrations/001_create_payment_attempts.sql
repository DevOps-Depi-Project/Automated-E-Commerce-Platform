CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.payment_attempts (
  id UUID PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL UNIQUE,
  idempotency_key VARCHAR(200) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  result VARCHAR(20) NOT NULL CHECK (result IN ('SUCCEEDED', 'FAILED')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_attempts_created_at_idx
  ON payments.payment_attempts (created_at DESC);
