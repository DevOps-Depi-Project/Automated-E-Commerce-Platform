# Architecture Decisions for the University Demo

These decisions describe the implemented demo; see [overview](overview.md).

## Eight business services

Frontend, Authentication, Cart, Payment, Inventory, Product, Order, and Search. The course brief lists search as one of the platform's core components (web, database, payment, search), so it is a separate service rather than a query inside Product. PostgreSQL, Gateway/Ingress, Prometheus, and Grafana are infrastructure, not additional business services.

## One PostgreSQL server with service-owned schemas

Use one local PostgreSQL instance to keep setup approachable. Give each data-owning service a schema and migrations; access other services' data through REST. Separate schema roles are preferred to demonstrate ownership without separate database servers.

## REST and gateway routing

Use synchronous REST for browser-to-service (through Gateway/Ingress) and service-to-service calls. Nginx in the frontend container acts as the gateway: it serves pages/assets and routes `/api/<service>/...` to backend APIs, so only one port is published. This is straightforward to explain and inspect with browser tools/curl.

## JWT authentication

Authentication hashes passwords and issues signed, expiring JWTs. Services validate signatures locally using a shared demo secret supplied through environment configuration; they do not call Authentication on every request. This is a classroom simplification, not a production key-management recommendation. Do not commit the secret.

## Mock Payment and simple checkout

Use a deterministic mock payment success/failure path. Do not collect or store card details. Order owns a small status lifecycle and coordinates Product, Inventory, and Payment with synchronous calls. Persist an idempotency key and normalized request hash to make repeated checkout requests resume the same `PENDING` order. On retry, Order checks the existing Inventory reservation and Mock Payment attempt before acting; a successful payment is reused while Order retries a failed Inventory Commit. Do not create a new Order, reservation, or payment attempt for the same key/order.

Keep failure states visible and explainable; no production Saga framework, outbox, real provider webhooks, refund automation, or background workers are required. Inventory expiry is checked during Commit or a later Inventory operation, not by a scheduled worker.

## Inventory quantity meaning

`available_quantity` is the amount still open for reservation. Reserve atomically subtracts quantity and creates a held reservation in one database transaction; a conditional update prevents concurrent overselling. Commit only finalizes the held reservation and subtracts nothing further. Release returns held quantity to `available_quantity` once. Expiry also returns it once when discovered by an Inventory request. If Mock Payment succeeded but a temporary Commit error occurs, keep Order `PENDING`; only mark it `CONFIRMED` after Commit succeeds. A retry resumes Commit using the existing reservation and payment result.

## Search as a separate read model

Search keeps its own copy of the active catalog in the `search` schema and refreshes it by polling Product's public `GET /products` API every 30 seconds. This keeps data ownership intact (Search never touches the `products` schema), lets search keep working while Product is down, and lets Search scale independently. The trade-off is eventual consistency: catalog changes reach search results within one sync interval. Polling was chosen over events because the demo has no message broker.

## Defer Redis and RabbitMQ

Neither is needed for a single-instance demo with PostgreSQL persistence and direct REST calls. Redis can be a future caching demonstration; RabbitMQ can be a future asynchronous messaging demonstration if time and course scope allow.

## Optional monitoring

Prometheus/Grafana are a stretch goal after the end-to-end flow and Kubernetes deployment work. Start with basic health endpoints and container/pod logs. Do not let dashboards delay a runnable core demo.
