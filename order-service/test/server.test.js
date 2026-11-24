const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.JWT_SECRET = helpers.TEST_JWT_SECRET;
process.env.INTERNAL_SERVICE_TOKEN = helpers.TEST_INTERNAL_TOKEN;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const service = require('../server');

const customerHeaders = {
  Authorization: `Bearer ${jwt.sign({ role: 'customer' }, helpers.TEST_JWT_SECRET, { subject: randomUUID(), expiresIn: 60 })}`
};

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'order-service');
});

test('checkout requires a token', async () => {
  const response = await api.request('/orders/checkout', { method: 'POST', body: { items: [] } });
  assert.equal(response.status, 401);
});

test('checkout rejects missing idempotency key and client-supplied prices or identity', async () => {
  const response = await api.request('/orders/checkout', {
    method: 'POST',
    headers: customerHeaders,
    body: { userId: randomUUID(), total: 1, items: [{ productId: 1, quantity: 1, price: 0.01 }] }
  });
  assert.equal(response.status, 400);
  const fields = helpers.detailFields(response);
  for (const field of ['Idempotency-Key', 'userId', 'price', 'items[0]']) {
    assert.ok(fields.includes(field), `expected a ${field} error, got ${fields}`);
  }
});

test('checkout rejects an unknown simulatePayment value', async () => {
  const response = await api.request('/orders/checkout', {
    method: 'POST',
    headers: { ...customerHeaders, 'Idempotency-Key': 'k-1' },
    body: { items: [{ productId: 1, quantity: 1 }], simulatePayment: 'maybe' }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(helpers.detailFields(response), ['simulatePayment']);
});

test('the request hash ignores item order but not quantities', () => {
  const a = service.validateCheckout({ items: [{ productId: 2, quantity: 1 }, { productId: 1, quantity: 3 }] }, 'key');
  const b = service.validateCheckout({ items: [{ productId: 1, quantity: 3 }, { productId: 2, quantity: 1 }] }, 'key');
  const c = service.validateCheckout({ items: [{ productId: 1, quantity: 4 }, { productId: 2, quantity: 1 }] }, 'key');
  assert.equal(a.requestHash, b.requestHash);
  assert.notEqual(a.requestHash, c.requestHash);
});

test('priceToMinorUnits converts safely and rejects sub-cent prices', () => {
  assert.equal(service.priceToMinorUnits(19.99), 1999);
  assert.equal(service.priceToMinorUnits(0.1 + 0.2), 30);
  assert.equal(service.priceToMinorUnits('5'), 500);
  assert.equal(service.priceToMinorUnits(1.234), null);
  assert.equal(service.priceToMinorUnits(-1), null);
  assert.equal(service.priceToMinorUnits('abc'), null);
});

test('order reads validate IDs and pagination', async () => {
  const notUuid = await api.request('/orders/not-a-uuid', { headers: customerHeaders });
  assert.equal(notUuid.status, 404);

  const tooLarge = await api.request('/orders?pageSize=500', { headers: customerHeaders });
  assert.equal(tooLarge.status, 400);
});

test('GET /metrics exposes checkout outcomes', async () => {
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /orders_checkout_requests_total\{[^}]*outcome="VALIDATION_ERROR"/);
});
