CREATE SCHEMA IF NOT EXISTS inventory;

CREATE TABLE IF NOT EXISTS inventory.inventory_items (
  product_id INTEGER PRIMARY KEY,
  available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS inventory.reservations (
  id UUID PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory.reservation_items (
  reservation_id UUID NOT NULL REFERENCES inventory.reservations(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (reservation_id, product_id)
);

INSERT INTO inventory.inventory_items (product_id, available_quantity)
VALUES (1, 10), (2, 25), (3, 15)
ON CONFLICT (product_id) DO NOTHING;
