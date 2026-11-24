const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { setupMetrics } = require('./metrics');

const app = express();
const PORT = Number(process.env.PORT) || 3007;
const DATABASE_URL = process.env.DATABASE_URL;
const PRODUCT_SERVICE_URL = (process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001').replace(/\/+$/, '');
const SYNC_INTERVAL_SECONDS = Number(process.env.SEARCH_SYNC_INTERVAL_SECONDS || 30);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5000;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const CATALOG_PAGE_SIZE = 100; // Product Service's maximum page size.
const CATALOG_MAX_PAGES = 1000;
const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_TERMS = 10;
// Minimum pg_trgm word similarity for a typo-tolerant name match (0..1).
const TYPO_SIMILARITY_THRESHOLD = 0.3;
// Any constant works; it only has to be the same for every replica.
const SYNC_LOCK_ID = 730701;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!Number.isInteger(SYNC_INTERVAL_SECONDS) || SYNC_INTERVAL_SECONDS < 5) {
  throw new Error('SEARCH_SYNC_INTERVAL_SECONDS must be an integer of at least 5');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Makes the indexable "<%" operator use the same threshold as the ranking below.
  options: `-c pg_trgm.word_similarity_threshold=${TYPO_SIMILARITY_THRESHOLD}`
});

app.disable('x-powered-by');
const metrics = setupMetrics(app, 'search-service');
const searchQueries = metrics.counter({
  name: 'search_queries_total',
  help: 'Search requests by type (text = with q, browse = filters only) and whether anything matched',
  labelNames: ['type', 'result']
});
const syncRuns = metrics.counter({
  name: 'search_sync_runs_total',
  help: 'Index synchronisation runs by result',
  labelNames: ['result']
});
const indexedProducts = metrics.gauge({
  name: 'search_index_products',
  help: 'Active products in the search index after the last successful sync'
});
const lastSyncSuccess = metrics.gauge({
  name: 'search_index_last_success_timestamp_seconds',
  help: 'Unix time of the last successful index sync'
});
app.use(express.json({ limit: '10kb' }));

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorResponse(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : null;
}

function parsePriceFilter(value) {
  if (value === undefined || value === '') return { value: null, valid: true };
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) {
    return { value: null, valid: false };
  }
  return { value: value, valid: true };
}

// Builds a safe prefix tsquery ("lap pro" -> "lap:* & pro:*") so results update while typing.
// Only letters and digits survive, so user input can never break to_tsquery syntax.
function buildPrefixQuery(text) {
  const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const unique = [...new Set(terms)].slice(0, MAX_QUERY_TERMS);
  return unique.length ? unique.map(term => `${term}:*`).join(' & ') : null;
}

const SORTS = {
  relevance: 'relevance DESC, lower(name) ASC, product_id ASC',
  'name-asc': 'lower(name) ASC, product_id ASC',
  'name-desc': 'lower(name) DESC, product_id ASC',
  'price-asc': 'price ASC, product_id ASC',
  'price-desc': 'price DESC, product_id ASC'
};

function mapResult(row) {
  return {
    id: row.product_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    currency: row.currency.trim(),
    imageUrl: row.image_url,
    active: true,
    relevance: row.relevance === null ? null : Number(Number(row.relevance).toFixed(4))
  };
}

app.get('/', (req, res) => {
  res.json({
    service: 'Search Service',
    version: '1.0.0',
    endpoints: {
      'GET /search': 'Search active products: q, category, minPrice, maxPrice, sort, page, pageSize',
      'GET /search/categories': 'List categories of active products with product counts',
      'GET /health': 'Health check and index sync status'
    }
  });
});

