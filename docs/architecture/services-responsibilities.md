# Service Responsibilities

## Current state

The repository implements eight business services as Node.js/Express services (plus a static HTML/CSS/JavaScript frontend) and runs them with Docker Compose against one PostgreSQL server. Nginx in the frontend container serves the pages and is the reverse proxy for every public API (`/api/<service>/...`); only port 3000 is published to the host. Kubernetes, CI/CD, Terraform, Ansible and monitoring are not implemented yet.

## Eight business services

| Service | Owns / responsibilities | Important boundary |
|---|---|---|
| Frontend | Browser UI, login form, catalog, cart view, checkout and order history screens, admin dashboard; Nginx reverse proxy. | Calls same-origin `/api/...` paths through Nginx. Never trusts browser prices, stock, payment result, or order state. |
| Authentication | User registration/login, password hashes, roles, and signed JWT issuance. | Does not own carts or orders. Demo logout clears the client token; no token revocation service is required. |
| Product | Product name, description, category, image reference, price and active state. | Does not own stock quantity. |
| Cart | Authenticated user's product IDs and quantities. | Submitted price is ignored; cart does not reserve stock. |
| Inventory | Available quantities and temporary reservations; reserve, commit, and release operations. | The only service allowed to change stock. |
| Order | Checkout coordination, order items with price snapshots, and order status/history. | Reads price from Product and calls Inventory/Payment APIs; does not edit their tables. |
| Payment | Mock payment attempt and its success/failure result. | No real gateway and no card data. The mock result is used only by Order to update the order. |
| Search | Search index of active products, relevance ranking, typo tolerance, filters and category facets. | Copies the catalog from Product's public API every 30 s; never reads or writes Product's schema. |

## Simple communication model

The browser sends external requests through the Nginx reverse proxy (later Kubernetes Ingress). Services use synchronous REST over internal service addresses: Cart may query Product; Order queries Product, asks Inventory to reserve/commit/release, and calls Payment for a mock result; Search periodically reads Product's public catalog. Services validate JWTs locally using the demo signing secret; they do not call Authentication on every request. PostgreSQL is one server, with schemas owned by their respective services. There are no other business services.
