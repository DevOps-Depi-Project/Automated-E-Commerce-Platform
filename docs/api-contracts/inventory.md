# Inventory API Contract

**Implemented in** `inventory-service/server.js`. Inventory alone owns and updates quantities. Gateway path: `/api/inventory` (for example `GET /api/inventory/inventory/1`); the `/internal/...` routes are not routed by the gateway. Gateway can expose read-only availability; reservation operations are internal to Order/Inventory and require service authorization.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/inventory/` | Public | Available quantity of every product (storefront and admin). |
| `GET` | `/inventory/:productId` | Public | Read available quantity for display. |
| `POST` | `/inventory/:productId/adjustments` | Admin JWT | `{"action":"add","quantity":5}` (or `"subtract"`); adding creates the record if missing. |
| `POST` | `/internal/reservations` | Order service | Reserve order lines. |
| `POST` | `/internal/reservations/:id/commit` | Order service | Finalize reserved quantity after mock payment success. |
| `POST` | `/internal/reservations/:id/release` | Order service | Release reservation after failure. |

Reserve request: `{"orderId":"order-1","items":[{"productId":1,"quantity":2}]}` with `Idempotency-Key: reserve-order-1`. Success `201`: `{"data":{"reservationId":"res-1","status":"HELD","items":[{"productId":1,"quantity":2}],"expiresAt":"2026-01-01T12:15:00Z"}}`.

Validate nonempty lines, positive integer quantities, and no duplicate product IDs. Reserve all lines atomically in a PostgreSQL transaction; available stock must not become negative. Commit/release use reservation ID and are safe to retry. Reject commit after expiry; expiration releases held quantity. Statuses: `400 VALIDATION_ERROR`, `401/403`, `404 RESERVATION_NOT_FOUND`, `409 INSUFFICIENT_STOCK` / `RESERVATION_EXPIRED` / `RESERVATION_FINALIZED`, `500 INTERNAL_ERROR`.
