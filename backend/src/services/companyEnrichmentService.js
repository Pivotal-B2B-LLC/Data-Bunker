/**
 * Company Enrichment Service
 * Enriches companies using public web data (website discovery + contact scraping).
 */

const { pool, query } = require('../db/connection');
const webScraperService = require('./webScraperService');
const directWebDiscovery = require('./directWebDiscovery');
const companiesHouse = require('./companiesHouse');
const ollama = require('./ollamaService');

class CompanyEnrichmentService {
  constructor() {
    this.batchSize = 10;
    this.maxConcurrent = 3;
    this.retryDelay = 5000;
  }

  /**
   * Enrich a single company by id.
   */
  async enrichCompany(companyId) {
    const startTime = Date.now();
    let client;

    try {
      client = await pool.connect();

      const companyResult = await client.query(
        `SELECT id, company_number, name, jurisdiction,
                address_line_1, locality, region, postal_code, country,
                website, phone, email, industry
         FROM companies
         WHERE id = $1`,
        [companyId]
      );

      if (companyResult.rows.length === 0) {
        throw new Error(`Company ${companyId} not found`);
      }

      const company = companyResult.rows[0];
      const enrichmentData = { ...company };

      const fieldsUpdated = [];
      const dataSources = [];
      let status = 'no_data';

      // Build full address string for better matching
      const fullAddress = [
        company.address_line_1,
        company.locality,
        company.region,
        company.postal_code
      ].filter(Boolean).join(', ');

      console.log(`[Enrichment] Company: ${company.name}`);
      console.log(`[Enrichment] Address: ${fullAddress}`);

      // Website discovery - Use direct URL guessing (NO API KEYS NEEDED)
      if (!enrichmentData.website) {
        console.log(`[Enrichment] Discovering website using name + address...`);
        
        const discoveryResult = await directWebDiscovery.discoverWebsite(
          company.name,
          company.country,
          company.locality,
          fullAddress
        );

        if (discoveryResult.success && discoveryResult.website) {
          enrichmentData.website = discoveryResult.website;
          fieldsUpdated.push('website');
          dataSources.push('direct_url_discovery');
          console.log(`[Enrichment] ✓ Found website: ${discoveryResult.website}`);
        } else {
          console.log(`[Enrichment] ✗ No website found for ${company.name}`);
        }
      }

      // Scrape website + contact page
      if (enrichmentData.website) {
        const scrapedData = await webScraperService.scrapeCompanyData(enrichmentData.website, company.country);

        if (scrapedData) {
          if (scrapedData.phone && !enrichmentData.phone) {
            enrichmentData.phone = scrapedData.phone;
            fieldsUpdated.push('phone');
            dataSources.push('website_scrape');
          }

          if (scrapedData.email && !enrichmentData.email) {
            enrichmentData.email = scrapedData.email;
            fieldsUpdated.push('email');
            dataSources.push('website_scrape');
          }

          // Extract address from website if not in database
          if (scrapedData.address && !enrichmentData.address_line_1) {
            enrichmentData.address_line_1 = scrapedData.address;
            fieldsUpdated.push('address');
            dataSources.push('website_scrape');
          }

          // Note: LinkedIn tracking removed - not in schema
          // Note: Twitter and Facebook columns removed - not tracking social media
        }
      }

      // NEW: Search for contact info directly from Google/Bing search results
      // This finds phone numbers and addresses displayed in search snippets
      if (!enrichmentData.phone || !enrichmentData.email || !enrichmentData.address_line_1) {
        console.log(`[Enrichment] Searching for contact info in search results...`);
        const searchLocation = company.locality || company.region || '';
        const searchContactInfo = await webScraperService.findContactInfoFromSearch(
          company.name, 
          searchLocation
        );

        if (searchContactInfo) {
          // Use phone from search if we don't have one
          if (searchContactInfo.phones && searchContactInfo.phones.length > 0 && !enrichmentData.phone) {
            enrichmentData.phone = searchContactInfo.phones[0];
            fieldsUpdated.push('phone');
            dataSources.push('google_search_snippet');
            console.log(`[Enrichment] ✓ Found phone from search: ${enrichmentData.phone}`);
          }

          // Use email from search if we don't have one
          if (searchContactInfo.emails && searchContactInfo.emails.length > 0 && !enrichmentData.email) {
            enrichmentData.email = searchContactInfo.emails[0];
            fieldsUpdated.push('email');
            dataSources.push('google_search_snippet');
            console.log(`[Enrichment] ✓ Found email from search: ${enrichmentData.email}`);
          }

          // Use address from search if we don't have one
          if (searchContactInfo.addresses && searchContactInfo.addresses.length > 0 && !enrichmentData.address_line_1) {
            enrichmentData.address_line_1 = searchContactInfo.addresses[0];
            fieldsUpdated.push('address');
            dataSources.push('google_search_snippet');
            console.log(`[Enrichment] ✓ Found address from search: ${enrichmentData.address_line_1}`);
          }
        }
      }

      // Enrich officers for UK companies
      if (company.jurisdiction === 'gb' || 
          (company.country && company.country.toLowerCase().match(/(uk|united kingdom|england|scotland|wales)/))) {
        try {
          const officersResult = await companiesHouse.getCompanyOfficers(company.company_number);
          
          if (officersResult && officersResult.officers && officersResult.officers.length > 0) {
            // Delete existing officers for this company to avoid duplicates
            await client.query(
              `DELETE FROM officers WHERE company_id = $1`,
              [companyId]
            );
            
            // Insert new officers
            for (const officer of officersResult.officers) {
              await client.query(
                `INSERT INTO officers (company_id, name, role, appointed_date, resigned_date, nationality, occupation, address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT DO NOTHING`,
                [
                  companyId,
                  officer.name,
                  officer.position,
                  officer.appointmentDate,
                  officer.resignationDate,
                  officer.nationality,
                  officer.occupation,
                  officer.address
                ]
              );
            }
            
            fieldsUpdated.push('officers');
            dataSources.push('companies_house');
            console.log(`✅ Enriched ${officersResult.officers.length} officers for ${company.name}`);
          }
        } catch (officerError) {
          console.error(`⚠️ Officer enrichment failed for ${company.name}:`, officerError.message);
          // Don't fail the whole enrichment if officer fetch fails
        }
      }

      if (fieldsUpdated.length > 0) {
        status = fieldsUpdated.length >= 2 ? 'success' : 'partial';
      }

      // Use Llama 3.2 to classify industry if still missing
      if (!enrichmentData.industry) {
        try {
          const llmAvailable = await ollama.isAvailable();
          if (llmAvailable) {
            const guessedIndustry = await ollama.classifyIndustry(
              company.name,
              enrichmentData.description || ''
            );
            if (guessedIndustry && guessedIndustry.length > 2) {
              enrichmentData.industry = guessedIndustry;
              fieldsUpdated.push('industry');
              dataSources.push('llm_classification');
              console.log(`[Enrichment] ✓ LLM classified industry: ${guessedIndustry}`);
            }
          }
        } catch (llmErr) {
          console.warn('[Enrichment] LLM industry classification failed:', llmErr.message);
        }
      }

      // LLM validation pass — strip any fake/invalid values from what we discovered
      try {
        const llmAvailable = await ollama.isAvailable();
        if (llmAvailable) {
          const validation = await ollama.validateCompanyRecord({
            name: company.name,
            email: enrichmentData.email || null,
            phone: enrichmentData.phone || null,
            industry: enrichmentData.industry || null,
          });

          if (validation.fieldsToNullify.includes('email')) {
            enrichmentData.email = null;
            console.log(`[Enrichment] ✗ LLM rejected email for "${company.name}"`);
          }
          if (validation.fieldsToNullify.includes('phone')) {
            enrichmentData.phone = null;
            console.log(`[Enrichment] ✗ LLM rejected phone for "${company.name}"`);
          }
          if (validation.fieldsToNullify.includes('industry')) {
            enrichmentData.industry = null;
            console.log(`[Enrichment] ✗ LLM rejected industry for "${company.name}"`);
          }
        }
      } catch (llmErr) {
        // Validation is best-effort — carry on
      }

      await client.query(
        `UPDATE companies
         SET website = $1,
             phone = $2,
             email = $3,
             industry = $4,
             address_line_1 = COALESCE($5, address_line_1),
             last_updated = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [
          enrichmentData.website,
          enrichmentData.phone,
          enrichmentData.email,
          enrichmentData.industry,
          enrichmentData.address_line_1,
          companyId
        ]
      );

      // Note: enrichment_logs table not in schema - skip logging

      return {
        success: true,
        companyId,
        companyName: company.name,
        status,
        fieldsUpdated,
        dataSources,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error(`❌ Enrichment failed for company ${companyId}:`, error.message);
      return { success: false, companyId, error: error.message };
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Batch enrichment using view companies_needing_enrichment.
   */
  async enrichBatch(limit = this.batchSize) {
    let client;

    try {
      client = await pool.connect();
      const result = await client.query(
        `SELECT id, name FROM companies_needing_enrichment LIMIT $1`,
        [limit]
      );

      if (result.rows.length === 0) {
        return { processed: 0, results: [] };
      }

      const results = [];
      for (let i = 0; i < result.rows.length; i += this.maxConcurrent) {
        const chunk = result.rows.slice(i, i + this.maxConcurrent);
        const chunkResults = await Promise.all(
          chunk.map(row => this.enrichCompany(row.id))
        );
        results.push(...chunkResults);
        if (i + this.maxConcurrent < result.rows.length) {
          await this.sleep(2000);
        }
      }

      return {
        processed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Queue helper: insert pending rows.
   */
  async queueCompaniesForEnrichment(companyIds, priority = 0) {
    const client = await pool.connect();

    try {
      const values = companyIds.map((id, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(',');
      const params = companyIds.flatMap(id => [id, priority]);

      await client.query(
        `INSERT INTO enrichment_queue (company_id, priority)
         VALUES ${values}
         ON CONFLICT (company_id) WHERE status = 'pending'
         DO UPDATE SET priority = EXCLUDED.priority, updated_at = CURRENT_TIMESTAMP`,
        params
      );

      return { queued: companyIds.length };
    } finally {
      client.release();
    }
  }

  /**
   * Process the enrichment_queue table.
   */
  async processQueue(limit = this.batchSize) {
    const client = await pool.connect();

    try {
      const result = await client.query(
        `SELECT id, company_id
         FROM enrichment_queue
         WHERE status = 'pending'
           AND scheduled_for <= CURRENT_TIMESTAMP
           AND attempts < max_attempts
         ORDER BY priority DESC, scheduled_for ASC
         LIMIT $1`,
        [limit]
      );

      if (result.rows.length === 0) {
        return { processed: 0, results: [] };
      }

      const results = [];
      for (const row of result.rows) {
        await client.query(
          `UPDATE enrichment_queue
           SET status = 'processing', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
           WHERE id = $1`,
          [row.id]
        );

        const enrichResult = await this.enrichCompany(row.company_id);
        results.push(enrichResult);

        if (enrichResult.success) {
          await client.query(
            `UPDATE enrichment_queue
             SET status = 'completed', completed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [row.id]
          );
        } else {
          await client.query(
            `UPDATE enrichment_queue
             SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
                 error_message = $1,
                 scheduled_for = CURRENT_TIMESTAMP + INTERVAL '1 hour'
             WHERE id = $2`,
            [enrichResult.error, row.id]
          );
        }
      }

