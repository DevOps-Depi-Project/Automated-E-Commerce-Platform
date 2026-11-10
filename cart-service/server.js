const { randomUUID } = require('crypto');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3006;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const PRODUCT_SERVICE_URL = (process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 5000;
const MAX_QUANTITY = 2147483647;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.disable('x-powered-by');
app.use(cors());
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

function authenticateCustomer(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return errorResponse(res, 401, 'TOKEN_REQUIRED', 'A valid Bearer token is required');
  }

  jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] }, (error, claims) => {
    if (error) {
      const code = error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      return errorResponse(res, 401, code, 'The access token is invalid or expired');
    }
    if (!claims || typeof claims.sub !== 'string' || typeof claims.role !== 'string'
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) {
      return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token is invalid or expired');
    }
    if (claims.role !== 'customer') {
      return errorResponse(res, 403, 'FORBIDDEN', 'Customer role is required');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) {
      return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token user ID is invalid');
    }

    req.user = { id: claims.sub };
    next();
  });
}

function rejectUserIdOverride(req, res, next) {
  if (Object.prototype.hasOwnProperty.call(req.query, 'userId')
    || (req.body && Object.prototype.hasOwnProperty.call(req.body, 'userId'))) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'User identity is taken from the JWT');
  }
  next();
}

function parseProductId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_QUANTITY ? id : null;
}

function parseQuantity(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QUANTITY) return null;
  return value;
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getOrCreateCart(client, userId) {
  const inserted = await client.query(
    `INSERT INTO carts.carts (id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id, user_id, updated_at`,
    [randomUUID(), userId]
  );
  if (inserted.rows.length) return inserted.rows[0];

  const existing = await client.query(
    'SELECT id, user_id, updated_at FROM carts.carts WHERE user_id = $1',
    [userId]
  );
  return existing.rows[0];
}

