const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.JWT_SECRET = helpers.TEST_JWT_SECRET;
process.env.INTERNAL_SERVICE_TOKEN = helpers.TEST_INTERNAL_TOKEN;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const service = require('../server');

const tokenFor = role => jwt.sign({ role }, helpers.TEST_JWT_SECRET, { subject: randomUUID(), expiresIn: 60 });
const internalHeaders = { Authorization: `Bearer ${helpers.TEST_INTERNAL_TOKEN}` };

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'inventory-service');
});

test('reservations require the internal service token', async () => {
  const anonymous = await api.request('/internal/reservations', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);

  const wrong = await api.request('/internal/reservations', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-token' },
    body: {}
  });
  assert.equal(wrong.status, 403);

  // A customer JWT is not the internal token either.
  const customer = await api.request('/internal/reservations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('customer')}` },
    body: {}
  });
  assert.equal(customer.status, 403);
});

test('reservations validate order ID, idempotency key and items', async () => {
  const response = await api.request('/internal/reservations', {
    method: 'POST',
    headers: internalHeaders,
    body: { orderId: '', items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] }
  });
  assert.equal(response.status, 400);
  const fields = helpers.detailFields(response);
  assert.ok(fields.includes('orderId'));
  assert.ok(fields.includes('Idempotency-Key'));
  assert.ok(fields.includes('items[1].productId')); // duplicate product
});

test('validateReservation sorts lines by product ID (consistent lock order)', () => {
  const result = service.validateReservation(
    { orderId: 'order-1', items: [{ productId: 3, quantity: 1 }, { productId: 1, quantity: 2 }] },
    'reserve-order-1'
  );
  assert.deepEqual(result.details, []);
  assert.deepEqual(result.productIds, [1, 3]);
  assert.equal(service.sameItems(result.items, [{ productId: 1, quantity: 2 }, { productId: 3, quantity: 1 }]), true);
  assert.equal(service.sameItems(result.items, [{ productId: 1, quantity: 2 }]), false);
});

test('stock adjustments require an admin and a valid action', async () => {
  const anonymous = await api.request('/inventory/1/adjustments', { method: 'POST', body: { action: 'add', quantity: 1 } });
  assert.equal(anonymous.status, 401);

  const customer = await api.request('/inventory/1/adjustments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('customer')}` },
    body: { action: 'add', quantity: 1 }
  });
  assert.equal(customer.status, 403);

  const invalid = await api.request('/inventory/1/adjustments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('admin')}` },
    body: { action: 'set', quantity: -1 }
  });
  assert.equal(invalid.status, 400);
});

test('GET /inventory/:productId rejects non-numeric IDs', async () => {
  const response = await api.request('/inventory/abc');
  assert.equal(response.status, 400);
});

test('GET /metrics is available', async () => {
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /service="inventory-service"/);
});
