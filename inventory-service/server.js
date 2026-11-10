const { randomUUID, timingSafeEqual } = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3004;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const RESERVATION_TTL_SECONDS = Number(process.env.RESERVATION_TTL_SECONDS) || 900;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}
if (!INTERNAL_SERVICE_TOKEN || Buffer.byteLength(INTERNAL_SERVICE_TOKEN, 'utf8') < 32) {
  throw new Error('INTERNAL_SERVICE_TOKEN must contain at least 32 bytes');
}
if (!Number.isSafeInteger(RESERVATION_TTL_SECONDS) || RESERVATION_TTL_SECONDS < 1) {
  throw new Error('RESERVATION_TTL_SECONDS must be a positive integer');
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

function requireOrderService(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return errorResponse(res, 401, 'TOKEN_REQUIRED', 'Order service Bearer token is required');
  }

  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(INTERNAL_SERVICE_TOKEN);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return errorResponse(res, 403, 'FORBIDDEN', 'Order service authorization is required');
  }

  next();
}

function authenticateAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
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
    if (claims.role !== 'admin') {
      return errorResponse(res, 403, 'FORBIDDEN', 'Admin role is required');
    }
    req.auth = { userId: claims.sub, role: claims.role };
    next();
  });
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

function parsePositiveInteger(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647
    ? number
    : null;
}

function validateReservation(body, idempotencyKey) {
  const details = [];
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const items = Array.isArray(body.items) ? body.items : [];

  if (!orderId || orderId.length > 100) {
    details.push({ field: 'orderId', message: 'Must be a nonempty string of at most 100 characters' });
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    details.push({ field: 'Idempotency-Key', message: 'A key of at most 200 characters is required' });
  }
  if (!items.length) {
    details.push({ field: 'items', message: 'Must contain at least one product line' });
  }

  const normalizedItems = [];
  const productIds = new Set();
  items.forEach((item, index) => {
    const productId = parsePositiveInteger(item && item.productId);
    const quantity = parsePositiveInteger(item && item.quantity);
    if (productId === null) {
      details.push({ field: `items[${index}].productId`, message: 'Must be a positive integer' });
    }
    if (quantity === null) {
      details.push({ field: `items[${index}].quantity`, message: 'Must be a positive integer' });
    }
    if (productId !== null && productIds.has(productId)) {
      details.push({ field: `items[${index}].productId`, message: 'Duplicate product IDs are not allowed' });
    }
    if (productId !== null) productIds.add(productId);
    if (productId !== null && quantity !== null) normalizedItems.push({ productId, quantity });
  });

  normalizedItems.sort((left, right) => left.productId - right.productId);
  return { orderId, items: normalizedItems, productIds: normalizedItems.map(item => item.productId), details };
}

