// Prometheus metrics shared by every service (each service keeps an identical copy
// because each one is built as its own Docker image).
//
// Exposes GET /metrics with:
//   - default Node.js process metrics (CPU, memory, event loop lag, GC, ...)
//   - http_requests_total and http_request_duration_seconds per method/route/status
// Every series carries a "service" label. /metrics is internal: Nginx does not route it.
const client = require('prom-client');

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function routeLabel(req) {
  // Use the route pattern (/products/:id), never the raw URL, to keep label cardinality bounded.
  if (!req.route) return 'unmatched';
  const path = Array.isArray(req.route.path) ? req.route.path.join('|') : String(req.route.path);
  return (req.baseUrl || '') + path;
}

function setupMetrics(app, serviceName) {
  const register = new client.Registry();
  register.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register });

  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, by method, route pattern and status code',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
  });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route pattern and status code',
    labelNames: ['method', 'route', 'status_code'],
    buckets: DURATION_BUCKETS,
    registers: [register]
  });

  app.use((req, res, next) => {
    if (req.path === '/metrics') return next();
    const stopTimer = httpDuration.startTimer();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) };
      httpRequests.inc(labels);
      stopTimer(labels);
    });
    return next();
  });

  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (error) {
      next(error);
    }
  });

  return {
    register,
    counter: options => new client.Counter({ ...options, registers: [register] }),
    gauge: options => new client.Gauge({ ...options, registers: [register] }),
    histogram: options => new client.Histogram({ ...options, registers: [register] })
  };
}

module.exports = { setupMetrics };
