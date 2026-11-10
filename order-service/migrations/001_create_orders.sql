CREATE SCHEMA IF NOT EXISTS orders;

CREATE TABLE IF NOT EXISTS orders.orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED')),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  currency CHAR(3) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  reservation_id UUID,
  payment_id VARCHAR(100),
  payment_status VARCHAR(20) CHECK (payment_status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS orders.order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  product_name_snapshot VARCHAR(120) NOT NULL,
  unit_price_snapshot NUMERIC(12, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON orders.orders (user_id, created_at DESC);
