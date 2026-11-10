const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3005;
const DATABASE_URL = process.env.DATABASE_URL;
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const PAYMENT_SIMULATION_ENABLED = process.env.NODE_ENV !== 'production'
  && process.env.PAYMENT_SIMULATION_ENABLED === 'true';
const PAYMENT_DEFAULT_RESULT = (process.env.PAYMENT_DEFAULT_RESULT || 'success').toLowerCase();
const SUPPORTED_CURRENCIES = new Set(['USD']);

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!INTERNAL_SERVICE_TOKEN || Buffer.byteLength(INTERNAL_SERVICE_TOKEN, 'utf8') < 32) {
  throw new Error('INTERNAL_SERVICE_TOKEN must contain at least 32 bytes');
}
if (!['success', 'failure'].includes(PAYMENT_DEFAULT_RESULT)) {
  throw new Error('PAYMENT_DEFAULT_RESULT must be success or failure');
}

const pool = new Pool({ connectionString: DATABASE_URL });
const expectedAuthorization = Buffer.from(`Bearer ${INTERNAL_SERVICE_TOKEN}`);

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
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const supplied = Buffer.from(match ? `Bearer ${match[1]}` : '');
  const valid = supplied.length === expectedAuthorization.length
    && timingSafeEqual(supplied, expectedAuthorization);
  if (!valid) {
    const status = match ? 403 : 401;
    return errorResponse(res, status, status === 401 ? 'TOKEN_REQUIRED' : 'FORBIDDEN',
      'Order service authorization is required');
  }
  next();
}

function parseAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return Math.abs(value * 100 - minor) <= 0.000001 ? minor : null;
}

function validatePayment(body, idempotencyKey) {
  const details = [];
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const amountMinor = parseAmount(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  const simulate = body.simulate;

  if (!orderId || orderId.length > 100) {
    details.push({ field: 'orderId', message: 'Must be a nonempty string of at most 100 characters' });
  }
  if (amountMinor === null) {
    details.push({ field: 'amount', message: 'Must be a positive amount with at most two decimal places' });
  }
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    details.push({ field: 'currency', message: 'Only USD is supported by this demo' });
  }
  if (!key || key.length > 200) {
    details.push({ field: 'Idempotency-Key', message: 'A key of at most 200 characters is required' });
  }

  const suppliedSensitiveField = Object.keys(body)
    .find(field => /(card|cvv|cvc|expiry|expiration|iban|accountnumber)/i.test(field));
  if (suppliedSensitiveField) {
    details.push({ field: suppliedSensitiveField, message: 'Card and account data are not accepted' });
  }

  if (PAYMENT_SIMULATION_ENABLED && simulate !== undefined && !['success', 'failure'].includes(simulate)) {
    details.push({ field: 'simulate', message: 'Must be success or failure when supplied' });
  }

  const effectiveSimulation = PAYMENT_SIMULATION_ENABLED && simulate !== undefined
    ? simulate
    : PAYMENT_DEFAULT_RESULT;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ orderId, amountMinor, currency, effectiveSimulation }))
    .digest('hex');

  return {
    orderId,
    amount: amountMinor === null ? null : (amountMinor / 100).toFixed(2),
    amountMinor,
    currency,
    idempotencyKey: key,
    requestHash,
    result: effectiveSimulation === 'success' ? 'SUCCEEDED' : 'FAILED',
    details
  };
}

function mapPayment(row) {
  return {
    paymentId: row.id,
    orderId: row.order_id,
    status: row.result,
    amount: Number(row.amount),
    currency: row.currency.trim()
  };
}

async function getOrCreatePayment(paymentRequest) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let existing = await client.query(
      'SELECT * FROM payments.payment_attempts WHERE order_id = $1 FOR UPDATE',
      [paymentRequest.orderId]
    );

    if (!existing.rows.length) {
      const inserted = await client.query(
        `INSERT INTO payments.payment_attempts
           (id, order_id, idempotency_key, request_hash, result, amount, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (order_id) DO NOTHING
         RETURNING *`,
        [randomUUID(), paymentRequest.orderId, paymentRequest.idempotencyKey,
          paymentRequest.requestHash, paymentRequest.result, paymentRequest.amount,
          paymentRequest.currency]
      );

      if (inserted.rows.length) {
        await client.query('COMMIT');
        return { payment: mapPayment(inserted.rows[0]), created: true };
      }

      existing = await client.query(
        'SELECT * FROM payments.payment_attempts WHERE order_id = $1 FOR UPDATE',
        [paymentRequest.orderId]
      );
    }

    if (!existing.rows.length) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Could not load the existing payment attempt');
    }

    const row = existing.rows[0];
    if (row.idempotency_key !== paymentRequest.idempotencyKey
      || row.request_hash.trim() !== paymentRequest.requestHash) {
      throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED',
        'Order already has a payment attempt for a different request');
    }

    await client.query('COMMIT');
    return { payment: mapPayment(row), created: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

app.get('/', (req, res) => {
  res.json({ service: 'Payment Service', version: '1.0.0' });
});

app.post('/internal/payments', requireOrderService, async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const paymentRequest = validatePayment(body, req.get('Idempotency-Key'));
  if (paymentRequest.details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', paymentRequest.details);
  }

  try {
    const { payment, created } = await getOrCreatePayment(paymentRequest);
    return res.status(created ? 201 : 200).json({ data: payment });
  } catch (error) {
    return next(error);
  }
});

app.get('/internal/payments/:paymentId', requireOrderService, async (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.paymentId)) {
    return errorResponse(res, 404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found');
  }
  try {
    const result = await pool.query(
      `SELECT id, order_id, result, amount, currency
       FROM payments.payment_attempts WHERE id = $1`,
      [req.params.paymentId]
    );
    if (!result.rows.length) {
      return errorResponse(res, 404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found');
    }
    return res.json({ data: mapPayment(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'payment-service', timestamp: new Date().toISOString() });
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
    return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Payment database is unavailable');
  }
  console.error('Payment service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Payment service running on port ${PORT}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
