const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const PRODUCT_SERVICE_URL = (process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001').replace(/\/$/, '');
const INVENTORY_SERVICE_URL = (process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004').replace(/\/$/, '');
const PAYMENT_SERVICE_URL = (process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3005/internal/payments').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 5000;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED'];

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}
if (!INTERNAL_SERVICE_TOKEN || Buffer.byteLength(INTERNAL_SERVICE_TOKEN, 'utf8') < 32) {
  throw new Error('INTERNAL_SERVICE_TOKEN must contain at least 32 bytes');
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

function authenticate(req, res, next) {
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

    req.user = { id: claims.sub, role: claims.role };
    next();
  });
}

function requireInternalServiceToken() {
  const expectedAuthorization = `Bearer ${INTERNAL_SERVICE_TOKEN}`;
  const expected = Buffer.from(expectedAuthorization);

  return {
    Authorization: expectedAuthorization,
    valid(value) {
      const candidate = Buffer.from(value || '');
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    }
  };
}

const internalAuth = requireInternalServiceToken();

function authenticateInternal(req, res, next) {
  if (!internalAuth.valid(req.get('authorization'))) {
    return errorResponse(res, 403, 'FORBIDDEN', 'Internal service authorization is required');
  }
  next();
}

function parseInputInteger(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? number : null;
}