async function releaseExpiredReservation(client, reservation) {
  if (reservation.status !== 'HELD') return reservation;

  const expired = await client.query(
    `UPDATE inventory.reservations
     SET status = 'EXPIRED'
     WHERE id = $1 AND status = 'HELD' AND expires_at <= NOW()
     RETURNING id`,
    [reservation.id]
  );

  if (!expired.rowCount) {
    const current = await client.query(
      'SELECT id, order_id, status, expires_at FROM inventory.reservations WHERE id = $1',
      [reservation.id]
    );
    return current.rows[0] || reservation;
  }

  const items = await client.query(
    'SELECT product_id, quantity FROM inventory.reservation_items WHERE reservation_id = $1 ORDER BY product_id',
    [reservation.id]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE inventory.inventory_items
       SET available_quantity = available_quantity + $1
       WHERE product_id = $2`,
      [item.quantity, item.product_id]
    );
  }

  return { ...reservation, status: 'EXPIRED' };
}

async function expireReservationsForProducts(client, productIds) {
  if (!productIds.length) return;

  const expired = await client.query(
    `SELECT r.id, r.order_id, r.status, r.expires_at
     FROM inventory.reservations r
     WHERE r.status = 'HELD' AND r.expires_at <= NOW()
       AND EXISTS (
         SELECT 1 FROM inventory.reservation_items ri
         WHERE ri.reservation_id = r.id AND ri.product_id = ANY($1::integer[])
       )
     ORDER BY r.id
     FOR UPDATE OF r`,
    [productIds]
  );

  for (const reservation of expired.rows) {
    await releaseExpiredReservation(client, reservation);
  }
}

async function getReservationItems(client, reservationId) {
  const result = await client.query(
    `SELECT product_id, quantity FROM inventory.reservation_items
     WHERE reservation_id = $1 ORDER BY product_id`,
    [reservationId]
  );
  return result.rows.map(row => ({ productId: row.product_id, quantity: row.quantity }));
}

async function reservationResponse(client, reservation) {
  const items = await getReservationItems(client, reservation.id);
  return {
    reservationId: reservation.id,
    orderId: reservation.order_id,
    status: reservation.status,
    items,
    expiresAt: reservation.expires_at
  };
}

function sameItems(left, right) {
  return left.length === right.length && left.every((item, index) =>
    item.productId === right[index].productId && item.quantity === right[index].quantity
  );
}

app.get(['/api/v1/inventory/:productId', '/inventory/:productId'], async (req, res, next) => {
  const productId = parsePositiveInteger(req.params.productId);
  if (productId === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer');
  }

  try {
    const result = await inTransaction(async client => {
      await expireReservationsForProducts(client, [productId]);
      return client.query(
        'SELECT product_id, available_quantity FROM inventory.inventory_items WHERE product_id = $1',
        [productId]
      );
    });
    if (!result.rows.length) {
      return errorResponse(res, 404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
    }
    return res.json({
      data: {
        productId: result.rows[0].product_id,
        availableQuantity: result.rows[0].available_quantity
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/inventory/', async (req, res, next) => {
  try {
    const result = await inTransaction(async client => {
      const ids = await client.query('SELECT product_id FROM inventory.inventory_items');
      await expireReservationsForProducts(client, ids.rows.map(row => row.product_id));
      return client.query(
        `SELECT product_id, available_quantity
         FROM inventory.inventory_items
         ORDER BY product_id ASC`
      );
    });
    return res.json({
      data: result.rows.map(row => ({
        productId: row.product_id,
        availableQuantity: row.available_quantity
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/inventory/:productId/adjustments', authenticateAdmin, async (req, res, next) => {
  const productId = parsePositiveInteger(req.params.productId);
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const quantity = parsePositiveInteger(body.quantity);
  const action = typeof body.action === 'string' ? body.action.toLowerCase() : '';

  if (productId === null || quantity === null || !['add', 'subtract'].includes(action)) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID and quantity must be positive integers and action must be add or subtract');
  }

  try {
    const result = await inTransaction(async client => {
      if (action === 'add') {
        return client.query(
          `INSERT INTO inventory.inventory_items (product_id, available_quantity)
           VALUES ($1, $2)
           ON CONFLICT (product_id) DO UPDATE
             SET available_quantity = inventory.inventory_items.available_quantity + EXCLUDED.available_quantity
           RETURNING product_id, available_quantity`,
          [productId, quantity]
        );
      }

      const updated = await client.query(
        `UPDATE inventory.inventory_items
         SET available_quantity = available_quantity - $1
         WHERE product_id = $2 AND available_quantity >= $1
         RETURNING product_id, available_quantity`,
        [quantity, productId]
      );
      if (updated.rowCount) return updated;

      const existing = await client.query(
        'SELECT product_id FROM inventory.inventory_items WHERE product_id = $1',
        [productId]
      );
      if (!existing.rowCount) {
        throw new ApiError(404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
      }
      throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Cannot subtract more than the available quantity');
    });

    return res.json({
      data: {
        productId: result.rows[0].product_id,
        availableQuantity: result.rows[0].available_quantity
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/internal/reservations', requireOrderService, async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { orderId, items, productIds, details } = validateReservation(
    body,
    req.get('Idempotency-Key')
  );
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    // Expire old holds first so a failed new reservation does not roll back expiry cleanup.
    await inTransaction(client => expireReservationsForProducts(client, productIds));

    const result = await inTransaction(async client => {
      let reservationResult = await client.query(
        `SELECT id, order_id, status, expires_at FROM inventory.reservations
         WHERE order_id = $1 FOR UPDATE`,
        [orderId]
      );

      if (reservationResult.rows.length) {
        let reservation = await releaseExpiredReservation(client, reservationResult.rows[0]);
        const existingItems = await getReservationItems(client, reservation.id);
        if (!sameItems(items, existingItems)) {
          return { conflict: new ApiError(409, 'RESERVATION_CONFLICT', 'Order already has a reservation with different items') };
        }
        if (reservation.status === 'EXPIRED') {
          return { conflict: new ApiError(409, 'RESERVATION_EXPIRED', 'Reservation has expired') };
        }
        return { replay: true, reservation: await reservationResponse(client, reservation) };
      }

      const reservationId = randomUUID();
      reservationResult = await client.query(
        `INSERT INTO inventory.reservations (id, order_id, status, expires_at)
         VALUES ($1, $2, 'HELD', NOW() + ($3 * INTERVAL '1 second'))
         ON CONFLICT (order_id) DO NOTHING
         RETURNING id, order_id, status, expires_at`,
        [reservationId, orderId, RESERVATION_TTL_SECONDS]
      );

      if (!reservationResult.rows.length) {
        const existing = await client.query(
          `SELECT id, order_id, status, expires_at FROM inventory.reservations
           WHERE order_id = $1 FOR UPDATE`,
          [orderId]
        );
        const reservation = await releaseExpiredReservation(client, existing.rows[0]);
        const existingItems = await getReservationItems(client, reservation.id);
        if (!sameItems(items, existingItems)) {
          return { conflict: new ApiError(409, 'RESERVATION_CONFLICT', 'Order already has a reservation with different items') };
        }
        if (reservation.status === 'EXPIRED') {
          return { conflict: new ApiError(409, 'RESERVATION_EXPIRED', 'Reservation has expired') };
        }
        return { replay: true, reservation: await reservationResponse(client, reservation) };
      }

      const reservation = reservationResult.rows[0];
      for (const item of items) {
        const stock = await client.query(
          `UPDATE inventory.inventory_items
           SET available_quantity = available_quantity - $1
           WHERE product_id = $2 AND available_quantity >= $1
           RETURNING product_id`,
          [item.quantity, item.productId]
        );
        if (!stock.rowCount) {
          throw new ApiError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for product ${item.productId}`);
        }
      }

      for (const item of items) {
        await client.query(
          `INSERT INTO inventory.reservation_items (reservation_id, product_id, quantity)
           VALUES ($1, $2, $3)`,
          [reservation.id, item.productId, item.quantity]
        );
      }

      return { replay: false, reservation: await reservationResponse(client, reservation) };
    });

    if (result.conflict) {
      const { status, code, message, details: errorDetails } = result.conflict;
      return errorResponse(res, status, code, message, errorDetails);
    }
    return res.status(result.replay ? 200 : 201).json({ data: result.reservation });
  } catch (error) {
    return next(error);
  }
});

