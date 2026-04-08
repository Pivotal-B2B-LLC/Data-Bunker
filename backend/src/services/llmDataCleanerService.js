/**
 * LLM Data Cleaner Service
 *
 * Uses Llama 3.2 1B to continuously scan the database and:
 *  - Remove fake company names (random text, placeholders, gibberish)
 *  - Remove contacts with fake names
 *  - Null-out fake email addresses, phone numbers, job titles
 *  - Null-out invalid industries
 *  - Flag cleaned company names with the LLM-cleaned version
 *
 * Works alongside the enrichment pipeline — cleans while it enriches.
 */

const { pool } = require('../db/connection');
const ollama = require('./ollamaService');

const BATCH_SIZE = 10;       // companies per batch
const CONTACT_BATCH = 20;    // contacts per batch
const CONCURRENCY = 3;       // parallel LLM calls

class LLMDataCleanerService {
  constructor() {
    this.stats = {
      companiesScanned: 0,
      companiesFlagged: 0,
      companiesFixed: 0,
      contactsScanned: 0,
      contactsRemoved: 0,
      contactsFixed: 0,
      fieldsNullified: 0,
    };
    this.running = false;
    this.stopRequested = false;
    this.startedAt = null;
  }

  /** Start continuous cleaning (no-op if already running) */
  start(options = {}) {
    if (this.running) {
      this.log('Already running.');
      return;
    }
    this.stopRequested = false;
    this.startedAt = new Date().toISOString();
    this.runContinuous(options).catch(err => {
      this.log(`Fatal error: ${err.message}`);
      this.running = false;
    });
  }

  /** Request graceful stop of the continuous loop */
  stop() {
    if (!this.running) {
      this.log('Not running.');
      return;
    }
    this.stopRequested = true;
    this.log('Stop requested — will halt after current batch.');
  }

