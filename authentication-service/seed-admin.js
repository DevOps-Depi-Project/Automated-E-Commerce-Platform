const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validateAdminSeed() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  const email = typeof ADMIN_EMAIL === 'string' ? normalizeEmail(ADMIN_EMAIL) : '';
  const rawName = typeof ADMIN_NAME === 'string' ? ADMIN_NAME : '';
  const name = rawName.trim();
  const passwordBytes = typeof ADMIN_PASSWORD === 'string'
    ? Buffer.byteLength(ADMIN_PASSWORD, 'utf8')
    : 0;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address');
  }
  if (passwordBytes < 8 || passwordBytes > 72) {
    throw new Error('ADMIN_PASSWORD must be between 8 and 72 UTF-8 bytes');
  }
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(rawName)) {
    throw new Error('ADMIN_NAME must be 1 to 80 characters without control characters');
  }

  return { email, name, password: ADMIN_PASSWORD };
}

async function seedAdmin() {
  const admin = validateAdminSeed();
  const existing = await pool.query(
    'SELECT id, role FROM auth.users WHERE email = $1',
    [admin.email]
  );

  if (existing.rows.length) {
    if (existing.rows[0].role === 'admin') {
      console.log('The configured admin account already exists');
      return;
    }
    throw new Error('The configured email belongs to a non-admin account; refusing to promote it');
  }

  const passwordHash = await bcrypt.hash(admin.password, 12);
  await pool.query(
    `INSERT INTO auth.users (id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [randomUUID(), admin.email, passwordHash, admin.name]
  );
  console.log('Demo admin account created');
}

seedAdmin()
  .catch((error) => {
    console.error('Failed to seed demo admin:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (pool) await pool.end();
  });
