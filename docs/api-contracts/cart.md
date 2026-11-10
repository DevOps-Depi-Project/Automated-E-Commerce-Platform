# Cart API Contract (Target Demo)

**Current state:** there is no Cart Service. The current frontend stores cart lines in browser `localStorage`. **Target:** Cart stores product IDs and quantities per authenticated user. Prefix: `/api/v1/cart`; every route requires a customer JWT. User identity is taken from the token, not the request body.

| Method | Endpoint | Request | Success |
|---|---|---|---|
| `GET` | `/` | — | `200` current user's cart. |
| `POST` | `/items` | `{"productId":1,"quantity":2}` | `201` item added / `200` existing item quantity updated. |
| `PUT` | `/items/:productId` | `{"quantity":3}` | `200` quantity replaced. |
| `DELETE` | `/items/:productId` | — | `204` item removed. |
| `DELETE` | `/` | — | `204` cart cleared after successful checkout. |

Example response: `{"data":{"items":[{"productId":1,"name":"Laptop","quantity":2,"currentPrice":999.99,"currency":"USD"}],"updatedAt":"2026-01-01T12:00:00Z"}}`. Product display data can be obtained from Product; price is informational only. Checkout re-reads the price from Product.

Validate positive integer quantity and existing/active product when adding. Cart does not reserve inventory. Statuses: `400 VALIDATION_ERROR`, `401`, `404 PRODUCT_NOT_FOUND` / `CART_ITEM_NOT_FOUND`, `409 CART_CONFLICT`, `500 INTERNAL_ERROR`, `503 PRODUCT_SERVICE_UNAVAILABLE`.