function validateCheckout(body, idempotencyKey) {
  const details = [];
  const items = Array.isArray(body.items) ? body.items : [];
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  const simulatePayment = body.simulatePayment === undefined ? null : body.simulatePayment;

  if (!key || key.length > 200) {
    details.push({ field: 'Idempotency-Key', message: 'A key of at most 200 characters is required' });
  }
  if (!items.length) {
    details.push({ field: 'items', message: 'Must contain at least one product line' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'userId')) {
    details.push({ field: 'userId', message: 'User identity is taken from the JWT' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'price') || Object.prototype.hasOwnProperty.call(body, 'total')) {
    details.push({ field: 'price', message: 'Prices and totals are calculated by Order Service' });
  }
  if (simulatePayment !== null && !['success', 'failure'].includes(simulatePayment)) {
    details.push({ field: 'simulatePayment', message: 'Must be success or failure when supplied' });
  }

  const normalizedItems = [];
  const seenProductIds = new Set();
  items.forEach((item, index) => {
    const productId = parseInputInteger(item && item.productId);
    const quantity = parseInputInteger(item && item.quantity);
    if (productId === null) {
      details.push({ field: `items[${index}].productId`, message: 'Must be a positive integer' });
    }
    if (quantity === null) {
      details.push({ field: `items[${index}].quantity`, message: 'Must be a positive integer' });
    }
    if (item && ['price', 'unitPrice', 'total', 'stock'].some(field =>
      Object.prototype.hasOwnProperty.call(item, field))) {
      details.push({ field: `items[${index}]`, message: 'Do not submit prices, totals, or stock' });
    }
    if (productId !== null && seenProductIds.has(productId)) {
      details.push({ field: `items[${index}].productId`, message: 'Duplicate product IDs are not allowed' });
    }
    if (productId !== null) seenProductIds.add(productId);
    if (productId !== null && quantity !== null) normalizedItems.push({ productId, quantity });
  });

  normalizedItems.sort((left, right) => left.productId - right.productId);
  const canonicalRequest = JSON.stringify({ items: normalizedItems, simulatePayment });
  const requestHash = createHash('sha256').update(canonicalRequest).digest('hex');
  return { items: normalizedItems, idempotencyKey: key, requestHash, simulatePayment, details };
}

function priceToMinorUnits(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return null;
  const minorUnits = Math.round(price * 100);
  if (Math.abs(price * 100 - minorUnits) > 0.000001) return null;
  return minorUnits;
}

async function fetchProduct(productId) {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`, {
      timeout: REQUEST_TIMEOUT_MS
    });
    const product = response.data;
    if (!product || product.id !== productId || product.active !== true) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} was not found or is inactive`);
    }
    const unitPriceMinor = priceToMinorUnits(product.price);
    const currency = typeof product.currency === 'string' ? product.currency.trim().toUpperCase() : '';
    if (unitPriceMinor === null || !/^[A-Z]{3}$/.test(currency)
      || typeof product.name !== 'string' || !product.name.trim()) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Product Service returned invalid product data');
    }
    return {
      productId,
      productName: product.name,
      unitPriceMinor,
      currency
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.response && error.response.status === 404) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} was not found or is inactive`);
    }
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Product Service is unavailable');
  }
}

async function buildOrderItems(requestItems) {
  const products = await Promise.all(requestItems.map(item => fetchProduct(item.productId)));
  const currency = products[0].currency;
  if (products.some(product => product.currency !== currency)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'All products in an order must use the same currency', [
      { field: 'items', message: 'Mixed currencies are not supported' }
    ]);
  }

  const items = products.map((product, index) => {
    const quantity = requestItems[index].quantity;
    const lineTotalMinor = product.unitPriceMinor * quantity;
    if (!Number.isSafeInteger(lineTotalMinor)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Order total is too large');
    }
    return { ...product, quantity, lineTotalMinor };
  });
  const totalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Order total must be greater than zero');
  }
  return { items, currency, totalMinor };
}

async function createOrLoadOrder(userId, request, productData) {
  return inTransaction(async client => {
    const inserted = await client.query(
      `INSERT INTO orders.orders
         (id, user_id, status, total, currency, idempotency_key, request_hash)
       VALUES ($1, $2, 'PENDING', $3, $4, $5, $6)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [randomUUID(), userId, (productData.totalMinor / 100).toFixed(2), productData.currency,
        request.idempotencyKey, request.requestHash]
    );

    if (!inserted.rows.length) {
      const existing = await client.query(
        'SELECT * FROM orders.orders WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE',
        [userId, request.idempotencyKey]
      );
      if (!existing.rows.length) {
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Could not load the existing order');
      }
      if (existing.rows[0].request_hash.trim() !== request.requestHash) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request');
      }
      return { order: existing.rows[0], created: false };
    }

    const order = inserted.rows[0];
    for (const item of productData.items) {
      await client.query(
        `INSERT INTO orders.order_items
           (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.productId, item.productName, (item.unitPriceMinor / 100).toFixed(2),
          item.quantity, (item.lineTotalMinor / 100).toFixed(2)]
      );
    }
    return { order, created: true };
  });
}

async function loadOrder(orderId) {
  const orderResult = await pool.query('SELECT * FROM orders.orders WHERE id = $1', [orderId]);
  if (!orderResult.rows.length) return null;
  const order = orderResult.rows[0];
  const itemResult = await pool.query(
    `SELECT product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total
     FROM orders.order_items WHERE order_id = $1 ORDER BY id`,
    [orderId]
  );
  return {
    id: order.id,
    userId: order.user_id,
    status: order.status,
    total: Number(order.total),
    currency: order.currency.trim(),
    items: itemResult.rows.map(item => ({
      productId: item.product_id,
      productName: item.product_name_snapshot,
      unitPrice: Number(item.unit_price_snapshot),
      quantity: item.quantity,
      lineTotal: Number(item.line_total)
    })),
    createdAt: order.created_at,
    reservationId: order.reservation_id,
    paymentId: order.payment_id,
    paymentStatus: order.payment_status,
    failureReason: order.failure_reason
  };
}

async function updateOrder(orderId, fields) {
  const allowed = ['status', 'reservation_id', 'payment_id', 'payment_status', 'failure_reason'];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
  const values = entries.map(([, value]) => value);
  await pool.query(
    `UPDATE orders.orders SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [orderId, ...values]
  );
}

function inventoryHeaders(orderId) {
  return {
    Authorization: internalAuth.Authorization,
    'Idempotency-Key': `reserve-${orderId}`
  };
}

