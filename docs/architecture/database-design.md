# Database Design (Target Demo)

## Current state (verified)

There is no database dependency or database configuration in the current repository. Product and Order state are JavaScript arrays in their service processes; the browser cart is stored in `localStorage`. The following is a proposed target for the demo.

## One PostgreSQL server, logical ownership

Run one PostgreSQL server for the project. Give each data-owning service its own schema and migrations. Services access their own schema only; cross-service data is fetched through REST, not joins or direct table writes. A database role per schema is recommended and remains manageable for a demo. A shared local development database can be used, but service code should still use its own schema-qualified tables.

| Schema / owner | Suggested tables and fields |
|---|---|
| `auth` / Authentication | `users(id, email, password_hash, role, created_at)`; unique normalized email. No plaintext passwords. |
| `products` / Product | `products(id, name, description, category, image_url, price, currency, active)`; no stock column. |
| `carts` / Cart | `carts(id, user_id, updated_at)`; `cart_items(cart_id, product_id, quantity)`. Product IDs are references across APIs, not cross-schema foreign keys. |
| `inventory` / Inventory | `inventory_items(product_id, available_quantity)` with `UNIQUE(product_id)` (or `product_id` as the primary key), ensuring one inventory row per product; `reservations(id, order_id, status, expires_at)` with `UNIQUE(order_id)`; `reservation_items(reservation_id, product_id, quantity)`. |
| `orders` / Order | `orders(id, user_id, status, total, currency, idempotency_key, request_hash, created_at)`; `UNIQUE(user_id, idempotency_key)`; `order_items(id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity)`. |
| `payments` / Payment | `payment_attempts(id, order_id, result, amount, created_at)` with `UNIQUE(order_id)` to allow at most one Mock Payment attempt per order in this demo. |

All tables, columns, and constraints in this section are part of the **target database design only**; no database or these tables currently exist in the repository. Use IDs and basic constraints consistently; keep money in a suitable decimal type or integer minor units and never use floating point for persisted totals. Order snapshots the product name and price so later catalog edits do not change order history. `request_hash` stores a hash of the normalized checkout request so Order can verify that a repeated `(user_id, idempotency_key)` represents the same request; a mismatch is rejected rather than treated as a retry.

## Service-to-service data

Cart stores product ID and quantity; it can call Product to display current name/price. At checkout, Order gets current product details and calculates totals itself. Payment receives the order ID and server-calculated amount from Order. No service directly reads or changes another service's tables.

## Inventory quantity and reservation semantics

`inventory_items.available_quantity` means the quantity currently available for a new reservation; quantities held by active reservations have already been removed from this value.

- **Reserve:** In one Inventory database transaction, conditionally subtract each requested quantity from `available_quantity` only if enough remains, and create the reservation/items. For multiple products, reserve all lines atomically: if any line is unavailable, roll back the whole transaction. Use a conditional update such as `UPDATE ... SET available_quantity = available_quantity - :qty WHERE product_id = :id AND available_quantity >= :qty`; check that exactly one row was updated. This prevents concurrent requests from reserving more than available.
- **Commit:** Change the reservation state from `HELD` to `COMMITTED`. Do not subtract quantity again; it was already subtracted during Reserve. Committed quantity is now sold/consumed.
- **Release:** Change `HELD` to `RELEASED` and add its quantities back to `available_quantity` in the same transaction. Only a successful state transition may restore quantity, so retries cannot add it twice.
- **Expiry:** When an Inventory operation encounters an expired `HELD` reservation, mark it `EXPIRED` and restore its quantity once in the same transaction. There is no background worker in this demo; expiry is processed lazily during Commit or a later Inventory operation. Commit must refuse an expired reservation.

Reservation state transitions are `HELD -> COMMITTED`, `HELD -> RELEASED`, or `HELD -> EXPIRED`; terminal states cannot be committed/released again. Inventory operations are idempotent by reservation/order ID and return the existing result on retry.

## Redis and RabbitMQ

Do not add Redis or RabbitMQ to the initial demo. They add setup and operational concepts without helping the required single-instance REST checkout. PostgreSQL provides durable data and direct HTTP demonstrates service communication. Redis could later demonstrate caching; RabbitMQ could later demonstrate asynchronous messaging, but neither is needed for the project goal.