      return {
        processed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    } finally {
      client.release();
    }
  }

  /**
   * Enrichment statistics.
   */
  async getEnrichmentStats() {
    const client = await pool.connect();

    try {
      const stats = await client.query(`
        SELECT 
          COUNT(*) as total_companies,
          COUNT(website) as companies_with_website,
          COUNT(phone) as companies_with_phone,
          COUNT(email) as companies_with_email,
          COUNT(industry) as companies_with_industry
        FROM companies
      `);

      const needingEnrichment = await client.query(`
        SELECT COUNT(*) as count FROM companies_needing_enrichment
      `);

      return {
        summary: stats.rows[0],
        needingEnrichment: parseInt(needingEnrichment.rows[0].count)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Structured report based on stats.
   */
  async generateReport() {
    const stats = await this.getEnrichmentStats();
    const summary = stats.summary;

    return {
      timestamp: new Date().toISOString(),
      totalCompanies: parseInt(summary.total_companies),
      enrichmentStatus: {
        enriched: parseInt(summary.companies_enriched),
        neverEnriched: parseInt(summary.never_enriched),
        fullyEnriched: parseInt(summary.fully_enriched),
        partiallyEnriched: parseInt(summary.partially_enriched),
        failedEnrichment: parseInt(summary.failed_enrichment),
        noDataFound: parseInt(summary.no_data_found)
      },
      dataAvailability: {
        website: this._asAvailability(summary.companies_with_website, summary.total_companies),
        phone: this._asAvailability(summary.companies_with_phone, summary.total_companies),
        email: this._asAvailability(summary.companies_with_email, summary.total_companies),
        linkedin: this._asAvailability(summary.companies_with_linkedin, summary.total_companies),
        twitter: this._asAvailability(summary.companies_with_twitter, summary.total_companies),
        facebook: this._asAvailability(summary.companies_with_facebook, summary.total_companies),
        industry: this._asAvailability(summary.companies_with_industry, summary.total_companies)
      },
      pendingEnrichment: stats.needingEnrichment,
      recentActivity: stats.recentActivity
    };
  }

  _asAvailability(count, total) {
    const c = parseInt(count);
    const t = parseInt(total) || 1;
    return { count: c, percentage: ((c / t) * 100).toFixed(1) };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new CompanyEnrichmentService();
