/**
 * PostgreSQL Database Connection
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'databunker',
  user: process.env.POSTGRES_USER || 'databunker_user',
  password: process.env.POSTGRES_PASSWORD || 'databunker_secure_password_2024',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  query_timeout: 30000,
  statement_timeout: 30000,
  ssl: process.env.POSTGRES_HOST?.includes('neon.tech') ? {
    rejectUnauthorized: false
  } : false
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
