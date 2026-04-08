#!/usr/bin/env node

/**
 * NUKE ALL CONTACTS + ADD DATABASE TRIGGER
 *
 * 1. Deletes ALL existing contacts (they're mostly garbage from web scraping)
 * 2. Creates a database trigger that REJECTS any contact insert
 *    unless it has a valid job_title
 *
 * This means no matter which script tries to insert contacts,
 * only ones with real job titles will be saved.
 */

require('dotenv').config();
const { pool } = require('../src/db/connection');

// Valid job title keywords - contact MUST contain one of these
const VALID_TITLE_KEYWORDS = [
  'director', 'managing director', 'executive director', 'board director',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio',
  'chief executive', 'chief technology', 'chief financial', 'chief operating',
  'chief marketing', 'chief information', 'chief officer',
  'president', 'vice president', 'vp', 'svp', 'evp',
  'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'managing partner', 'senior partner',
  'principal', 'head of', 'general manager',
  'manager', 'senior manager', 'regional manager', 'area manager',
  'supervisor', 'lead', 'team lead',
  'secretary', 'company secretary', 'corporate secretary',
  'treasurer', 'chair', 'chairman', 'chairwoman', 'chairperson',
  'accountant', 'solicitor', 'barrister', 'lawyer', 'counsel',
  'engineer', 'architect', 'consultant', 'analyst', 'advisor',
  'coordinator', 'officer', 'specialist'
];

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   NUKE CONTACTS + ADD JOB TITLE PROTECTION');
  console.log('='.repeat(60));

  // Step 1: Count current contacts
  const countBefore = await pool.query('SELECT COUNT(*) FROM contacts');
  console.log(`\n   Current contacts: ${countBefore.rows[0].count}`);

  // Step 2: Delete ALL contacts
  console.log('\n   Deleting ALL contacts...');
  await pool.query('DELETE FROM contacts');
  console.log('   Done. All contacts deleted.');

  // Step 3: Create database function + trigger for job title validation
  console.log('\n   Creating database trigger for job title validation...');

  // Create the validation function
  await pool.query(`
    CREATE OR REPLACE FUNCTION validate_contact_job_title()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Require job_title to be non-null and non-empty
      IF NEW.job_title IS NULL OR TRIM(NEW.job_title) = '' THEN
        RAISE EXCEPTION 'Contact must have a valid job_title. Got: NULL or empty';
      END IF;

      -- Job title must be at least 3 characters
      IF LENGTH(TRIM(NEW.job_title)) < 3 THEN
        RAISE EXCEPTION 'Contact job_title too short: %', NEW.job_title;
      END IF;

      -- Check that job title contains at least one valid keyword
      IF NOT (
        LOWER(NEW.job_title) LIKE '%director%' OR
        LOWER(NEW.job_title) LIKE '%ceo%' OR
        LOWER(NEW.job_title) LIKE '%cto%' OR
        LOWER(NEW.job_title) LIKE '%cfo%' OR
        LOWER(NEW.job_title) LIKE '%coo%' OR
        LOWER(NEW.job_title) LIKE '%cmo%' OR
        LOWER(NEW.job_title) LIKE '%cio%' OR
        LOWER(NEW.job_title) LIKE '%chief%' OR
        LOWER(NEW.job_title) LIKE '%president%' OR
        LOWER(NEW.job_title) LIKE '%vice president%' OR
        LOWER(NEW.job_title) LIKE '%owner%' OR
        LOWER(NEW.job_title) LIKE '%founder%' OR
        LOWER(NEW.job_title) LIKE '%partner%' OR
        LOWER(NEW.job_title) LIKE '%principal%' OR
        LOWER(NEW.job_title) LIKE '%head of%' OR
        LOWER(NEW.job_title) LIKE '%general manager%' OR
        LOWER(NEW.job_title) LIKE '%manager%' OR
        LOWER(NEW.job_title) LIKE '%supervisor%' OR
        LOWER(NEW.job_title) LIKE '%lead%' OR
        LOWER(NEW.job_title) LIKE '%secretary%' OR
        LOWER(NEW.job_title) LIKE '%treasurer%' OR
        LOWER(NEW.job_title) LIKE '%chair%' OR
        LOWER(NEW.job_title) LIKE '%accountant%' OR
        LOWER(NEW.job_title) LIKE '%solicitor%' OR
        LOWER(NEW.job_title) LIKE '%barrister%' OR
        LOWER(NEW.job_title) LIKE '%lawyer%' OR
        LOWER(NEW.job_title) LIKE '%counsel%' OR
        LOWER(NEW.job_title) LIKE '%engineer%' OR
        LOWER(NEW.job_title) LIKE '%architect%' OR
        LOWER(NEW.job_title) LIKE '%consultant%' OR
        LOWER(NEW.job_title) LIKE '%analyst%' OR
        LOWER(NEW.job_title) LIKE '%advisor%' OR
        LOWER(NEW.job_title) LIKE '%officer%' OR
        LOWER(NEW.job_title) LIKE '%specialist%' OR
        LOWER(NEW.job_title) LIKE '%coordinator%' OR
        LOWER(NEW.job_title) LIKE '%vp %' OR
        LOWER(NEW.job_title) LIKE '% vp%'
      ) THEN
        RAISE EXCEPTION 'Contact job_title does not contain a valid role: %', NEW.job_title;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Drop existing trigger if any
  await pool.query(`
    DROP TRIGGER IF EXISTS enforce_contact_job_title ON contacts;
  `);

  // Create the trigger
  await pool.query(`
    CREATE TRIGGER enforce_contact_job_title
    BEFORE INSERT ON contacts
    FOR EACH ROW
    EXECUTE FUNCTION validate_contact_job_title();
  `);

  console.log('   Database trigger created successfully!');
  console.log('   Any INSERT into contacts without a valid job_title will be REJECTED.');

  // Step 4: Test the trigger
  console.log('\n   Testing trigger...');

  // Test 1: Should FAIL (no job title)
  try {
    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, data_source)
      VALUES (1, 'Test', 'NoTitle', 'test')
    `);
    console.log('   FAIL: Trigger did not block insert without job_title!');
  } catch (e) {
    console.log('   PASS: Blocked insert without job_title');
  }

  // Test 2: Should FAIL (garbage job title)
  try {
    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, job_title, data_source)
      VALUES (1, 'Test', 'BadTitle', 'Random Words Here', 'test')
    `);
    console.log('   FAIL: Trigger did not block garbage job_title!');
  } catch (e) {
    console.log('   PASS: Blocked insert with garbage job_title');
  }

  // Test 3: Should SUCCEED (valid job title)
  try {
    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, job_title, data_source)
      VALUES (1, 'John', 'Smith', 'Managing Director', 'test')
    `);
    console.log('   PASS: Allowed insert with valid job_title "Managing Director"');
    // Clean up test
    await pool.query(`DELETE FROM contacts WHERE first_name = 'John' AND last_name = 'Smith' AND data_source = 'test'`);
  } catch (e) {
    console.log('   FAIL: Blocked valid job_title "Managing Director":', e.message);
  }

  const countAfter = await pool.query('SELECT COUNT(*) FROM contacts');

  console.log('\n' + '='.repeat(60));
  console.log('   COMPLETE');
  console.log('='.repeat(60));
  console.log(`   Deleted: ${countBefore.rows[0].count} garbage contacts`);
  console.log(`   Remaining: ${countAfter.rows[0].count} contacts`);
  console.log(`   Protection: Database trigger active`);
  console.log(`   Rule: Every contact MUST have a valid job title`);
  console.log('='.repeat(60) + '\n');

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
