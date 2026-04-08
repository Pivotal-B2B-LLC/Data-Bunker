/**
 * Web Tracking Service - Automated company data discovery and updates
 */

const companyRepository = require('../models/companyRepository');
const webScraper = require('./webScraperService');
const googlePlaces = require('./googlePlacesService');
const companiesHouse = require('./companiesHouse');
const openCorporates = require('./openCorporates');

class WebTrackingService {
  constructor() {
    this.isRunning = false;
    this.trackingInterval = null;
  }

  /**
   * Start automated tracking
   */
  async startTracking(options = {}) {
    if (this.isRunning) {
      console.log('⚠️ Tracking already running');
      return;
    }

    this.isRunning = true;
    console.log('🔍 Starting web tracking service...');

    const {
      interval = 3600000, // 1 hour
      batchSize = 50,
      maxAge = 30 // days
    } = options;

    // Initial run
    await this.trackStaleCompanies(batchSize, maxAge);

    // Schedule recurring tracking
    this.trackingInterval = setInterval(async () => {
      await this.trackStaleCompanies(batchSize, maxAge);
    }, interval);

    console.log(`✅ Tracking service started (interval: ${interval}ms)`);
  }

  /**
   * Stop tracking
   */
  stopTracking() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Tracking service stopped');
  }

  /**
   * Track companies that haven't been updated recently
   */
  async trackStaleCompanies(batchSize = 50, maxAge = 30) {
    try {
      console.log(`🔄 Fetching stale companies (older than ${maxAge} days)...`);
      
      const companies = await companyRepository.getStaleCompanies(maxAge, batchSize);
      
      if (companies.length === 0) {
        console.log('✅ All companies are up to date!');
        return;
      }

      console.log(`📊 Found ${companies.length} companies to update`);

      for (const company of companies) {
        try {
          await this.updateCompanyData(company);
          await this.sleep(1000); // Rate limiting
        } catch (error) {
          console.error(`❌ Error updating ${company.company_number}:`, error.message);
        }
      }

      console.log(`✅ Completed tracking batch of ${companies.length} companies`);
    } catch (error) {
      console.error('❌ Error in tracking service:', error);
    }
  }

  /**
   * Update a single company's data
   */
  async updateCompanyData(company) {
    console.log(`🔍 Updating ${company.name} (${company.company_number})...`);

    try {
      let updatedData = {};
      
      // 1. Refresh from official API
      if (company.jurisdiction === 'gb') {
        try {
          const chData = await companiesHouse.getCompanyDetails(company.company_number);
          updatedData = this.mapCompaniesHouseData(chData);
        } catch (err) {
          console.warn(`⚠️ Companies House API error:`, err.message);
        }
      }

      // 2. Enrich with Google Places
      if (company.name) {
        try {
          const placesData = await googlePlaces.searchPlace(company.name, company.locality);
          if (placesData && placesData.place_id) {
            const details = await googlePlaces.getPlaceDetails(placesData.place_id);
            if (details) {
              updatedData.website = updatedData.website || details.website;
              updatedData.phone = updatedData.phone || details.formatted_phone_number;
            }
          }
        } catch (err) {
          console.warn(`⚠️ Google Places error:`, err.message);
        }
      }

      // 3. Scrape website for additional contact info
      if (updatedData.website || company.website) {
        const websiteUrl = updatedData.website || company.website;
        try {
          const scrapedData = await webScraper.scrapeCompanyWebsite(websiteUrl);
          
          if (scrapedData && company.id) {
            // Add emails
            for (const email of (scrapedData.emails || [])) {
              try {
                await companyRepository.addContact(company.id, {
                  contact_type: 'email',
                  value: email,
                  label: 'scraped',
                  source: websiteUrl,
                  verified: false
                });
              } catch (e) {
                // Contact might already exist
              }
            }

            // Add phones
            for (const phone of (scrapedData.phones || [])) {
              try {
                await companyRepository.addContact(company.id, {
                  contact_type: 'phone',
                  value: phone,
                  label: 'scraped',
                  source: websiteUrl,
                  verified: false
                });
              } catch (e) {
                // Contact might already exist
              }
            }

            // Log successful scraping
            await companyRepository.logTracking(company.id, {
              url: websiteUrl,
              data_found: scrapedData,
              status: 'success'
            });
          }

        } catch (scrapeError) {
          console.warn(`⚠️ Could not scrape ${websiteUrl}:`, scrapeError.message);
          
          if (company.id) {
            await companyRepository.logTracking(company.id, {
              url: websiteUrl,
              status: 'failed',
              error_message: scrapeError.message
            });
          }
        }
      }

      // 4. Update company in database
      await companyRepository.upsertCompany({
        ...company,
        ...updatedData,
        company_number: company.company_number
      });

      console.log(`✅ Updated ${company.name}`);

    } catch (error) {
      console.error(`❌ Failed to update ${company.name}:`, error.message);
    }
  }

  /**
   * Discover new companies in a location
   */
  async discoverCompaniesInLocation(country, region = null, locality = null) {
    console.log(`🌍 Discovering companies in ${locality || region || country}...`);

    try {
      let companies = [];

      if (country === 'United Kingdom' || country === 'GB' || country === 'gb') {
        const searchQuery = locality || region || 'active';
        const results = await companiesHouse.searchCompanies(searchQuery, { limit: 100 });
        companies = results.companies || [];
      } else {
        const ocCountry = this.getOCJurisdiction(country);
        if (ocCountry) {
          const results = await openCorporates.searchCompanies('company', { country: ocCountry, limit: 100 });
          companies = results.companies || [];
        }
      }

      console.log(`📊 Found ${companies.length} companies to add`);

      let addedCount = 0;
      for (const companyData of companies) {
        try {
          const mapped = (country === 'GB' || country === 'United Kingdom')
            ? this.mapCompaniesHouseData(companyData)
            : this.mapOpenCorporatesData(companyData);

          await companyRepository.upsertCompany(mapped);
          addedCount++;
        } catch (error) {
          console.error('Error adding company:', error.message);
        }
      }

      console.log(`✅ Discovered and stored ${addedCount} companies`);
      return addedCount;

    } catch (error) {
      console.error('❌ Discovery error:', error);
      return 0;
    }
  }

  /**
   * Map Companies House data to our schema
   */
  mapCompaniesHouseData(data) {
    const address = data.registered_office_address || data.registeredOffice || {};
    
    return {
      company_number: data.company_number || data.registrationNumber,
      name: data.company_name || data.title || data.name,
      legal_name: data.company_name || data.name,
      jurisdiction: 'gb',
      company_type: data.company_type || data.type,
      status: data.company_status || data.status,
      incorporation_date: data.date_of_creation || data.dateOfCreation || data.incorporationDate,
      address_line_1: address.address_line_1 || address.addressLine1,
      address_line_2: address.address_line_2 || address.addressLine2,
      locality: address.locality,
      region: address.region,
      postal_code: address.postal_code || address.postalCode,
      country: 'United Kingdom',
      data_source: 'companies_house'
    };
  }

  /**
   * Map OpenCorporates data to our schema
   */
  mapOpenCorporatesData(data) {
    const company = data.company || data;
    const address = company.registered_address || {};
    
    return {
      company_number: company.company_number || company.registrationNumber,
      name: company.name,
      legal_name: company.name,
      jurisdiction: company.jurisdiction_code || company.jurisdiction || 'unknown',
      company_type: company.company_type || company.type,
      status: company.current_status || company.status,
      incorporation_date: company.incorporation_date || company.incorporationDate,
      address_line_1: address.street_address,
      locality: address.locality,
      region: address.region,
      postal_code: address.postal_code,
      country: address.country,
      data_source: 'opencorporates'
    };
  }

  getOCJurisdiction(country) {
    const mapping = {
      'United States': 'us', 'USA': 'us', 'US': 'us',
      'United Kingdom': 'gb', 'UK': 'gb', 'GB': 'gb',
      'Canada': 'ca', 'CA': 'ca',
      'Australia': 'au', 'AU': 'au',
      'Germany': 'de', 'DE': 'de',
      'France': 'fr', 'FR': 'fr'
    };
    return mapping[country] || country.toLowerCase();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new WebTrackingService();
