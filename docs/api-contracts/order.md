# Order API Contract (Target Demo)

**Current state:** `order-service/server.js` currently implements `GET /`, `POST /orders`, `GET /orders`, `GET /orders/:id`, and `GET /health`. Orders are in memory; create accepts one product and customer name/email. **Target:** Order owns persistent order records, snapshots, status, and checkout coordination. Prefix: `/api/v1/orders`.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/checkout` | Customer JWT | Create order from cart/items; requires `Idempotency-Key`. |
| `GET` | `/` | Customer JWT | Paginated current user's order history. Admin may list all. |
| `GET` | `/:orderId` | Owner/admin JWT | Read one order. |

Checkout request: `{"items":[{"productId":1,"quantity":2}],"simulatePayment":"success"}`. `simulatePayment` is accepted only in local/demo configuration; production-like deployment would use fixed mock behavior. Do not accept user ID, price, total, stock, or final status from the browser.

Success `201`: `{"data":{"id":"order-1","status":"CONFIRMED","total":1999.98,"currency":"USD","items":[{"productId":1,"productName":"Laptop","unitPrice":999.99,"quantity":2}],"createdAt":"2026-01-01T12:00:00Z"}}`. Checkout may return `202` with `PENDING` if an idempotent retry is needed. Same user/key/same request returns the existing order; same key/different request returns `409 IDEMPOTENCY_KEY_REUSED`.

Order re-reads Product prices, reserves through Inventory, invokes Mock Payment, then commits or releases inventory and stores the resulting status. List query: `page`, `pageSize`, optional `status`; response includes `data` and pagination `meta`. Validate nonempty lines, positive integer quantities, and bounded page size. Errors: `400 VALIDATION_ERROR`, `401`, `403`, `404 ORDER_NOT_FOUND`, `409 INSUFFICIENT_STOCK` / `IDEMPOTENCY_KEY_REUSED` / `ORDER_STATE_CONFLICT`, `503 DEPENDENCY_UNAVAILABLE`, `500 INTERNAL_ERROR`.
