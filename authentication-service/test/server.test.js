const helpers = require('./helpers');

process.env.DATABASE_URL = helpers.UNREACHABLE_DATABASE_URL;
process.env.JWT_SECRET = helpers.TEST_JWT_SECRET;
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000, http://example.test/';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const service = require('../server');

let api;
before(async () => { api = await helpers.startApp(service.app); });
after(async () => {
  await api.close();
  await service.pool.end();
});

test('GET /health reports the service', async () => {
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.service, 'authentication-service');
});

test('unknown routes return a JSON 404', async () => {
  const response = await api.request('/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, 'NOT_FOUND');
});

test('POST /register rejects invalid email, password and name', async () => {
  const response = await api.request('/register', {
    method: 'POST',
    body: { email: 'not-an-email', password: 'short', name: '   ' }
  });
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(helpers.detailFields(response).sort(), ['email', 'name', 'password']);
});

test('POST /register rejects a malformed JSON body', async () => {
  const response = await api.request('/register', { method: 'POST', body: '{"email":' });
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
});

test('validatePassword counts UTF-8 bytes (bcrypt only uses 72)', () => {
  assert.equal(service.validatePassword('a'.repeat(8)), true);
  assert.equal(service.validatePassword('a'.repeat(72)), true);
  assert.equal(service.validatePassword('a'.repeat(73)), false);
  assert.equal(service.validatePassword('é'.repeat(37)), false); // 74 bytes
  assert.equal(service.validatePassword(12345678), false);
});

test('registration normalizes the email address', () => {
  const result = service.validateRegistration({ email: '  User@Example.COM ', password: 'password1', name: ' Ann ' });
  assert.deepEqual(result.details, []);
  assert.equal(result.email, 'user@example.com');
  assert.equal(result.name, 'Ann');
});

test('POST /login with an invalid email fails without revealing details', async () => {
  const response = await api.request('/login', { method: 'POST', body: { email: 'nope', password: 'x' } });
  assert.equal(response.status, 401);
  assert.equal(response.json.error.code, 'INVALID_CREDENTIALS');
});

test('GET /me requires a valid, unexpired token', async () => {
  const missing = await api.request('/me');
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error.code, 'TOKEN_REQUIRED');

  const garbage = await api.request('/me', { headers: { Authorization: 'Bearer abc.def.ghi' } });
  assert.equal(garbage.json.error.code, 'TOKEN_INVALID');

  const wrongSecret = jwt.sign({ role: 'customer' }, 'another-secret-of-at-least-32-bytes!!', { subject: randomUUID() });
  const forged = await api.request('/me', { headers: { Authorization: `Bearer ${wrongSecret}` } });
  assert.equal(forged.json.error.code, 'TOKEN_INVALID');

  const expiredToken = jwt.sign({ role: 'customer', exp: Math.floor(Date.now() / 1000) - 60 }, helpers.TEST_JWT_SECRET, { subject: randomUUID() });
  const expired = await api.request('/me', { headers: { Authorization: `Bearer ${expiredToken}` } });
  assert.equal(expired.json.error.code, 'TOKEN_EXPIRED');
});

test('CORS allows only configured origins (trailing slash ignored)', async () => {
  assert.ok(service.CORS_ALLOWED_ORIGINS.has('http://example.test'));

  const allowed = await api.request('/login', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');

  const blocked = await api.request('/login', { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});

test('GET /metrics exposes Prometheus metrics labelled with the service', async () => {
  await api.request('/health');
  const response = await api.request('/metrics');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  // Label order is not guaranteed, so check both labels on the same series with lookaheads.
  assert.match(response.text, /http_requests_total\{(?=[^}]*route="\/health")(?=[^}]*service="authentication-service")/);
  assert.match(response.text, /process_resident_memory_bytes/);
});
