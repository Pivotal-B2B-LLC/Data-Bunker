#!/usr/bin/env node

/**
 * Run Database Migrations
 * Applies all pending SQL migrations to the database
 */

const { pool } = require('../src/db/connection');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...\n');

    // Check connection first
    await pool.query('SELECT NOW()');
    console.log('✓ Database connected\n');

    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files:\n`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`  → Running: ${file}`);
      try {
        await pool.query(sql);
        console.log(`  ✓ Success: ${file}\n`);
      } catch (error) {
        // Some errors are okay (like "column already exists")
        if (error.message.includes('already exists')) {
          console.log(`  ⚠ Skipped: ${file} (already applied)\n`);
        } else {
          console.error(`  ❌ Error in ${file}:`, error.message, '\n');
        }
      }
    }

    console.log('✅ All migrations completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
