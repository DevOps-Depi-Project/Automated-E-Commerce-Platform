CREATE SCHEMA IF NOT EXISTS products;

CREATE TABLE IF NOT EXISTS products.products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO products.products (id, name, description, category, price, currency, active)
VALUES
  (1, 'Laptop', 'High-performance laptop with 16GB RAM and 512GB SSD', 'electronics', 999.99, 'USD', TRUE),
  (2, 'Smartphone', 'Latest smartphone with 5G connectivity and dual camera', 'electronics', 699.99, 'USD', TRUE),
  (3, 'Headphones', 'Wireless noise-cancelling headphones with 30-hour battery', 'electronics', 149.99, 'USD', TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('products.products', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM products.products), 1),
  TRUE
);
