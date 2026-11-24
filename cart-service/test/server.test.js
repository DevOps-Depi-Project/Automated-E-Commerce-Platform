const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.JWT_SECRET = helpers.TEST_JWT_SECRET;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const service = require('../server');

const tokenFor = (role, subject = randomUUID()) =>
  jwt.sign({ role }, helpers.TEST_JWT_SECRET, { subject, expiresIn: 60 });
const customerHeaders = { Authorization: `Bearer ${tokenFor('customer')}` };

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'cart-service');
});

test('the cart requires a customer token', async () => {
  const anonymous = await api.request('/');
  assert.equal(anonymous.status, 401);

  const admin = await api.request('/', { headers: { Authorization: `Bearer ${tokenFor('admin')}` } });
  assert.equal(admin.status, 403);

  const badSubject = await api.request('/', { headers: { Authorization: `Bearer ${tokenFor('customer', 'not-a-uuid')}` } });
  assert.equal(badSubject.status, 401);
});

test('the user ID always comes from the token', async () => {
  const response = await api.request(`/?userId=${randomUUID()}`, { headers: customerHeaders });
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
});

test('POST /items validates product ID and quantity', async () => {
  const response = await api.request('/items', {
    method: 'POST',
    headers: customerHeaders,
    body: { productId: 'abc', quantity: 0 }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(helpers.detailFields(response).sort(), ['productId', 'quantity']);
});

test('parseQuantity accepts only positive 32-bit integers', () => {
  assert.equal(service.parseQuantity(3), 3);
  assert.equal(service.parseQuantity(0), null);
  assert.equal(service.parseQuantity(1.5), null);
  assert.equal(service.parseQuantity('2'), null);
  assert.equal(service.parseQuantity(2147483648), null);
});

test('GET /metrics is available', async () => {
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /service="cart-service"/);
});