async function reserveInventory(order) {
  try {
    const response = await axios.post(
      `${INVENTORY_SERVICE_URL}/internal/reservations`,
      {
        orderId: order.id,
        items: order.items.map(item => ({ productId: item.productId, quantity: item.quantity }))
      },
      { headers: inventoryHeaders(order.id), timeout: REQUEST_TIMEOUT_MS }
    );
    const reservation = response.data && response.data.data;
    if (!reservation || !reservation.reservationId || !reservation.status) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory Service returned an invalid reservation response');
    }
    return reservation;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const responseError = error.response && error.response.data && error.response.data.error;
    if (responseError && responseError.code === 'INSUFFICIENT_STOCK') {
      throw new ApiError(409, 'INSUFFICIENT_STOCK', responseError.message || 'Insufficient stock');
    }
    if (responseError && responseError.code === 'RESERVATION_EXPIRED') {
      throw new ApiError(409, 'RESERVATION_EXPIRED', responseError.message || 'Reservation has expired');
    }
    if (responseError && responseError.code === 'RESERVATION_CONFLICT') {
      throw new ApiError(409, 'ORDER_STATE_CONFLICT', responseError.message || 'Existing reservation does not match this order');
    }
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory Service is unavailable');
  }
}

async function commitReservation(order, reservationId) {
  try {
    const response = await axios.post(
      `${INVENTORY_SERVICE_URL}/internal/reservations/${reservationId}/commit`,
      {},
      { headers: { Authorization: internalAuth.Authorization }, timeout: REQUEST_TIMEOUT_MS }
    );
    return response.data && response.data.data;
  } catch (error) {
    const responseError = error.response && error.response.data && error.response.data.error;
    if (responseError && responseError.code === 'RESERVATION_EXPIRED') {
      throw new ApiError(409, 'RESERVATION_EXPIRED', 'Inventory reservation expired before commit');
    }
    if (responseError && responseError.code === 'RESERVATION_FINALIZED') {
      throw new ApiError(409, 'ORDER_STATE_CONFLICT', 'Inventory reservation is already finalized');
    }
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory commit could not be completed');
  }
}

async function releaseReservation(reservationId) {
  try {
    const response = await axios.post(
      `${INVENTORY_SERVICE_URL}/internal/reservations/${reservationId}/release`,
      {},
      { headers: { Authorization: internalAuth.Authorization }, timeout: REQUEST_TIMEOUT_MS }
    );
    return response.data && response.data.data;
  } catch (error) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory release could not be completed');
  }
}

function paymentHeaders(order) {
  return {
    Authorization: internalAuth.Authorization,
    'Idempotency-Key': `payment-${order.id}`
  };
}

async function startPayment(order, simulatePayment) {
  const body = {
    orderId: order.id,
    amount: order.total,
    currency: order.currency
  };
  if (simulatePayment) body.simulate = simulatePayment;

  try {
    const response = await axios.post(PAYMENT_SERVICE_URL, body, {
      headers: paymentHeaders(order),
      timeout: REQUEST_TIMEOUT_MS
    });
    return response.data && response.data.data;
  } catch (error) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment Service is unavailable');
  }
}

async function readPayment(order) {
  try {
    const response = await axios.get(`${PAYMENT_SERVICE_URL}/${encodeURIComponent(order.payment_id)}`, {
      headers: paymentHeaders(order),
      timeout: REQUEST_TIMEOUT_MS
    });
    return response.data && response.data.data;
  } catch (error) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment status is currently unavailable');
  }
}

function validatePaymentResult(result, order) {
  if (!result || typeof result.paymentId !== 'string' || !result.paymentId
    || !['PENDING', 'SUCCEEDED', 'FAILED'].includes(result.status)
    || (result.orderId && result.orderId !== order.id)) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment Service returned an invalid payment result');
  }
  return result;
}

