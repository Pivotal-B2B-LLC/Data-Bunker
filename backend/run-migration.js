const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discovery_queue (
        queue_id         SERIAL          PRIMARY KEY,
        country          VARCHAR(100)    NOT NULL,
        country_code     VARCHAR(10),
        state_region     VARCHAR(100)    NOT NULL,
        state_code       VARCHAR(20),
        city             VARCHAR(200)    NOT NULL,
        place_type       VARCHAR(50),
        population       INTEGER         DEFAULT 0,
        latitude         DECIMAL(10,7),
        longitude        DECIMAL(11,7),
        priority         INTEGER         DEFAULT 5,
        status           VARCHAR(20)     DEFAULT 'pending',
        companies_found  INTEGER         DEFAULT 0,
        started_at       TIMESTAMP,
        completed_at     TIMESTAMP,
        error_message    TEXT,
        CONSTRAINT unique_queue_area UNIQUE (country_code, state_code, city)
      )
    `);
    console.log('discovery_queue table created (or already exists)');

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dq_status_priority ON discovery_queue (status, priority ASC, population DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dq_country_state ON discovery_queue (country_code, state_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dq_status ON discovery_queue (status)`);
    console.log('Indexes created');
  } catch (e) {
    console.error('Migration error:', e.message);
  } finally {
    await pool.end();
  }
}

run();
