const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { pool } = require('../db/database');

class BulkCSVImporter {
  constructor() {
    this.stats = {
      total: 0,
      imported: 0,
      failed: 0,
      skipped: 0,
      startTime: null,
      endTime: null
    };
    this.batchSize = 2000;
    this.batch = [];
    this.isRunning = false;
  }

  async importCompaniesFromCSV(filePath) {
    if (this.isRunning) {
      throw new Error('Import already running');
    }

    console.log('🚀 Starting ultra-fast CSV import...');
    console.log(`📁 File: ${filePath}`);
    
    this.isRunning = true;
    this.stats = {
      total: 0,
      imported: 0,
      failed: 0,
      skipped: 0,
      startTime: new Date(),
      endTime: null
    };

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', async (row) => {
          try {
            if (this.batch.length >= this.batchSize) {
              stream.pause();
              await this.processBatch();
              stream.resume();
            }

            this.batch.push(this.mapCSVRow(row));
            this.stats.total++;

            if (this.stats.total % 10000 === 0) {
              this.logProgress();
            }

          } catch (error) {
            console.error('Row error:', error.message);
            this.stats.failed++;
          }
        })
        .on('end', async () => {
          if (this.batch.length > 0) {
            await this.processBatch();
          }

          this.stats.endTime = new Date();
          this.isRunning = false;
          this.logFinalStats();
          resolve(this.stats);
        })
        .on('error', (error) => {
          this.isRunning = false;
          reject(error);
        });
    });
  }

  async processBatch() {
    if (this.batch.length === 0) return;

    try {
      const values = [];
      const placeholders = [];
      let paramCount = 1;

      this.batch.forEach((company) => {
        const params = [
          company.company_number,
          company.name,
          company.legal_name,
          company.jurisdiction,
          company.company_type,
          company.status,
          company.incorporation_date,
          company.address_line_1,
          company.address_line_2,
          company.locality,
          company.region,
          company.postal_code,
          company.country,
          company.industry,
          company.data_source
        ];

        values.push(...params);
        
        const placeholder = `($${paramCount}, $${paramCount+1}, $${paramCount+2}, $${paramCount+3}, 
          $${paramCount+4}, $${paramCount+5}, $${paramCount+6}, $${paramCount+7}, 
          $${paramCount+8}, $${paramCount+9}, $${paramCount+10}, $${paramCount+11}, 
          $${paramCount+12}, $${paramCount+13}, $${paramCount+14})`;
        
        placeholders.push(placeholder);
        paramCount += 15;
      });

      const query = `
        INSERT INTO companies (
          company_number, name, legal_name, jurisdiction, company_type, status,
          incorporation_date, address_line_1, address_line_2, locality, region,
          postal_code, country, industry, data_source
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (company_number) DO UPDATE SET
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          company_type = EXCLUDED.company_type,
          last_updated = NOW()
      `;

      await pool.query(query, values);
      this.stats.imported += this.batch.length;
      this.batch = [];

    } catch (error) {
      console.error('Batch import error:', error.message);
      this.stats.failed += this.batch.length;
      this.batch = [];
    }
  }

  mapCSVRow(row) {
    const getValue = (key) => row[key] || row[` ${key}`] || '';
    
    // Convert DD/MM/YYYY to YYYY-MM-DD
    const convertDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      return null;
    };
    
    return {
      company_number: getValue('CompanyNumber'),
      name: getValue('CompanyName'),
      legal_name: getValue('CompanyName'),
      jurisdiction: 'gb',
      company_type: getValue('CompanyCategory'),
      status: getValue('CompanyStatus'),
      incorporation_date: convertDate(getValue('IncorporationDate')),
      address_line_1: getValue('RegAddress.AddressLine1'),
      address_line_2: getValue('RegAddress.AddressLine2'),
      locality: getValue('RegAddress.PostTown'),
      region: getValue('RegAddress.County'),
      postal_code: getValue('RegAddress.PostCode'),
      country: getValue('RegAddress.Country') || 'United Kingdom',
      industry: this.mapSICCodes(getValue('SICCode.SicText_1')),
      data_source: 'companies_house_bulk'
    };
  }

  mapSICCodes(sicText) {
    if (!sicText) return 'Other';
    const text = sicText.toLowerCase();
    
    const mapping = {
      'software': 'Technology',
      'computer': 'Technology',
      'information technology': 'Technology',
      'construction': 'Construction',
      'building': 'Construction',
      'retail': 'Retail Trade',
      'wholesale': 'Wholesale Trade',
      'financial': 'Financial Services',
      'banking': 'Financial Services',
      'insurance': 'Financial Services',
      'property': 'Real Estate',
      'real estate': 'Real Estate',
      'restaurant': 'Food & Beverage',
      'food': 'Food & Beverage',
      'manufacturing': 'Manufacturing',
      'education': 'Education',
      'health': 'Healthcare',
      'medical': 'Healthcare',
      'consulting': 'Professional Services',
      'legal': 'Professional Services'
    };

    for (const [keyword, industry] of Object.entries(mapping)) {
      if (text.includes(keyword)) return industry;
    }
    
    return 'Other';
  }

  logProgress() {
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const rate = this.stats.total / (elapsed / 1000);
    const remaining = 5000000 - this.stats.total;
    const eta = remaining / rate;
    
    console.log(`📊 ${this.stats.total.toLocaleString()} | ✅ ${this.stats.imported.toLocaleString()} | ⚡ ${Math.round(rate)}/sec | ETA: ${Math.round(eta/60)}min`);
  }

  logFinalStats() {
    const duration = this.stats.endTime - this.stats.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    const rate = Math.round(this.stats.total / (duration / 1000));
    
    console.log(`\n🎉 CSV Import Complete!
╔════════════════════════════════════╗
║  Total Processed: ${this.stats.total.toLocaleString().padStart(12)} ║
║  ✅ Imported:     ${this.stats.imported.toLocaleString().padStart(12)} ║
║  ⏭️  Skipped:      ${this.stats.skipped.toLocaleString().padStart(12)} ║
║  ❌ Failed:       ${this.stats.failed.toLocaleString().padStart(12)} ║
║  ⏱️  Time:         ${minutes}m ${seconds}s      ║
║  ⚡ Rate:         ${rate}/sec       ║
╚════════════════════════════════════╝\n`);
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      rate: this.stats.startTime ? 
        Math.round(this.stats.total / ((Date.now() - this.stats.startTime.getTime()) / 1000)) : 0
    };
  }

  stop() {
    this.isRunning = false;
    console.log('🛑 Import stopped by user');
  }
}

module.exports = new BulkCSVImporter();