async function changeReservation(req, res, next, action) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Reservation ID must be a UUID');
  }

  try {
    const result = await inTransaction(async client => {
      const found = await client.query(
        `SELECT id, order_id, status, expires_at FROM inventory.reservations
         WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      if (!found.rows.length) {
        return { error: new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found') };
      }

      const reservation = await releaseExpiredReservation(client, found.rows[0]);
      if (reservation.status === 'EXPIRED') {
        if (action === 'commit') {
          return { error: new ApiError(409, 'RESERVATION_EXPIRED', 'Reservation has expired') };
        }
        return { reservation: await reservationResponse(client, reservation) };
      }

      const terminalStatus = action === 'commit' ? 'COMMITTED' : 'RELEASED';
      if (reservation.status === terminalStatus) {
        return { reservation: await reservationResponse(client, reservation) };
      }
      if (reservation.status !== 'HELD') {
        return { error: new ApiError(409, 'RESERVATION_FINALIZED', 'Reservation is already finalized') };
      }

      const updated = action === 'commit'
        ? await client.query(
          `UPDATE inventory.reservations SET status = 'COMMITTED'
           WHERE id = $1 AND status = 'HELD' AND expires_at > NOW()
           RETURNING id, order_id, status, expires_at`,
          [reservation.id]
        )
        : await client.query(
          `UPDATE inventory.reservations SET status = 'RELEASED'
           WHERE id = $1 AND status = 'HELD'
           RETURNING id, order_id, status, expires_at`,
          [reservation.id]
        );

      if (!updated.rowCount && action === 'commit') {
        const current = await client.query(
          'SELECT id, order_id, status, expires_at FROM inventory.reservations WHERE id = $1 FOR UPDATE',
          [reservation.id]
        );
        const expired = await releaseExpiredReservation(client, current.rows[0]);
        return {
          error: new ApiError(
            409,
            expired.status === 'EXPIRED' ? 'RESERVATION_EXPIRED' : 'RESERVATION_FINALIZED',
            expired.status === 'EXPIRED' ? 'Reservation has expired' : 'Reservation is already finalized'
          )
        };
      }

      if (action === 'release') {
        const items = await getReservationItems(client, reservation.id);
        for (const item of items) {
          await client.query(
            `UPDATE inventory.inventory_items
             SET available_quantity = available_quantity + $1
             WHERE product_id = $2`,
            [item.quantity, item.productId]
          );
        }
      }

      return { reservation: await reservationResponse(client, updated.rows[0]) };
    });

    if (result.error) {
      const { status, code, message, details } = result.error;
      return errorResponse(res, status, code, message, details);
    }
    return res.json({ data: result.reservation });
  } catch (error) {
    return next(error);
  }
}

app.post('/internal/reservations/:id/commit', requireOrderService,
  (req, res, next) => changeReservation(req, res, next, 'commit'));
app.post('/internal/reservations/:id/release', requireOrderService,
  (req, res, next) => changeReservation(req, res, next, 'release'));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'inventory-service', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', 'Route not found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return errorResponse(res, error.status, error.code, error.message, error.details);
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request body is invalid or too large');
  }
  if (error.code && (error.code.startsWith('08') || error.code === 'ECONNREFUSED' || error.code === '57P03')) {
    return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Inventory database is unavailable');
  }

  console.error('Inventory service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Inventory service running on port ${PORT}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
