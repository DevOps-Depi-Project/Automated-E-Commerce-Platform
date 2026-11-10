# Implementation Roadmap: University Demo

This is a proposed target plan, not a statement that the services are implemented. Current verified state: static Frontend, Node/Express Product and Order, in-memory Product/Order data, browser-local cart, and existing three-component Docker/Kubernetes configuration. See [overview](architecture/overview.md).

Each phase is completed and reviewed before the next begins. Exactly seven business services remain in scope.

## Phase 1: Architecture & API Contracts

- **Scope:** demo-level service boundaries, PostgreSQL schema ownership, REST contracts, JWT and simple checkout decisions.
- **Expected files:** `docs/architecture/*.md`, `docs/api-contracts/*.md`, `docs/implementation-roadmap.md`, concise target/current clarification in `README.md`.
- **Dependencies:** repository audit and team agreement.
- **Acceptance:** current facts and target are separated; all seven services are covered; contracts and demo workflow are consistent; no application code changed.

## Phase 2: Database Foundation and Product/Order Persistence

- **Scope:** one PostgreSQL service for local demo; add Product and Order persistence, migrations, validation, order snapshots and statuses.
- **Expected files:** modify `product-service/server.js`, `order-service/server.js`, their package manifests/lockfiles and Dockerfiles; add migrations/database modules within those service directories; update Compose configuration when infrastructure phase is approved.
- **Dependencies:** Phase 1 schema/contracts.
- **Acceptance:** products and orders survive service restart; order creation reads Product over REST; unique user/idempotency key prevents duplicate orders; no shared in-memory order authority.

## Phase 3: Authentication

- **Scope:** create Authentication service with password hashing, login, JWT issuance and role checks.
- **Expected files:** new `authentication-service/` source, package manifest/lockfile, Dockerfile and schema/migrations; update gateway configuration and environment documentation.
- **Dependencies:** PostgreSQL conventions from Phase 2; agreed JWT claims/secret configuration.
- **Acceptance:** password hashes only; valid/expired JWT behavior is clear; services verify JWT locally; no admin role escalation at registration.

## Phase 4: Cart

- **Scope:** persistent user cart and basic add/update/remove/read operations.
- **Expected files:** new `cart-service/` source, package manifest/lockfile, Dockerfile and migrations; gateway/config docs.
- **Dependencies:** Authentication and Product contracts.
- **Acceptance:** cart is isolated per user and persisted; quantity validation works; prices are informational and revalidated by Order.

## Phase 5: Inventory

- **Scope:** authoritative quantity storage and simple atomic reserve/commit/release API.
- **Expected files:** new `inventory-service/` source, package manifest/lockfile, Dockerfile and migrations; adjust Product to remove stock ownership; update Order integration.
- **Dependencies:** PostgreSQL and order state design.
- **Acceptance:** concurrent reserve cannot make stock negative; failure leaves stock unchanged; successful payment commits; failed payment releases; expired reservation cannot commit.

## Phase 6: Payment

- **Scope:** simple synchronous Mock Payment success/failure and persisted attempt result.
- **Expected files:** new `payment-service/` source, package manifest/lockfile, Dockerfile and migrations; Order integration.
- **Dependencies:** Phase 2 order persistence and Phase 5 reservation API.
- **Acceptance:** demo can show success and failure; repeated order attempt does not create duplicate mock payment; no card data or real provider/webhook.

## Phase 7: Frontend Integration and Full Scenario

- **Scope:** gateway-based API calls, JWT session, Cart and checkout integration, order history/status display.
- **Expected files:** modify `frontend/index.html` and/or add frontend assets/config; update API contracts if approved.
- **Dependencies:** Phases 2–6 APIs are available.
- **Acceptance:** demonstrate login → browse → cart → checkout success; demonstrate payment failure and reservation release; view user's orders; retry does not duplicate an order; error states are visible.

## Phase 8: Docker, Kubernetes, CI/CD and optional Monitoring

- **Scope:** Dockerfile for each of the seven services; local Compose setup; Kubernetes Deployment/Service for each; Gateway/Ingress; GitHub Actions build/lint/API checks; optional Prometheus/Grafana if time allows.
- **Expected files:** service Dockerfiles; `docker-compose.yml`; `k8s/` manifests; `.github/workflows/` updates; monitoring manifests/config only if the core is complete; README setup/demo instructions.
- **Dependencies:** all seven services and working end-to-end scenario.
- **Acceptance:** one documented command path builds/starts the demo; all seven services are independently deployed/routable in Kubernetes; CI checks service packages and basic API behavior; optional dashboards show service health/metrics. Do not let monitoring block demo completion.
