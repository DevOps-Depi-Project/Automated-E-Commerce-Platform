# Service Responsibilities

## Current state (verified)

Only three of the target components are present: static Frontend (`frontend/index.html`), Product (`product-service/server.js`), and Order (`order-service/server.js`). Their current behavior and limitations are recorded in [architecture overview](overview.md). The four services below are proposed and do not yet exist.

## Target demo: seven business services

| Service | Owns / responsibilities | Important boundary |
|---|---|---|
| Frontend | Browser UI, login form, catalog, cart view, checkout and order history screens. | Calls gateway APIs. Never trusts browser prices, stock, payment result, or order state. |
| Authentication | User registration/login, password hashes, roles, and signed JWT issuance. | Does not own carts or orders. Demo logout clears the client token; no token revocation service is required. |
| Product | Product name, description, category, image reference, price and active state. | Does not own stock quantity. |
| Cart | Authenticated user's product IDs and quantities. | Submitted price is ignored; cart does not reserve stock. |
| Inventory | Available quantities and temporary reservations; reserve, commit, and release operations. | The only service allowed to change stock. |
| Order | Checkout coordination, order items with price snapshots, and order status/history. | Reads price from Product and calls Inventory/Payment APIs; does not edit their tables. |
| Payment | Mock payment attempt and its success/failure result. | No real gateway and no card data. The mock result is used only by Order to update the order. |

## Simple communication model

The browser sends external requests through API Gateway/Ingress. Services use synchronous REST over internal service addresses: Cart may query Product; Order queries Product, asks Inventory to reserve/commit/release, and calls Payment for a mock result. Services validate JWTs locally using the demo signing secret; they do not call Authentication on every request. PostgreSQL is one server, with schemas owned by their respective services. There are no additional business services.