async function fetchProduct(productId) {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`, {
      timeout: REQUEST_TIMEOUT_MS
    });
    const product = response.data;
    if (!product || product.id !== productId || product.active !== true) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product was not found or is inactive');
    }
    if (typeof product.name !== 'string' || !product.name.trim()
      || typeof product.price !== 'number' || !Number.isFinite(product.price)
      || typeof product.currency !== 'string') {
      throw new ApiError(503, 'PRODUCT_SERVICE_UNAVAILABLE', 'Product Service returned invalid product data');
    }
    return product;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.response && error.response.status === 404) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product was not found or is inactive');
    }
    throw new ApiError(503, 'PRODUCT_SERVICE_UNAVAILABLE', 'Product Service is unavailable');
  }
}

async function mapCart(cart) {
  const result = await pool.query(
    `SELECT product_id, quantity
     FROM carts.cart_items WHERE cart_id = $1 ORDER BY product_id`,
    [cart.id]
  );
  const items = await Promise.all(result.rows.map(async row => {
    try {
      const product = await fetchProduct(row.product_id);
      return {
        productId: row.product_id,
        name: product.name,
        quantity: row.quantity,
        currentPrice: product.price,
        currency: product.currency
      };
    } catch (error) {
      if (error.code === 'PRODUCT_NOT_FOUND') {
        return {
          productId: row.product_id,
          name: null,
          quantity: row.quantity,
          currentPrice: null,
          currency: null
        };
      }
      throw error;
    }
  }));
  return { items, updatedAt: cart.updated_at };
}

app.get('/', authenticateCustomer, rejectUserIdOverride, async (req, res, next) => {
  try {
    const cart = await inTransaction(client => getOrCreateCart(client, req.user.id));
    return res.json({ data: await mapCart(cart) });
  } catch (error) {
    return next(error);
  }
});

app.post('/items', authenticateCustomer, rejectUserIdOverride, async (req, res, next) => {
  const productId = parseProductId(req.body && req.body.productId);
  const quantity = parseQuantity(req.body && req.body.quantity);
  const details = [];
  if (productId === null) details.push({ field: 'productId', message: 'Must be a positive integer' });
  if (quantity === null) details.push({ field: 'quantity', message: 'Must be a positive integer' });
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    const product = await fetchProduct(productId);
    const result = await inTransaction(async client => {
      const cart = await getOrCreateCart(client, req.user.id);
      const item = await client.query(
        `INSERT INTO carts.cart_items (cart_id, product_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (cart_id, product_id) DO UPDATE
         SET quantity = carts.cart_items.quantity + EXCLUDED.quantity
         WHERE carts.cart_items.quantity <= $4 - EXCLUDED.quantity
         RETURNING product_id, quantity`,
        [cart.id, productId, quantity, MAX_QUANTITY]
      );
      if (!item.rows.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Combined item quantity is too large');
      }
      const updatedCart = await client.query(
        'UPDATE carts.carts SET updated_at = NOW() WHERE id = $1 RETURNING id, user_id, updated_at',
        [cart.id]
      );
      return { item: item.rows[0], cart: updatedCart.rows[0] };
    });
    const status = result.item.quantity === quantity ? 201 : 200;
    return res.status(status).json({
      data: {
        productId,
        name: product.name,
        quantity: result.item.quantity,
        currentPrice: product.price,
        currency: product.currency
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.put('/items/:productId', authenticateCustomer, rejectUserIdOverride, async (req, res, next) => {
  const productId = parseProductId(req.params.productId);
  const quantity = parseQuantity(req.body && req.body.quantity);
  const details = [];
  if (productId === null) details.push({ field: 'productId', message: 'Must be a positive integer' });
  if (quantity === null) details.push({ field: 'quantity', message: 'Must be a positive integer' });
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    const updated = await inTransaction(async client => {
      const cart = await client.query('SELECT id FROM carts.carts WHERE user_id = $1', [req.user.id]);
      if (!cart.rows.length) return null;
      const item = await client.query(
        `UPDATE carts.cart_items SET quantity = $1
         WHERE cart_id = $2 AND product_id = $3
         RETURNING product_id, quantity`,
        [quantity, cart.rows[0].id, productId]
      );
      if (!item.rows.length) return null;
      const cartResult = await client.query(
        'UPDATE carts.carts SET updated_at = NOW() WHERE id = $1 RETURNING updated_at',
        [cart.rows[0].id]
      );
      return { item: item.rows[0], updatedAt: cartResult.rows[0].updated_at };
    });
    if (!updated) return errorResponse(res, 404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');

    let product;
    try {
      product = await fetchProduct(productId);
    } catch (error) {
      if (error.code !== 'PRODUCT_NOT_FOUND') throw error;
    }
    return res.json({
      data: {
        productId,
        name: product ? product.name : null,
        quantity: updated.item.quantity,
        currentPrice: product ? product.price : null,
        currency: product ? product.currency : null,
        updatedAt: updated.updatedAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.delete('/items/:productId', authenticateCustomer, rejectUserIdOverride, async (req, res, next) => {
  const productId = parseProductId(req.params.productId);
  if (productId === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer');
  }

  try {
    const removed = await inTransaction(async client => {
      const cart = await client.query('SELECT id FROM carts.carts WHERE user_id = $1', [req.user.id]);
      if (!cart.rows.length) return false;
      const item = await client.query(
        'DELETE FROM carts.cart_items WHERE cart_id = $1 AND product_id = $2 RETURNING id',
        [cart.rows[0].id, productId]
      );
      if (!item.rowCount) return false;
      await client.query('UPDATE carts.carts SET updated_at = NOW() WHERE id = $1', [cart.rows[0].id]);
      return true;
    });
    if (!removed) return errorResponse(res, 404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.delete('/', authenticateCustomer, rejectUserIdOverride, async (req, res, next) => {
  try {
    await inTransaction(async client => {
      const cart = await client.query('SELECT id FROM carts.carts WHERE user_id = $1', [req.user.id]);
      if (!cart.rows.length) return;
      await client.query('DELETE FROM carts.cart_items WHERE cart_id = $1', [cart.rows[0].id]);
      await client.query('UPDATE carts.carts SET updated_at = NOW() WHERE id = $1', [cart.rows[0].id]);
    });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'cart-service', timestamp: new Date().toISOString() });
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
  if (error.code && (error.code.startsWith('08') || error.code === '57P01')) {
    return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Cart database is unavailable');
  }
  console.error('Cart service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Cart service running on port ${PORT}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
