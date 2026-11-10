CREATE SCHEMA IF NOT EXISTS carts;

CREATE TABLE IF NOT EXISTS carts.carts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carts.cart_items (
  id BIGSERIAL PRIMARY KEY,
  cart_id UUID NOT NULL REFERENCES carts.carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx
  ON carts.cart_items (cart_id);