app.get('/search', async (req, res, next) => {
  const details = [];
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const page = parsePositiveInteger(req.query.page, 1);
  const pageSize = parsePositiveInteger(req.query.pageSize, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
  const minPrice = parsePriceFilter(req.query.minPrice);
  const maxPrice = parsePriceFilter(req.query.maxPrice);
  const sortKey = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : (rawQuery ? 'relevance' : '');

  if (rawQuery.length > MAX_QUERY_LENGTH) details.push({ field: 'q', message: `Must be at most ${MAX_QUERY_LENGTH} characters` });
  if (category.length > 80) details.push({ field: 'category', message: 'Must be at most 80 characters' });
  if (page === null) details.push({ field: 'page', message: 'Must be a positive integer' });
  if (pageSize === null) details.push({ field: 'pageSize', message: `Must be a positive integer of at most ${PAGE_SIZE_MAX}` });
  if (!minPrice.valid) details.push({ field: 'minPrice', message: 'Must be a nonnegative amount with at most two decimals' });
  if (!maxPrice.valid) details.push({ field: 'maxPrice', message: 'Must be a nonnegative amount with at most two decimals' });
  if (sortKey && !SORTS[sortKey]) {
    details.push({ field: 'sort', message: 'Use relevance, name-asc, name-desc, price-asc, or price-desc' });
  }
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  const values = [];
  const param = value => {
    values.push(value);
    return `$${values.length}`;
  };
  const filters = [];
  let relevance = 'NULL::real';

  if (rawQuery) {
    const textParam = param(rawQuery);
    const prefixQuery = buildPrefixQuery(rawQuery);
    if (prefixQuery) {
      const tsQuery = `to_tsquery('english', ${param(prefixQuery)})`;
      filters.push(`(search_vector @@ ${tsQuery} OR ${textParam} <% name)`);
      relevance = `(ts_rank(search_vector, ${tsQuery}) + word_similarity(${textParam}, name))`;
    } else {
      filters.push(`${textParam} <% name`);
      relevance = `word_similarity(${textParam}, name)`;
    }
  }
  if (category) filters.push(`lower(category) = lower(${param(category)})`);
  if (minPrice.value !== null) filters.push(`price >= ${param(minPrice.value)}::numeric`);
  if (maxPrice.value !== null) filters.push(`price <= ${param(maxPrice.value)}::numeric`);

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = SORTS[sortKey] || 'product_id ASC';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total,
              (SELECT last_success_at FROM search.sync_state WHERE id = 1) AS last_synced_at
       FROM search.products ${where}`,
      values
    );
    const totalItems = countResult.rows[0].total;
    const listResult = await pool.query(
      `SELECT product_id, name, description, category, price, currency, image_url,
              ${relevance} AS relevance
       FROM search.products ${where}
       ORDER BY ${orderBy}
       LIMIT ${param(pageSize)} OFFSET ${param((page - 1) * pageSize)}`,
      values
    );

    searchQueries.inc({ type: rawQuery ? 'text' : 'browse', result: totalItems ? 'hit' : 'empty' });
    return res.json({
      data: listResult.rows.map(mapResult),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
        query: rawQuery || null,
        sort: sortKey || 'default',
        lastSyncedAt: countResult.rows[0].last_synced_at
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/search/categories', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT lower(category) AS category, MIN(category) AS label, COUNT(*)::int AS count
       FROM search.products
       GROUP BY lower(category)
       ORDER BY count DESC, category ASC`
    );
    return res.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Index synchronisation: pull the active catalog from Product Service's public
// API and mirror it into the search schema. Product Service is never modified.
// ---------------------------------------------------------------------------

const syncStatus = {
  running: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  indexedProducts: null
};

function normalizeCatalogProduct(product) {
  if (!product || product.active !== true) return null;
  const id = product.id;
  const name = typeof product.name === 'string' ? product.name.trim() : '';
  const description = typeof product.description === 'string' ? product.description : '';
  const category = typeof product.category === 'string' ? product.category.trim() : '';
  const currency = typeof product.currency === 'string' ? product.currency.trim().toUpperCase() : '';
  const price = product.price;
  const imageUrl = typeof product.imageUrl === 'string' ? product.imageUrl : null;

  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return null;
  if (!name || name.length > 120 || !category || category.length > 80) return null;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return { id, name, description, category, price, currency, imageUrl };
}

async function fetchCatalog() {
  const products = new Map();
  let skipped = 0;
  let page = 1;
  let totalPages = 1;

  do {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/products`, {
      params: { page, pageSize: CATALOG_PAGE_SIZE },
      timeout: REQUEST_TIMEOUT_MS
    });
    const body = response.data;
    if (!body || !Array.isArray(body.data) || !body.meta || !Number.isInteger(body.meta.totalPages)) {
      throw new Error('Product Service returned an invalid catalog page');
    }
    for (const raw of body.data) {
      const product = normalizeCatalogProduct(raw);
      if (product) products.set(product.id, product);
      else skipped += 1;
    }
    totalPages = body.meta.totalPages;
    page += 1;
  } while (page <= totalPages && page <= CATALOG_MAX_PAGES);

  if (skipped) console.warn(`Search sync skipped ${skipped} invalid catalog entries`);
  return [...products.values()].sort((left, right) => left.id - right.id);
}

async function applyCatalog(products) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Several replicas may run; only one applies a snapshot at a time, the others skip.
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [SYNC_LOCK_ID]);
    if (!lock.rows[0].locked) {
      await client.query('ROLLBACK');
      return { skipped: true, changed: 0, removed: 0 };
    }

    const ids = products.map(product => product.id);
    const upserted = await client.query(
      `INSERT INTO search.products
         (product_id, name, description, category, price, currency, image_url, synced_at)
       SELECT u.product_id, u.name, u.description, u.category, u.price, u.currency, u.image_url, NOW()
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[])
         AS u(product_id, name, description, category, price, currency, image_url)
       ON CONFLICT (product_id) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             category = EXCLUDED.category,
             price = EXCLUDED.price,
             currency = EXCLUDED.currency,
             image_url = EXCLUDED.image_url,
             synced_at = NOW()
         WHERE (search.products.name, search.products.description, search.products.category,
                search.products.price, search.products.currency, search.products.image_url)
           IS DISTINCT FROM
               (EXCLUDED.name, EXCLUDED.description, EXCLUDED.category,
                EXCLUDED.price, EXCLUDED.currency, EXCLUDED.image_url)`,
      [
        ids,
        products.map(product => product.name),
        products.map(product => product.description),
        products.map(product => product.category),
        products.map(product => product.price),
        products.map(product => product.currency),
        products.map(product => product.imageUrl)
      ]
    );
    // Products that are no longer in the active catalog were deactivated.
    const removed = await client.query(
      'DELETE FROM search.products WHERE NOT (product_id = ANY($1::int[]))',
      [ids]
    );
    await client.query(
      'UPDATE search.sync_state SET last_success_at = NOW(), product_count = $1 WHERE id = 1',
      [products.length]
    );
    await client.query('COMMIT');
    return { skipped: false, changed: upserted.rowCount, removed: removed.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncIndex() {
  if (syncStatus.running) return;
  syncStatus.running = true;
  syncStatus.lastAttemptAt = new Date().toISOString();
  const firstSuccess = syncStatus.lastSuccessAt === null;
  try {
    const products = await fetchCatalog();
    const result = await applyCatalog(products);
    syncStatus.lastSuccessAt = new Date().toISOString();
    syncStatus.lastError = null;
    syncStatus.indexedProducts = products.length;
    syncRuns.inc({ result: result.skipped ? 'skipped' : 'success' });
    indexedProducts.set(products.length);
    lastSyncSuccess.set(Date.now() / 1000);
    // Stay quiet when nothing changed so the logs are not flooded every interval.
    if (firstSuccess || result.changed || result.removed) {
      console.log(`Search index synced: ${products.length} active products, `
        + `${result.changed} added/updated, ${result.removed} removed`);
    }
  } catch (error) {
    syncStatus.lastError = error.message;
    syncRuns.inc({ result: 'failure' });
    console.error('Search index sync failed; serving the last indexed data:', error.message);
  } finally {
    syncStatus.running = false;
  }
}

app.get('/health', (req, res) => {
  // Search keeps answering from its last snapshot when Product Service is down,
  // so a failed sync is reported here but does not make the service unhealthy.
  res.json({
    status: 'OK',
    service: 'search-service',
    timestamp: new Date().toISOString(),
    index: {
      syncIntervalSeconds: SYNC_INTERVAL_SECONDS,
      indexedProducts: syncStatus.indexedProducts,
      lastSuccessAt: syncStatus.lastSuccessAt,
      lastAttemptAt: syncStatus.lastAttemptAt,
      lastError: syncStatus.lastError
    }
  });
});

app.use((req, res) => errorResponse(res, 404, 'NOT_FOUND', 'Route not found'));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return errorResponse(res, error.status, error.code, error.message, error.details);
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request body is invalid or too large');
  }
  if (error.code && (error.code.startsWith('08') || error.code === 'ECONNREFUSED' || error.code === '57P03')) {
    return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Search database is unavailable');
  }
  console.error('Search service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

function start() {
  const server = app.listen(PORT, () => {
    console.log(`Search service running on port ${PORT}`);
    console.log(`Product service URL: ${PRODUCT_SERVICE_URL}; sync every ${SYNC_INTERVAL_SECONDS}s`);
    syncIndex();
  });
  const syncTimer = setInterval(syncIndex, SYNC_INTERVAL_SECONDS * 1000);

  function close() {
    clearInterval(syncTimer);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  return server;
}

// Start only when run directly (node server.js); tests import the app without listening.
if (require.main === module) start();

module.exports = { app, pool, metrics, buildPrefixQuery, normalizeCatalogProduct, parsePriceFilter };
