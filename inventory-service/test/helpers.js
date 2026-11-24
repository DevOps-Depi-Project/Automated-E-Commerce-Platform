// Test helpers shared by every service (identical copy in each service's test/ folder).
// Unit tests run the Express app on a random local port without PostgreSQL: DATABASE_URL
// points at a closed port, so any query fails fast with ECONNREFUSED.
const { once } = require('node:events');

const UNREACHABLE_DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const TEST_JWT_SECRET = 'unit-test-jwt-secret-of-at-least-32-bytes';
const TEST_INTERNAL_TOKEN = 'unit-test-internal-token-of-at-least-32-bytes';

async function startApp(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', headers = {}, body } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(base + path, init);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
    return { status: response.status, headers: response.headers, json, text };
  }

  function close() {
    return new Promise(resolve => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  return { base, request, close };
}

// Returns the field names of a validation response's details, e.g. ['price', 'currency'].
function detailFields(response) {
  const details = response.json && response.json.error && response.json.error.details;
  return Array.isArray(details) ? details.map(detail => detail.field) : [];
}

module.exports = {
  UNREACHABLE_DATABASE_URL,
  TEST_JWT_SECRET,
  TEST_INTERNAL_TOKEN,
  startApp,
  detailFields
};