async function processPendingOrder(orderId, simulatePayment) {
  let order = await loadOrder(orderId);
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.status !== 'PENDING') return order;

  let reservation;
  try {
    reservation = await reserveInventory(order);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_STOCK') {
      await updateOrder(order.id, { status: 'FAILED', failure_reason: 'INSUFFICIENT_STOCK' });
      throw error;
    }
    if (error.code === 'RESERVATION_EXPIRED') {
      if (order.paymentStatus === 'FAILED') {
        await updateOrder(order.id, { status: 'CANCELLED', failure_reason: 'PAYMENT_FAILED' });
        return loadOrder(order.id);
      }
      const reason = order.paymentStatus === 'SUCCEEDED'
        ? 'RESERVATION_EXPIRED_AFTER_PAYMENT'
        : 'RESERVATION_EXPIRED';
      await updateOrder(order.id, { status: 'FAILED', failure_reason: reason });
      throw new ApiError(409, 'ORDER_STATE_CONFLICT', 'The order reservation has expired');
    }
    throw error;
  }

  if (reservation.orderId && reservation.orderId !== order.id) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory Service returned a reservation for a different order');
  }
  await updateOrder(order.id, { reservation_id: reservation.reservationId });
  order = await loadOrder(order.id);

  if (['EXPIRED', 'RELEASED'].includes(reservation.status) && order.paymentStatus === 'FAILED') {
    await updateOrder(order.id, { status: 'CANCELLED', failure_reason: 'PAYMENT_FAILED' });
    return loadOrder(order.id);
  }
  if (reservation.status === 'EXPIRED') {
    await updateOrder(order.id, { status: 'FAILED', failure_reason: 'RESERVATION_EXPIRED' });
    throw new ApiError(409, 'ORDER_STATE_CONFLICT', 'The order reservation has expired');
  }
  if (reservation.status === 'RELEASED') {
    await updateOrder(order.id, { status: 'FAILED', failure_reason: 'RESERVATION_RELEASED' });
    throw new ApiError(409, 'ORDER_STATE_CONFLICT', 'The order reservation has been released');
  }

  if (order.paymentStatus === 'FAILED') {
    const released = await releaseReservation(reservation.reservationId);
    if (released && !['RELEASED', 'EXPIRED'].includes(released.status)) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory release is not yet complete');
    }
    await updateOrder(order.id, { status: 'CANCELLED', failure_reason: 'PAYMENT_FAILED' });
    return loadOrder(order.id);
  }

  let payment;
  if (order.paymentStatus === 'SUCCEEDED') {
    payment = { paymentId: order.paymentId, status: 'SUCCEEDED' };
  } else if (order.paymentId) {
    payment = validatePaymentResult(await readPayment({ ...order, payment_id: order.paymentId }), order);
  } else {
    payment = validatePaymentResult(await startPayment(order, simulatePayment), order);
  }

  if (payment.paymentId && payment.paymentId !== order.paymentId) {
    await updateOrder(order.id, { payment_id: payment.paymentId });
  }
  if (payment.status !== order.paymentStatus) {
    await updateOrder(order.id, { payment_status: payment.status });
  }
  order = await loadOrder(order.id);

  if (payment.status === 'PENDING') return order;
  if (payment.status === 'FAILED') {
    const released = await releaseReservation(reservation.reservationId);
    if (released && !['RELEASED', 'EXPIRED'].includes(released.status)) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory release is not yet complete');
    }
    await updateOrder(order.id, { status: 'CANCELLED', failure_reason: 'PAYMENT_FAILED' });
    return loadOrder(order.id);
  }

  if (payment.status !== 'SUCCEEDED') {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment status is not recognized');
  }

  try {
    const committed = await commitReservation(order, reservation.reservationId);
    if (!committed || !['COMMITTED'].includes(committed.status)) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Inventory commit did not confirm the reservation');
    }
  } catch (error) {
    if (error.code === 'RESERVATION_EXPIRED') {
      await updateOrder(order.id, { status: 'FAILED', failure_reason: 'RESERVATION_EXPIRED_AFTER_PAYMENT' });
      throw new ApiError(409, 'ORDER_STATE_CONFLICT', 'Payment succeeded after the inventory reservation expired');
    }
    throw error;
  }

  await updateOrder(order.id, { status: 'CONFIRMED', failure_reason: null });
  return loadOrder(order.id);
}

function toOrderData(order) {
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    currency: order.currency,
    items: order.items,
    createdAt: order.createdAt
  };
}

function getStoredFailure(order) {
  if (order.failureReason === 'INSUFFICIENT_STOCK') {
    return new ApiError(409, 'INSUFFICIENT_STOCK', 'One or more products do not have enough available stock');
  }
  if (order.failureReason === 'RESERVATION_EXPIRED' || order.failureReason === 'RESERVATION_EXPIRED_AFTER_PAYMENT') {
    return new ApiError(409, 'ORDER_STATE_CONFLICT', 'The inventory reservation expired');
  }
  if (order.failureReason === 'RESERVATION_RELEASED') {
    return new ApiError(409, 'ORDER_STATE_CONFLICT', 'The inventory reservation was released');
  }
  return null;
}

