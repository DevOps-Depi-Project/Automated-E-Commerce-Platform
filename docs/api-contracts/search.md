# Search API Contract

**Implemented in** `search-service/server.js`. Gateway prefix: `/api/search` (Nginx strips it, so `/api/search/search` reaches the service as `/search`). All endpoints are public; Search only exposes active catalog data.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/search` | Public | Search active products with ranking, filters, sorting and pagination. |
| `GET` | `/search/categories` | Public | Categories of active products with product counts. |
| `GET` | `/health` | Public | Liveness plus index sync status. |

## `GET /search`

| Query parameter | Rules |
|---|---|
| `q` | Optional, at most 100 characters. Prefix full-text match on name (highest weight), category and description, plus typo-tolerant trigram match on the name. |
| `category` | Optional, case-insensitive exact match. |
| `minPrice`, `maxPrice` | Optional, nonnegative amounts with at most two decimals. |
| `sort` | `relevance` (default when `q` is given), `name-asc`, `name-desc`, `price-asc`, `price-desc`. Without `q` and `sort`, results are ordered by product ID. |
| `page`, `pageSize` | Positive integers; `pageSize` defaults to 20, maximum 100. |

Response: `{"data":[{"id":1,"name":"Laptop","description":"...","category":"electronics","price":999.99,"currency":"USD","imageUrl":null,"active":true,"relevance":1.3883}],"meta":{"page":1,"pageSize":20,"totalItems":1,"totalPages":1,"query":"lap","sort":"relevance","lastSyncedAt":"2026-11-23T15:00:00.000Z"}}`. `relevance` is `null` when no `q` is given. The product fields match Product Service's product shape so the frontend can render either source.

## `GET /search/categories`

Response: `{"data":[{"category":"electronics","label":"Electronics","count":3}]}`. `category` is the lower-case value to pass to `/search?category=`; `label` is the original spelling for display.

## Data ownership and synchronisation

Search owns the `search` schema (`search.products`, `search.sync_state`). It never reads or writes the `products` schema. Every `SEARCH_SYNC_INTERVAL_SECONDS` (default 30) it pages through Product Service's public `GET /products` endpoint, upserts changed products and deletes products that are no longer active. Results are therefore eventually consistent with Product Service (up to one interval behind). If Product Service is unavailable, the last snapshot keeps being served and `/health` reports `index.lastError`. With several replicas, a PostgreSQL advisory lock lets only one replica apply a snapshot at a time.

Statuses: `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `503 SERVICE_UNAVAILABLE` (database unavailable), `500 INTERNAL_ERROR`.
