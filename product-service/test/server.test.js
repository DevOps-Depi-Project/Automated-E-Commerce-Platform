const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.JWT_SECRET = helpers.TEST_JWT_SECRET;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const service = require('../server');

const tokenFor = role => jwt.sign({ role }, helpers.TEST_JWT_SECRET, { subject: randomUUID(), expiresIn: 60 });
const adminHeaders = { Authorization: `Bearer ${tokenFor('admin')}` };

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'product-service');
});

test('GET /products validates pagination and sort before touching the database', async () => {
  for (const query of ['pageSize=101', 'page=0', 'page=abc', 'sort=drop-table']) {
    const response = await api.request(`/products?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.json.error.code, 'VALIDATION_ERROR', query);
  }
});

test('GET /products returns 503 when the database is unreachable', async () => {
  const response = await api.request('/products');
  assert.equal(response.status, 503);
  assert.equal(response.json.error.code, 'DATABASE_UNAVAILABLE');
});

test('GET /products/:id rejects non-numeric IDs', async () => {
  const response = await api.request('/products/abc');
  assert.equal(response.status, 400);
});

test('catalog writes require an admin token', async () => {
  const anonymous = await api.request('/products', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);

  const customer = await api.request('/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('customer')}` },
    body: {}
  });
  assert.equal(customer.status, 403);
  assert.equal(customer.json.error.code, 'FORBIDDEN');

  const adminList = await api.request('/admin/products', { headers: { Authorization: `Bearer ${tokenFor('customer')}` } });
  assert.equal(adminList.status, 403);
});

test('POST /products validates the body and refuses stock', async () => {
  const response = await api.request('/products', {
    method: 'POST',
    headers: adminHeaders,
    body: { name: 'Mug', description: 'A mug', category: 'home', price: -1, currency: 'dollars', stock: 5 }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(helpers.detailFields(response).sort(), ['currency', 'price', 'stock']);
});

test('validateProduct trims text and normalizes currency', () => {
  const { product, details } = service.validateProduct({
    name: '  Mug ', description: ' Blue ', category: ' home ', price: 9.5, currency: 'usd'
  });
  assert.deepEqual(details, []);
  assert.deepEqual(product, { name: 'Mug', description: 'Blue', category: 'home', price: 9.5, currency: 'USD', imageUrl: null });
});

test('GET /metrics exposes route patterns, not raw URLs', async () => {
  await api.request('/products/abc');
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /route="\/products\/:id"/);
  assert.doesNotMatch(response.text, /route="\/products\/abc"/);
});
