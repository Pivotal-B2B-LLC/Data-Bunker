/**
 * Bulk Import Service - Import all active UK companies from Companies House
 * Automatically handles duplicates by updating existing records
 */

const companiesHouse = require('./companiesHouse');
const companyRepository = require('../models/companyRepository');
const googlePlacesService = require('./googlePlacesService');
const webScraperService = require('./webScraperService');

class BulkImportService {
  constructor() {
    this.isRunning = false;
    this.stats = {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Import all active UK companies
   */
  async importAllActiveUKCompanies(options = {}) {
    if (this.isRunning) {
      console.log('⚠️ Import already running');
      return this.stats;
    }

    this.isRunning = true;
    this.stats = {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startTime: new Date(),
      endTime: null
    };

    const {
      startFrom = 0,
      batchSize = 100,
      maxCompanies = null,
      delayBetweenBatches = 2000,
      enrichWithContacts = false
    } = options;

    console.log('\n🇬🇧 Starting bulk import of UK companies...');
    console.log(`📊 Settings: maxCompanies=${maxCompanies || 'unlimited'}, batchSize=${batchSize}, delay=${delayBetweenBatches}ms, enrich=${enrichWithContacts}`);
    console.log('🔒 Duplicate prevention: ON (updates existing records)\n');

    try {
      const searchTerms = this.getSearchTerms();
      
      for (const term of searchTerms) {
        if (!this.isRunning || (maxCompanies && this.stats.total >= maxCompanies)) {
          break;
        }

        let offset = startFrom;
        let hasMore = true;

        while (hasMore && this.isRunning) {
          if (maxCompanies && this.stats.total >= maxCompanies) {
            break;
          }

          try {
            console.log(`🔍 Searching: "${term}" (offset: ${offset})`);
            
            const results = await companiesHouse.searchCompanies(term, {
              items_per_page: batchSize,
              start_index: offset
            });

            if (!results.companies || results.companies.length === 0) {
              console.log(`✅ No more results for "${term}"`);
              hasMore = false;
              break;
            }

            console.log(`📦 Processing batch of ${results.companies.length} companies...`);
            
            for (const company of results.companies) {
              if (!this.isRunning || (maxCompanies && this.stats.total >= maxCompanies)) {
                break;
              }

              // Debug: Log company structure
              if (this.stats.total === 0) {
                console.log('📋 Sample company structure:', JSON.stringify(company, null, 2).substring(0, 500));
              }

              await this.importSingleCompany(company, enrichWithContacts);
              this.stats.total++;

              if (this.stats.total % 50 === 0) {
                this.logProgress();
              }
            }

            if (results.companies.length < batchSize) {
              hasMore = false;
            } else {
              offset += batchSize;
            }

            if (this.isRunning && hasMore) {
              await this.sleep(delayBetweenBatches);
            }

          } catch (error) {
            console.error('❌ Batch error:', error.message);
            
            if (error.message.includes('rate limit') || error.message.includes('429')) {
              console.log('⏳ Rate limited - waiting 60 seconds...');
              await this.sleep(60000);
            } else {
              await this.sleep(10000);
            }
          }
        }
      }

      this.stats.endTime = new Date();
      this.isRunning = false;
      this.logFinalStats();
      return this.stats;

    } catch (error) {
      console.error('❌ Fatal import error:', error);
      this.stats.endTime = new Date();
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Import single company with duplicate checking
   */
  async importSingleCompany(companyData, enrichWithContacts = false) {
    // Get company number - handle both API formats
    const companyNumber = companyData.company_number || companyData.registrationNumber || companyData.id;

    if (!companyNumber) {
      console.warn('⚠️ Company has no number:', companyData);
      this.stats.failed++;
      return;
    }

    try {
      // Check if exists and is recent
      const existing = await companyRepository.getCompanyByNumber(companyNumber);
      const isRecent = existing && this.isRecent(existing.last_updated, 7);

      if (isRecent) {
        this.stats.skipped++;
        return existing;
      }

      // Get full details
      const fullDetails = await companiesHouse.getCompanyDetails(companyNumber);
      const companyRecord = this.mapCompanyData(fullDetails);

      // Upsert (prevents duplicates automatically)
      const savedCompany = await companyRepository.upsertCompany(companyRecord);

      if (existing) {
        this.stats.updated++;
      } else {
        this.stats.imported++;
      }

      // Get officers
      try {
        const officers = await companiesHouse.getOfficers(companyNumber);
        if (officers && officers.items) {
          for (const officer of officers.items.slice(0, 10)) {
            try {
              await companyRepository.addOfficer(savedCompany.id, {
                name: officer.name,
                role: officer.officer_role,
                appointed_date: officer.appointed_on,
                resigned_date: officer.resigned_on,
                nationality: officer.nationality,
                date_of_birth: officer.date_of_birth ? 
                  `${officer.date_of_birth.year}-${String(officer.date_of_birth.month).padStart(2, '0')}-01` : null,
                occupation: officer.occupation,
                address: officer.address ? 
                  `${officer.address.premises || ''} ${officer.address.address_line_1 || ''}`.trim() : null
              });
            } catch (e) {
              // Officer might already exist or other error
            }
          }
        }
      } catch (error) {
        // Officers endpoint might fail - not critical
      }

      // Enrich with contacts if requested
      if (enrichWithContacts) {
        await this.enrichCompanyContacts(savedCompany);
      }

      return savedCompany;

    } catch (error) {
      console.error(`❌ Error importing ${companyNumber}:`, error.message);
      this.stats.failed++;
      throw error;
    }
  }

  /**
   * Enrich with Google Places and web scraping
   */
  async enrichCompanyContacts(company) {
    try {
      if (!company.name || !company.locality) return;

      const placesData = await googlePlacesService.searchPlace(company.name, company.locality);
      
      if (placesData) {
        // Add website (prevents duplicates via ON CONFLICT)
        if (placesData.website) {
          try {
            await companyRepository.addContact(company.id, {
              contact_type: 'website',
              value: placesData.website,
              label: 'official',
              source: 'google_places',
              verified: true
            });

            // Scrape for additional contacts
            const scraped = await webScraperService.scrapeWebsite(placesData.website);
            
            for (const email of scraped.emails.slice(0, 5)) {
              try {
                await companyRepository.addContact(company.id, {
                  contact_type: 'email',
                  value: email,
                  label: 'scraped',
                  source: placesData.website,
                  verified: false
                });
              } catch (e) {
                // Duplicate contact - skip
              }
            }

            for (const phone of scraped.phones.slice(0, 3)) {
              try {
                await companyRepository.addContact(company.id, {
                  contact_type: 'phone',
                  value: phone,
                  label: 'scraped',
                  source: placesData.website,
                  verified: false
                });
              } catch (e) {
                // Duplicate contact - skip
              }
            }
          } catch (e) {
            // Scraping failed - not critical
          }
        }

        // Add phone from Google
        if (placesData.formatted_phone_number) {
          try {
            await companyRepository.addContact(company.id, {
              contact_type: 'phone',
              value: placesData.formatted_phone_number,
              label: 'official',
              source: 'google_places',
              verified: true
            });
          } catch (e) {
            // Duplicate - skip
          }
        }
      }
    } catch (error) {
      // Enrichment failed - not critical
    }
  }

  mapCompanyData(data) {
    const address = data.registered_office_address || data.addressParsed || {};
    
    return {
      company_number: data.company_number || data.registrationNumber || data.id,
      name: data.company_name || data.name || data.title,
      legal_name: data.company_name || data.name || data.title,
      jurisdiction: 'gb',
      company_type: data.type || data.company_type,
      status: data.company_status || data.status,
      incorporation_date: data.date_of_creation || data.incorporationDate,
      address_line_1: address.address_line_1 || address.line1,
      address_line_2: address.address_line_2 || address.line2,
      locality: address.locality,
      region: address.region,
      postal_code: address.postal_code || address.postalCode,
      country: address.country || 'United Kingdom',
      description: data.sic_codes ? `SIC: ${data.sic_codes.join(', ')}` : null,
      industry: this.mapSicToIndustry(data.sic_codes),
      data_source: 'companies_house'
    };
  }

  mapSicToIndustry(sicCodes) {
    if (!sicCodes || sicCodes.length === 0) return null;
    
    const industryMap = {
      '62': 'Technology', '63': 'Technology',
      '70': 'Professional Services', '71': 'Professional Services', '72': 'Professional Services',
      '46': 'Wholesale Trade', '47': 'Retail Trade',
      '56': 'Food & Beverage', '68': 'Real Estate',
      '64': 'Financial Services', '65': 'Financial Services', '66': 'Financial Services',
      '41': 'Construction', '42': 'Construction', '43': 'Construction'
    };

    const firstCode = sicCodes[0].substring(0, 2);
    return industryMap[firstCode] || 'Other';
  }

  getSearchTerms() {
    return [
      'limited', 'ltd', 'plc', 'company', 'group', 'holdings',
      'partners', 'services', 'consulting', 'technology', 'solutions',
      'international', 'trading', 'properties', 'developments',
      'investments', 'management', 'enterprises'
    ];
  }

  isRecent(lastUpdated, daysThreshold) {
    if (!lastUpdated) return false;
    const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < daysThreshold;
  }

  logProgress() {
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const rate = this.stats.total / (elapsed / 1000 / 60);
    
    console.log(`\n📊 Progress:
    Total: ${this.stats.total} | ✅ New: ${this.stats.imported} | 🔄 Updated: ${this.stats.updated} | ⏭️ Skipped: ${this.stats.skipped} | ❌ Failed: ${this.stats.failed}
    ⚡ Rate: ${rate.toFixed(1)}/min | ⏱️ Time: ${this.formatDuration(elapsed)}`);
  }

  logFinalStats() {
    const duration = this.stats.endTime - this.stats.startTime;
    
    console.log(`\n\n🎉 Import Complete!
    ==========================================
    📊 Total Processed: ${this.stats.total}
    ✅ New Companies: ${this.stats.imported}
    🔄 Updated Companies: ${this.stats.updated}
    ⏭️ Skipped (recent): ${this.stats.skipped}
    ❌ Failed: ${this.stats.failed}
    ⏱️ Duration: ${this.formatDuration(duration)}
    ⚡ Rate: ${(this.stats.total / (duration / 1000 / 60)).toFixed(1)}/min
    ==========================================\n`);
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    console.log('\n🛑 Stopping import...');
    this.isRunning = false;
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      rate: this.stats.startTime ? 
        this.stats.total / ((Date.now() - this.stats.startTime.getTime()) / 1000 / 60) : 0
    };
  }
}

module.exports = new BulkImportService();
