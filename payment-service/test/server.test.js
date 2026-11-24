const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.INTERNAL_SERVICE_TOKEN = helpers.TEST_INTERNAL_TOKEN;
delete process.env.PAYMENT_SIMULATION_ENABLED;
delete process.env.PAYMENT_DEFAULT_RESULT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../server');

const internalHeaders = { Authorization: `Bearer ${helpers.TEST_INTERNAL_TOKEN}`, 'Idempotency-Key': 'payment-order-1' };

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'payment-service');
});

test('payments require the internal service token', async () => {
  const anonymous = await api.request('/internal/payments', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);

  const wrong = await api.request('/internal/payments', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong' },
    body: {}
  });
  assert.equal(wrong.status, 403);
});

test('card data, unsupported currencies and sub-cent amounts are refused', async () => {
  const response = await api.request('/internal/payments', {
    method: 'POST',
    headers: internalHeaders,
    body: { orderId: 'order-1', amount: 10.001, currency: 'EUR', cardNumber: '4111111111111111' }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(helpers.detailFields(response).sort(), ['amount', 'cardNumber', 'currency']);
});

test('validatePayment uses the default result when simulation is disabled', () => {
  const result = service.validatePayment({ orderId: 'order-1', amount: 12.5, currency: 'usd', simulate: 'failure' }, 'key');
  assert.deepEqual(result.details, []);
  assert.equal(result.amount, '12.50');
  assert.equal(result.currency, 'USD');
  assert.equal(result.result, 'SUCCEEDED');
});

test('parseAmount accepts at most two decimals', () => {
  assert.equal(service.parseAmount(19.99), 1999);
  assert.equal(service.parseAmount(0), null);
  assert.equal(service.parseAmount(1.001), null);
  assert.equal(service.parseAmount('5'), null);
});

test('GET /internal/payments/:id rejects non-UUID IDs', async () => {
  const response = await api.request('/internal/payments/not-a-uuid', { headers: internalHeaders });
  assert.equal(response.status, 404);
});

test('GET /metrics is available', async () => {
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /service="payment-service"/);
});
