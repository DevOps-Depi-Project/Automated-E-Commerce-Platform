const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3003;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL_SECONDS = 3600;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.disable('x-powered-by');
app.use((req, res, next) => {
  const allowedOrigin = 'http://localhost:3000';
  const origin = req.get('Origin');

  res.vary('Origin');
  if (origin === allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.json({ limit: '10kb' }));

function errorResponse(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validateEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (typeof password !== 'string') return false;
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes >= 8 && bytes <= 72;
}

function validateName(name) {
  return typeof name === 'string'
    && name.trim().length >= 1
    && name.trim().length <= 80
    && !/[\u0000-\u001f\u007f]/.test(name);
}

function validateRegistration(body) {
  const details = [];
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!validateEmail(email)) {
    details.push({ field: 'email', message: 'Must be a valid email address' });
  }
  if (!validatePassword(body.password)) {
    details.push({ field: 'password', message: 'Must be 8–72 UTF-8 bytes' });
  }
  if (!validateName(body.name)) {
    details.push({ field: 'name', message: 'Must be 1–80 characters without control characters' });
  }

  return { email, name, details };
}

function authenticate(req, res, next) {
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
    if (!claims || typeof claims.sub !== 'string' || typeof claims.role !== 'string') {
      return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token is invalid or expired');
    }

    req.auth = { userId: claims.sub, role: claims.role };
    next();
  });
}

function createAccessToken(user) {
  return jwt.sign(
    { role: user.role },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn: JWT_TTL_SECONDS
    }
  );
}

app.post('/register', async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { email, name, details } = validateRegistration(body);

  if (details.length) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  try {
    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await pool.query(
      `INSERT INTO auth.users (id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'customer')
       RETURNING id, email, name, role`,
      [randomUUID(), email, passwordHash, name]
    );
    return res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return errorResponse(res, 409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }
    return next(error);
  }
});

app.post('/login', async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';

  if (!validateEmail(email) || typeof body.password !== 'string') {
    return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, role, password_hash FROM auth.users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];
    const passwordMatches = user
      ? await bcrypt.compare(body.password, user.password_hash)
      : false;

    if (!passwordMatches) {
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    const token = createAccessToken(user);
    return res.json({
      data: {
        token,
        tokenType: 'Bearer',
        expiresIn: JWT_TTL_SECONDS,
        user: { id: user.id, email: user.email, name: user.name, role: user.role }
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role FROM auth.users WHERE id = $1',
      [req.auth.userId]
    );

    if (!result.rows.length) {
      return errorResponse(res, 401, 'TOKEN_INVALID', 'The access token is invalid or expired');
    }
    return res.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'authentication-service',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', 'Route not found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Request body is invalid or too large');
  }

  console.error('Authentication service error:', error.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

const server = app.listen(PORT, () => {
  console.log(`Authentication service running on port ${PORT}`);
});

async function close() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
