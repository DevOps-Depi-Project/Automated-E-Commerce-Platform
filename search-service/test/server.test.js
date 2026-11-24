const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../server');

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service and index status', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'search-service');
  assert.equal(response.json.index.syncIntervalSeconds, 30);
});

test('buildPrefixQuery builds a safe prefix tsquery from free text', () => {
  assert.equal(service.buildPrefixQuery('Lap  TOP'), 'lap:* & top:*');
  assert.equal(service.buildPrefixQuery('phone phone'), 'phone:*');
  // Operators and quotes can never reach to_tsquery.
  assert.equal(service.buildPrefixQuery("a' & | ! :* <-> b"), 'a:* & b:*');
  assert.equal(service.buildPrefixQuery('!!! ***'), null);
  assert.equal(service.buildPrefixQuery('سماعة لاسلكية'), 'سماعة:* & لاسلكية:*');
  const many = service.buildPrefixQuery(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '));
  assert.equal(many.split(' & ').length, 10);
});

test('normalizeCatalogProduct keeps only valid active products', () => {
  const valid = service.normalizeCatalogProduct({
    id: 7, name: ' Mug ', description: 'Blue', category: ' home ', price: 9.5, currency: 'usd', imageUrl: null, active: true
  });
  assert.deepEqual(valid, { id: 7, name: 'Mug', description: 'Blue', category: 'home', price: 9.5, currency: 'USD', imageUrl: null });

  assert.equal(service.normalizeCatalogProduct({ ...valid, active: false }), null);
  assert.equal(service.normalizeCatalogProduct({ ...valid, active: true, id: -1 }), null);
  assert.equal(service.normalizeCatalogProduct({ ...valid, active: true, currency: 'dollars' }), null);
  assert.equal(service.normalizeCatalogProduct({ ...valid, active: true, price: Number.NaN }), null);
});

test('parsePriceFilter accepts plain amounts only', () => {
  assert.deepEqual(service.parsePriceFilter(undefined), { value: null, valid: true });
  assert.deepEqual(service.parsePriceFilter('99.5'), { value: '99.5', valid: true });
  assert.equal(service.parsePriceFilter('1e3').valid, false);
  assert.equal(service.parsePriceFilter('-5').valid, false);
  assert.equal(service.parsePriceFilter('1.999').valid, false);
});

test('GET /search validates parameters before querying', async () => {
  for (const query of [`q=${'x'.repeat(101)}`, 'sort=drop', 'maxPrice=abc', 'pageSize=0', 'pageSize=101']) {
    const response = await api.request(`/search?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.json.error.code, 'VALIDATION_ERROR', query);
  }
});

test('GET /search returns 503 when the database is unreachable', async () => {
  const response = await api.request('/search?q=laptop');
  assert.equal(response.status, 503);
  assert.equal(response.json.error.code, 'SERVICE_UNAVAILABLE');
});

test('GET /metrics exposes search metrics', async () => {
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.text, /search_index_products/);
  assert.match(response.text, /search_sync_runs_total/);
});