app.get('/', (req, res) => {
  res.json({
    service: 'Order Service',
    version: '2.0.0',
    endpoints: {
      'POST /orders/checkout': 'Create or resume an idempotent checkout',
      'GET /orders': 'Get the authenticated user order history',
      'GET /orders/:orderId': 'Get an order owned by the authenticated user',
      'GET /health': 'Health check'
    }
  });
});

app.post('/orders/checkout', authenticate, async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const request = validateCheckout(body, req.get('Idempotency-Key'));
  if (request.details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', request.details);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.user.id)) {
    return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token user ID is invalid');
  }

  try {
    const existingResult = await pool.query(
      'SELECT * FROM orders.orders WHERE user_id = $1 AND idempotency_key = $2',
      [req.user.id, request.idempotencyKey]
    );
    let order;
    let created = false;

    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      if (existing.request_hash.trim() !== request.requestHash) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request');
      }
      order = await loadOrder(existing.id);
      const storedFailure = getStoredFailure(order);
      if (storedFailure) throw storedFailure;
      if (order.status !== 'PENDING') {
        return res.status(200).json({ data: toOrderData(order) });
      }
    } else {
      const productData = await buildOrderItems(request.items);
      const inserted = await createOrLoadOrder(req.user.id, request, productData);
      order = await loadOrder(inserted.order.id);
      created = inserted.created;

      if (!created) {
        const storedFailure = getStoredFailure(order);
        if (storedFailure) throw storedFailure;
        if (order.status !== 'PENDING') {
          return res.status(200).json({ data: toOrderData(order) });
        }
      }
    }

    order = await processPendingOrder(order.id, request.simulatePayment);
    if (order.status === 'PENDING') {
      return res.status(202).json({ data: toOrderData(order) });
    }
    if (order.status === 'FAILED') {
      const storedFailure = getStoredFailure(order);
      if (storedFailure) throw storedFailure;
      return errorResponse(res, 409, 'ORDER_STATE_CONFLICT', 'Order could not be completed');
    }
    return res.status(created ? 201 : 200).json({ data: toOrderData(order) });
  } catch (error) {
    return next(error);
  }
});

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : null;
}

app.get('/orders', authenticate, async (req, res, next) => {
  const page = parsePositiveInteger(req.query.page, 1);
  const pageSize = parsePositiveInteger(req.query.pageSize, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
  if (page === null || pageSize === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid pagination parameters');
  }
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
  if (status && !ORDER_STATUSES.includes(status)) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Unknown order status');
  }

  try {
    const filters = [];
    const values = [];
    if (req.user.role !== 'admin') {
      values.push(req.user.id);
      filters.push(`user_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM orders.orders ${where}`,
      values
    );
    const totalItems = count.rows[0].total;
    const result = await pool.query(
      `SELECT id, user_id, status, total, currency, created_at
       FROM orders.orders ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize]
    );
    const data = await Promise.all(result.rows.map(async row => {
      const order = await loadOrder(row.id);
      return toOrderData(order);
    }));
    return res.json({
      data,
      meta: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/orders/:orderId', authenticate, async (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.orderId)) {
    return errorResponse(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
  }

  try {
    const order = await loadOrder(req.params.orderId);
    if (!order || (req.user.role !== 'admin' && order.userId !== req.user.id)) {
      return errorResponse(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    return res.json({ data: toOrderData(order) });
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'order-service', timestamp: new Date().toISOString() });
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
  if (error.code && error.code.startsWith('08')) {
    return errorResponse(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Order database is unavailable');
  }

  console.error('Order service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Order service running on port ${PORT}`);
  console.log(`Product service URL: ${PRODUCT_SERVICE_URL}`);
  console.log(`Inventory service URL: ${INVENTORY_SERVICE_URL}`);
  console.log(`Payment service URL: ${PAYMENT_SERVICE_URL}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
