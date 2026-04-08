#!/usr/bin/env node

/**
 * Quick fix to add missing columns
 */

const { pool } = require('../src/db/connection');

async function fixColumns() {
  try {
    console.log('🔧 Adding missing columns...');

    await pool.query(`
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rating DECIMAL(2,1);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS total_ratings INTEGER;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS place_id VARCHAR(500);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_source VARCHAR(100);
    `);

    console.log('✅ Columns added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixColumns();
