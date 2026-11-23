# Product API Contract

**Implemented in** `product-service/server.js`. Product owns catalog and price only; Inventory owns stock. Service prefix: `/products`; gateway path: `/api/product/products`. Storefront search is served by [Search Service](search.md), which mirrors this catalog.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | Public | Paginated catalog; optional `page`, `pageSize`, `q`, `category`. |
| `GET` | `/:productId` | Public | Read one active product. |
| `GET` | `/admin/products` (no `/products` prefix) | Admin JWT | All products including inactive ones. |
| `POST` | `/` | Admin JWT | Add product. |
| `PUT` | `/:productId` | Admin JWT | Replace editable catalog fields. |
| `DELETE` | `/:productId` | Admin JWT | Deactivate product for demo. |

Product example: `{"id":1,"name":"Laptop","description":"16GB RAM","category":"electronics","price":999.99,"currency":"USD","imageUrl":"/images/laptop.png","active":true}`. List response: `{"data":[{"id":1,"name":"Laptop","price":999.99,"currency":"USD","active":true}],"meta":{"page":1,"pageSize":20,"totalItems":1,"totalPages":1}}`.

Create request uses name, description, category, price, currency, imageUrl. Validate required text, finite nonnegative price, supported currency, bounded pagination, and allowlisted sort fields. Do not accept stock in target catalog writes. Statuses: `400 VALIDATION_ERROR`, `401`, `403`, `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_CONFLICT`, `500 INTERNAL_ERROR`. Order queries Product at checkout and calculates the trusted total itself.
