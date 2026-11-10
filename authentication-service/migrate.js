const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const migrationPath = path.join(__dirname, 'migrations', '001_create_users.sql');

async function migrate() {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Authentication database migration applied');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Failed to apply authentication migration:', error.message);
  process.exitCode = 1;
});
