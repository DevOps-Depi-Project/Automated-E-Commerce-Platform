# Frontend and Shared API Conventions

**Implemented in** `frontend/index.html` (storefront and `/admin` dashboard) and `frontend/nginx.conf`. The frontend is presentation only and calls every API through the Nginx reverse proxy on the same origin.

Nginx serves `/` and static files, and routes `/api/<service>/<path>` to `<service>:<port>/<path>` for `auth`, `product`, `cart`, `inventory`, `order` and `search`. Unknown `/api/...` paths return a JSON `404`, and an unreachable service returns a JSON `503 SERVICE_UNAVAILABLE`. Internal Mock Payment and Inventory mutation endpoints are not exposed to the public browser. Frontend does not embed service addresses or secrets.

## Shared request and response format

Send JSON with `Content-Type: application/json`; protected requests include `Authorization: Bearer <JWT>`. Successful responses use `{"data":...}`; lists include `"meta":{"page":1,"pageSize":20,"totalItems":1,"totalPages":1}`. Errors use `{"error":{"code":"VALIDATION_ERROR","message":"Invalid request","details":[{"field":"quantity","message":"Must be a positive integer"}]}}`.

Use `200` read/update, `201` create, `202` accepted/pending, `204` no content, `400` validation, `401` missing/invalid token, `403` forbidden, `404` missing resource, `409` conflict/duplicate, `500` unexpected error, and `503` unavailable dependency. Never render client-supplied prices or statuses as authoritative; show the values returned by Product and Order. On checkout retry, reuse the same `Idempotency-Key`. Clear Cart only when Order confirms the checkout outcome.
