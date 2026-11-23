-- Trigram matching lets searches tolerate typos (for example "labtop" -> "Laptop").
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS search;

-- Read model owned by Search Service. It is a copy of the active catalog that is
-- refreshed from Product Service's public API; Product Service remains the source of truth.
CREATE TABLE IF NOT EXISTS search.products (
  product_id INTEGER PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL,
  image_url TEXT,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', name), 'A')
    || setweight(to_tsvector('english', category), 'B')
    || setweight(to_tsvector('english', description), 'C')
  ) STORED,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_products_vector_idx
  ON search.products USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS search_products_name_trgm_idx
  ON search.products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS search_products_category_idx
  ON search.products (lower(category));

-- One row shared by every Search Service replica.
CREATE TABLE IF NOT EXISTS search.sync_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  last_success_at TIMESTAMPTZ,
  product_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO search.sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
