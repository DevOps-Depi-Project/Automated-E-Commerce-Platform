// End-to-end smoke test against a running stack, through the Nginx gateway.
//
//   docker compose up -d --wait
//   npm run test:e2e            (reads ADMIN_EMAIL / ADMIN_PASSWORD from .env)
//
// The test creates its own product and stock as the admin, buys it as a new customer,
// and deactivates the product afterwards, so it can run repeatedly against the same data.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const BASE_URL = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SEARCH_SYNC_TIMEOUT_MS = Number(process.env.E2E_SEARCH_TIMEOUT_MS || 60000);

const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const productName = `E2E Item ${runId}`;
const state = {};

async function api(path, { method = 'GET', token, headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(BASE_URL + path, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }
  return { status: response.status, json, text };
}

async function login(email, password) {
  const response = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, `login failed for ${email}: ${response.text}`);
  return response.json.data;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  assert.ok(ADMIN_EMAIL && ADMIN_PASSWORD, 'ADMIN_EMAIL and ADMIN_PASSWORD must be set (for example in .env)');
  const reachable = await fetch(BASE_URL + '/').catch(() => null);
  assert.ok(reachable && reachable.ok, `The stack is not reachable at ${BASE_URL}; run "docker compose up -d --wait" first`);
});

after(async () => {
  // Clean up even when a test failed half-way.
  if (state.adminToken && state.productId) {
    await api(`/api/product/products/${state.productId}`, { method: 'DELETE', token: state.adminToken });
  }
  if (state.customerToken) {
    await api('/api/cart/', { method: 'DELETE', token: state.customerToken });
  }
});

test('the storefront and admin pages are served', async () => {
  for (const path of ['/', '/admin']) {
    const response = await api(path);
    assert.equal(response.status, 200, path);
    assert.match(response.text, /<html/i, path);
  }
});

test('every public service is healthy through the gateway', async () => {
  for (const service of ['auth', 'product', 'cart', 'inventory', 'order', 'search']) {
    const response = await api(`/api/${service}/health`);
    assert.equal(response.status, 200, service);
    assert.equal(response.json.status, 'OK', service);
  }
});

test('internal endpoints are not exposed by the gateway', async () => {
  for (const path of ['/api/payment/health', '/api/product/metrics', '/api/search/metrics', '/api/unknown/x']) {
    const response = await api(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.json.error.code, 'NOT_FOUND', path);
  }
});

test('the admin creates a product and stocks it', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(admin.user.role, 'admin');
  state.adminToken = admin.token;

  const created = await api('/api/product/products', {
    method: 'POST',
    token: state.adminToken,
    body: { name: productName, description: 'Created by the end-to-end smoke test', category: 'e2e', price: 12.34, currency: 'USD' }
  });
  assert.equal(created.status, 201, created.text);
  state.productId = created.json.id;

  const stocked = await api(`/api/inventory/inventory/${state.productId}/adjustments`, {
    method: 'POST',
    token: state.adminToken,
    body: { action: 'add', quantity: 5 }
  });
  assert.equal(stocked.status, 200, stocked.text);
  assert.equal(stocked.json.data.availableQuantity, 5);
});

test('a new customer can register and sign in', async () => {
  const email = `e2e-${runId}@example.com`;
  const password = `Pw-${randomUUID()}`.slice(0, 40);
  const registered = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password, name: 'E2E Customer' }
  });
  assert.equal(registered.status, 201, registered.text);
  assert.equal(registered.json.data.role, 'customer');

  const duplicate = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'another-password', name: 'Someone' }
  });
  assert.equal(duplicate.status, 409, 'the same email must not register twice');

  const wrongPassword = await api('/api/auth/login', { method: 'POST', body: { email, password: 'wrong-password' } });
  assert.equal(wrongPassword.status, 401);

  const session = await login(email, password);
  assert.equal(session.user.role, 'customer');
  state.customerToken = session.token;
});

test('Search Service picks up the new product (eventual consistency)', async () => {
  const deadline = Date.now() + SEARCH_SYNC_TIMEOUT_MS;
  let found = null;
  while (Date.now() < deadline) {
    const response = await api(`/api/search/search?q=${encodeURIComponent(runId)}`);
    assert.equal(response.status, 200, response.text);
    found = response.json.data.find(product => product.id === state.productId);
    if (found) break;
    await sleep(2000);
  }
  assert.ok(found, `product ${state.productId} did not appear in search within ${SEARCH_SYNC_TIMEOUT_MS} ms`);
  assert.equal(found.name, productName);
  assert.equal(found.price, 12.34);
});

test('the customer adds the product to the cart', async () => {
  const added = await api('/api/cart/items', {
    method: 'POST',
    token: state.customerToken,
    body: { productId: state.productId, quantity: 2 }
  });
  assert.equal(added.status, 201, added.text);

  const cart = await api('/api/cart/', { token: state.customerToken });
  assert.equal(cart.status, 200);
  const line = cart.json.data.items.find(item => item.productId === state.productId);
  assert.ok(line, 'cart line missing');
  assert.equal(line.quantity, 2);
  assert.equal(line.currentPrice, 12.34);
});

test('checkout confirms the order, takes stock, and is idempotent', async () => {
  const key = `e2e-${runId}`;
  const body = { items: [{ productId: state.productId, quantity: 2 }] };
  const first = await api('/api/order/orders/checkout', {
    method: 'POST',
    token: state.customerToken,
    headers: { 'Idempotency-Key': key },
    body
  });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.data.status, 'CONFIRMED');
  assert.equal(first.json.data.total, 24.68); // the server computes the total
  state.orderId = first.json.data.id;

  const retry = await api('/api/order/orders/checkout', {
    method: 'POST',
    token: state.customerToken,
    headers: { 'Idempotency-Key': key },
    body
  });
  assert.equal(retry.status, 200, retry.text);
  assert.equal(retry.json.data.id, state.orderId, 'a retry must not create a second order');

  const stock = await api(`/api/inventory/inventory/${state.productId}`);
  assert.equal(stock.json.data.availableQuantity, 3, 'stock should drop by exactly 2');
});

test('buying more than the remaining stock is refused', async () => {
  const response = await api('/api/order/orders/checkout', {
    method: 'POST',
    token: state.customerToken,
    headers: { 'Idempotency-Key': `e2e-too-many-${runId}` },
    body: { items: [{ productId: state.productId, quantity: 4 }] }
  });
  assert.equal(response.status, 409, response.text);
  assert.equal(response.json.error.code, 'INSUFFICIENT_STOCK');

  const stock = await api(`/api/inventory/inventory/${state.productId}`);
  assert.equal(stock.json.data.availableQuantity, 3, 'a failed checkout must not take stock');
});

test('the order appears in the customer history', async () => {
  const response = await api('/api/order/orders', { token: state.customerToken });
  assert.equal(response.status, 200);
  const order = response.json.data.find(item => item.id === state.orderId);
  assert.ok(order, 'order missing from history');
  assert.equal(order.status, 'CONFIRMED');
});
