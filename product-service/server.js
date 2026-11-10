const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10kb' }));

function errorResponse(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

function authenticateAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return errorResponse(res, 401, 'TOKEN_REQUIRED', 'A valid Bearer token is required');
  }

  jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] }, (err, claims) => {
    if (err) {
      const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      return errorResponse(res, 401, code, 'The access token is invalid or expired');
    }
    if (!claims
      || typeof claims.sub !== 'string'
      || typeof claims.role !== 'string'
      || !Number.isInteger(claims.iat)
      || !Number.isInteger(claims.exp)) {
      return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token is invalid or expired');
    }
    if (claims.role !== 'admin') {
      return errorResponse(res, 403, 'FORBIDDEN', 'Admin role is required');
    }

    req.auth = { userId: claims.sub, role: claims.role };
    next();
  });
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    currency: row.currency,
    imageUrl: row.image_url,
    active: row.active
  };
}

function validateProduct(body) {
  const details = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const imageUrl = body.imageUrl === undefined || body.imageUrl === null
    ? null
    : typeof body.imageUrl === 'string' ? body.imageUrl.trim() : undefined;
  const price = body.price;

  if (!name || name.length > 120) {
    details.push({ field: 'name', message: 'Must be 1–120 characters' });
  }
  if (!description || description.length > 2000) {
    details.push({ field: 'description', message: 'Must be 1–2000 characters' });
  }
  if (!category || category.length > 80) {
    details.push({ field: 'category', message: 'Must be 1–80 characters' });
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    details.push({ field: 'price', message: 'Must be a finite nonnegative number' });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    details.push({ field: 'currency', message: 'Must be a three-letter currency code' });
  }
  if (imageUrl === undefined || (typeof imageUrl === 'string' && imageUrl.length > 2048)) {
    details.push({ field: 'imageUrl', message: 'Must be a string of at most 2048 characters' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'stock')) {
    details.push({ field: 'stock', message: 'Stock is managed by Inventory Service' });
  }

  return {
    product: { name, description, category, price, currency, imageUrl },
    details
  };
}

app.get('/', (req, res) => {
  res.json({
    service: 'Product Service',
    version: '1.0.0',
    endpoints: {
      'GET /products': 'Get a paginated product catalog',
      'GET /products/:id': 'Get an active product by ID',
      'GET /admin/products': 'Get all products, including inactive products (admin)',
      'POST /products': 'Create a product (admin)',
      'PUT /products/:id': 'Replace product fields (admin)',
      'DELETE /products/:id': 'Deactivate a product (admin)',
      'GET /health': 'Health check'
    }
  });
});

app.get('/products', async (req, res, next) => {
  const page = parsePositiveInteger(req.query.page, 1);
  const pageSize = parsePositiveInteger(req.query.pageSize, PAGE_SIZE_DEFAULT);
  if (page === null || pageSize === null || pageSize > PAGE_SIZE_MAX) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid pagination parameters', [
      { field: 'page', message: 'page and pageSize must be positive integers; pageSize is at most 100' }
    ]);
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const sortOptions = {
    'name-asc': 'name ASC',
    'name-desc': 'name DESC',
    'price-asc': 'price ASC',
    'price-desc': 'price DESC'
  };
  const sort = req.query.sort ? sortOptions[req.query.sort] : 'id ASC';
  if (!sort) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid sort option', [
      { field: 'sort', message: 'Use name-asc, name-desc, price-asc, or price-desc' }
    ]);
  }

  const filters = ['active = TRUE'];
  const values = [];
  if (q) {
    values.push(`%${q}%`);
    filters.push(`(name ILIKE $${values.length} OR description ILIKE $${values.length})`);
  }
  if (category) {
    values.push(category);
    filters.push(`category = $${values.length}`);
  }
  const where = filters.join(' AND ');

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products.products WHERE ${where}`,
      values
    );
    const totalItems = countResult.rows[0].total;
    const offset = (page - 1) * pageSize;
    const listResult = await pool.query(
      `SELECT id, name, description, category, price, currency, image_url, active
       FROM products.products WHERE ${where}
       ORDER BY ${sort}, id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset]
    );

    return res.json({
      data: listResult.rows.map(mapProduct),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize)
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/admin/products', authenticateAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, category, price, currency, image_url, active
       FROM products.products ORDER BY id ASC`
    );
    return res.json({
      data: result.rows.map(mapProduct),
      meta: { totalItems: result.rowCount }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/products/:id', async (req, res, next) => {
  const id = parsePositiveInteger(req.params.id);
  if (id === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer');
  }

  try {
    const result = await pool.query(
      `SELECT id, name, description, category, price, currency, image_url, active
       FROM products.products WHERE id = $1 AND active = TRUE`,
      [id]
    );
    if (!result.rows.length) {
      return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    return res.json(mapProduct(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

app.post('/products', authenticateAdmin, async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { product, details } = validateProduct(body);
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    const result = await pool.query(
      `INSERT INTO products.products
         (name, description, category, price, currency, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, category, price, currency, image_url, active`,
      [product.name, product.description, product.category, product.price,
        product.currency, product.imageUrl]
    );
    return res.status(201).json(mapProduct(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

app.put('/products/:id', authenticateAdmin, async (req, res, next) => {
  const id = parsePositiveInteger(req.params.id);
  if (id === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer');
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { product, details } = validateProduct(body);
  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    const result = await pool.query(
      `UPDATE products.products
       SET name = $1, description = $2, category = $3, price = $4,
           currency = $5, image_url = $6
       WHERE id = $7 AND active = TRUE
       RETURNING id, name, description, category, price, currency, image_url, active`,
      [product.name, product.description, product.category, product.price,
        product.currency, product.imageUrl, id]
    );
    if (!result.rows.length) {
      return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    return res.json(mapProduct(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

app.delete('/products/:id', authenticateAdmin, async (req, res, next) => {
  const id = parsePositiveInteger(req.params.id);
  if (id === null) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer');
  }

  try {
    const result = await pool.query(
      'UPDATE products.products SET active = FALSE WHERE id = $1 AND active = TRUE RETURNING id',
      [id]
    );
    if (!result.rows.length) {
      return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'product-service', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', 'Route not found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request body is invalid or too large');
  }

  if (error.code && (error.code.startsWith('08') || error.code === 'ECONNREFUSED' || error.code === '57P03')) {
    return errorResponse(res, 503, 'DATABASE_UNAVAILABLE', 'Product database is unavailable');
  }

  console.error('Product service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Product service running on port ${PORT}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
