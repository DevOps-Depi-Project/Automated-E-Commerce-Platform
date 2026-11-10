# Frontend and Shared API Conventions (Target Demo)

**Current state:** `frontend/index.html` is a static page with inline JavaScript. It calls Product and Order directly using host-port replacement, stores the cart in `localStorage`, and its `checkout()` does not create an order. **Target:** frontend is presentation only and calls APIs through API Gateway/Ingress.

Gateway routes `/` and static asset paths to Frontend. It separately routes `/api/v1/auth/*`, `/api/v1/products/*`, `/cart/*`, `/orders/*`, and `/inventory/*` to their APIs. Internal Mock Payment and Inventory mutation endpoints are not exposed to the public browser. Frontend does not embed service addresses or secrets.

## Shared request and response format

Send JSON with `Content-Type: application/json`; protected requests include `Authorization: Bearer <JWT>`. Successful responses use `{"data":...}`; lists include `"meta":{"page":1,"pageSize":20,"totalItems":1,"totalPages":1}`. Errors use `{"error":{"code":"VALIDATION_ERROR","message":"Invalid request","details":[{"field":"quantity","message":"Must be a positive integer"}]}}`.

Use `200` read/update, `201` create, `202` accepted/pending, `204` no content, `400` validation, `401` missing/invalid token, `403` forbidden, `404` missing resource, `409` conflict/duplicate, `500` unexpected error, and `503` unavailable dependency. Never render client-supplied prices or statuses as authoritative; show the values returned by Product and Order. On checkout retry, reuse the same `Idempotency-Key`. Clear Cart only when Order confirms the checkout outcome.