  log(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] [LLM-CLEANER] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Company cleaning
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get next batch of companies not yet LLM-validated
   */
  async getUnvalidatedCompanies() {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT id, name, email, phone, industry
        FROM companies
        WHERE llm_validated IS NULL OR llm_validated = FALSE
        ORDER BY id ASC
        LIMIT $1
      `, [BATCH_SIZE]);
      return result.rows;
    } catch (err) {
      // Table may not have the column yet — add it
      try {
        await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS llm_validated BOOLEAN DEFAULT NULL`);
        await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS llm_fake BOOLEAN DEFAULT FALSE`);
      } catch {}
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get next batch of accounts (from accounts table) not yet validated
   */
  async getUnvalidatedAccounts() {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT account_id AS id, company_name AS name, website, phone_number AS phone, industry, city, country
        FROM accounts
        WHERE llm_validated IS NULL OR llm_validated = FALSE
        ORDER BY account_id ASC
        LIMIT $1
      `, [BATCH_SIZE]);
      return result.rows;
    } catch (err) {
      try {
        await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS llm_validated BOOLEAN DEFAULT NULL`);
        await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS llm_fake BOOLEAN DEFAULT FALSE`);
      } catch {}
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Process one company — validate fields, write back results
   */
  async processCompany(company, table = 'companies') {
    const idCol = table === 'companies' ? 'id' : 'account_id';
    const nameCol = table === 'companies' ? 'name' : 'company_name';
    const phoneCol = table === 'companies' ? 'phone' : 'phone_number';

    this.stats.companiesScanned++;

    let result;
    try {
      result = await ollama.validateCompanyRecord({
        name: company.name,
        email: company.email || null,
        phone: company.phone || null,
        industry: company.industry || null,
      });
    } catch (err) {
      this.log(`  ⚠️  LLM error for "${company.name}": ${err.message}`);
      return;
    }

    const client = await pool.connect();
    try {
      if (!result.nameValid) {
        // Mark whole company as fake — don't delete, just flag
        await client.query(
          `UPDATE ${table} SET llm_validated = TRUE, llm_fake = TRUE WHERE ${idCol} = $1`,
          [company.id]
        );
        this.stats.companiesFlagged++;
        this.log(`  ✗ FAKE company: "${company.name}" — ${result.reasons.join(', ')}`);
        return;
      }

      // Build update to null out bad fields
      const setClauses = ['llm_validated = TRUE', 'llm_fake = FALSE'];
      const params = [];
      let paramIdx = 1;

      if (result.fieldsToNullify.includes('email')) {
        setClauses.push(`email = NULL`);
        this.stats.fieldsNullified++;
      }
      if (result.fieldsToNullify.includes('phone')) {
        setClauses.push(`${phoneCol} = NULL`);
        this.stats.fieldsNullified++;
      }
      if (result.fieldsToNullify.includes('industry')) {
        setClauses.push(`industry = NULL`);
        this.stats.fieldsNullified++;
      }

      params.push(company.id);
      await client.query(
        `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${idCol} = $${paramIdx}`,
        params
      );

      if (result.fieldsToNullify.length > 0) {
        this.stats.companiesFixed++;
        this.log(`  ✓ Fixed "${company.name}" — nullified: ${result.fieldsToNullify.join(', ')}`);
      }
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Contact cleaning
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get contacts not yet LLM-validated
   */
  async getUnvalidatedContacts() {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT contact_id, first_name, last_name, job_title, email, phone_number
        FROM contacts
        WHERE llm_validated IS NULL OR llm_validated = FALSE
        ORDER BY contact_id ASC
        LIMIT $1
      `, [CONTACT_BATCH]);
      return result.rows;
    } catch (err) {
      try {
        await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS llm_validated BOOLEAN DEFAULT NULL`);
      } catch {}
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Process one contact — remove if fake name, null bad fields otherwise
   */
  async processContact(contact) {
    this.stats.contactsScanned++;

    let result;
    try {
      result = await ollama.validateContactRecord(contact);
    } catch (err) {
      this.log(`  ⚠️  LLM error for contact ${contact.contact_id}: ${err.message}`);
      return;
    }

    const client = await pool.connect();
    try {
      if (!result.keep) {
        // Delete entirely — name is fake/gibberish
        await client.query('DELETE FROM contacts WHERE contact_id = $1', [contact.contact_id]);
        this.stats.contactsRemoved++;
        this.log(`  ✗ DELETED contact "${contact.first_name} ${contact.last_name}" — ${result.reasons.join(', ')}`);
        return;
      }

      const setClauses = ['llm_validated = TRUE'];

      // Null out fake fields
      if (result.fieldsToNullify.includes('job_title')) {
        setClauses.push('job_title = NULL');
        this.stats.fieldsNullified++;
      }
      if (result.fieldsToNullify.includes('email')) {
        setClauses.push('email = NULL');
        this.stats.fieldsNullified++;
      }
      if (result.fieldsToNullify.includes('phone_number')) {
        setClauses.push('phone_number = NULL');
        this.stats.fieldsNullified++;
      }

      // Fix cleaned name if LLM returned a correction
      if (result.nameData) {
        setClauses.push(`first_name = '${result.nameData.firstName.replace(/'/g, "''")}'`);
        setClauses.push(`last_name = '${result.nameData.lastName.replace(/'/g, "''")}'`);
      }

      await client.query(
        `UPDATE contacts SET ${setClauses.join(', ')} WHERE contact_id = $1`,
        [contact.contact_id]
      );

      if (setClauses.length > 1) {
        this.stats.contactsFixed++;
        this.log(`  ✓ Fixed contact "${contact.first_name} ${contact.last_name}" — ${result.fieldsToNullify.join(', ') || 'name cleaned'}`);
      }
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Batch runners
  // ─────────────────────────────────────────────────────────────────

  async runCompanyBatch() {
    const [companies, accounts] = await Promise.all([
      this.getUnvalidatedCompanies(),
      this.getUnvalidatedAccounts(),
    ]);

    // Process both tables concurrently but limit to CONCURRENCY at a time
    const companyJobs = companies.map(c => () => this.processCompany(c, 'companies'));
    const accountJobs = accounts.map(a => () => this.processCompany(a, 'accounts'));
    const allJobs = [...companyJobs, ...accountJobs];

    for (let i = 0; i < allJobs.length; i += CONCURRENCY) {
      await Promise.allSettled(allJobs.slice(i, i + CONCURRENCY).map(fn => fn()));
    }

    return companies.length + accounts.length;
  }

  async runContactBatch() {
    const contacts = await this.getUnvalidatedContacts();
    for (let i = 0; i < contacts.length; i += CONCURRENCY) {
      await Promise.allSettled(contacts.slice(i, i + CONCURRENCY).map(c => this.processContact(c)));
    }
    return contacts.length;
  }

  // ─────────────────────────────────────────────────────────────────
  // Continuous loop
  // ─────────────────────────────────────────────────────────────────

  async runContinuous(options = {}) {
    const { delayMs = 2000, onIdle = 60000 } = options;

    this.running = true;
    this.log('Starting continuous LLM data cleaning...');
    this.log(`Model: ${ollama.model}`);

    // Check LLM is reachable
    const ready = await ollama.isAvailable();
    if (!ready) {
      this.log('⚠️  Ollama is not running. Start it with: ollama serve');
      this.running = false;
      return;
    }
    this.log('✅ Llama 3.2 1B ready');

    let cycle = 0;
    while (!this.stopRequested) {
      cycle++;
      try {
        const companiesDone = await this.runCompanyBatch();
        const contactsDone = await this.runContactBatch();

        if (cycle % 10 === 0) {
          this.log('');
          this.log('─── STATS ───────────────────────────────');
          this.log(`  Companies scanned:  ${this.stats.companiesScanned}`);
          this.log(`  Companies FAKE:     ${this.stats.companiesFlagged}`);
          this.log(`  Companies fixed:    ${this.stats.companiesFixed}`);
          this.log(`  Contacts scanned:   ${this.stats.contactsScanned}`);
          this.log(`  Contacts DELETED:   ${this.stats.contactsRemoved}`);
          this.log(`  Contacts fixed:     ${this.stats.contactsFixed}`);
          this.log(`  Fields nullified:   ${this.stats.fieldsNullified}`);
          this.log('─────────────────────────────────────────');
          this.log('');
        }

        const totalDone = companiesDone + contactsDone;
        if (totalDone === 0) {
          this.log(`All records validated. Waiting ${onIdle / 1000}s for new data...`);
          await new Promise(r => setTimeout(r, onIdle));
          // Reset flags so new records from enrichment get re-checked
          // (only nulls get re-checked — already-validated records keep their flag)
        } else {
          await new Promise(r => setTimeout(r, delayMs));
        }
      } catch (err) {
        this.log(`Error in cycle ${cycle}: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    this.running = false;
    this.stopRequested = false;
    this.log('Cleaner stopped.');
  }

  /** Get current cleaning stats */
  getStats() {
    return {
      ...this.stats,
      running: this.running,
      startedAt: this.startedAt,
    };
  }
}

module.exports = new LLMDataCleanerService();
