/**
 * Simplified Company Enrichment Service
 * Works with current database schema (no enrichment tables needed)
 * Enriches companies by discovering websites and scraping contact data
 */

const { pool } = require('../db/connection');
const webScraperService = require('./webScraperService');

class SimpleEnrichmentService {
  
  /**
   * Enrich a single company - find website, email, phone
   */
  async enrichCompany(companyId) {
    const client = await pool.connect();
    
    try {
      // Get company data including officers for verification
      const result = await client.query(
        `SELECT c.id, c.company_number, c.name, c.website, c.phone, c.email, 
                c.address_line_1, c.locality, c.postal_code, c.country,
                COALESCE(
                  json_agg(
                    json_build_object('name', o.name, 'role', o.role)
                  ) FILTER (WHERE o.id IS NOT NULL),
                  '[]'
                ) as officers
         FROM companies c
         LEFT JOIN officers o ON c.id = o.company_id AND o.resigned_date IS NULL
         WHERE c.id = $1
         GROUP BY c.id`,
        [companyId]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Company not found' };
      }

      const company = result.rows[0];
      const updates = {};
      const fieldsUpdated = [];
      let verificationScore = 0;
      const verificationDetails = [];

      // Step 1: Discover and verify website if missing
      if (!company.website) {
        const discoveryResult = await this.discoverAndVerifyWebsite(company);
        if (discoveryResult.website) {
          updates.website = discoveryResult.website;
          fieldsUpdated.push('website');
          verificationScore = discoveryResult.confidence;
          verificationDetails.push(...discoveryResult.matches);
          
          console.log(`[Enrichment] ✓ Verified website: ${discoveryResult.website} (confidence: ${verificationScore}%)`);
          console.log(`[Enrichment] Matches found: ${discoveryResult.matches.join(', ')}`);
        }
      } else {
        updates.website = company.website;
      }

      // Step 2: Scrape website for contacts if we have one
      if (updates.website) {
        try {
          const scrapedData = await webScraperService.scrapeCompanyData(updates.website);
          
          if (scrapedData) {
            if (!company.email && scrapedData.email) {
              updates.email = scrapedData.email;
              fieldsUpdated.push('email');
            }
            if (!company.phone && scrapedData.phone) {
              updates.phone = scrapedData.phone;
              fieldsUpdated.push('phone');
            }
          }
        } catch (error) {
          console.log(`[Enrichment] Scraping failed for ${updates.website}: ${error.message}`);
        }
      }

      // Step 3: Update database if we found anything
      if (fieldsUpdated.length > 0) {
        await client.query(
          `UPDATE companies 
           SET website = COALESCE($1, website),
               email = COALESCE($2, email),
               phone = COALESCE($3, phone),
               last_updated = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [updates.website, updates.email, updates.phone, companyId]
        );
      }

      return {
        success: true,
        companyName: company.name,
        fieldsUpdated,
        updates,
        verificationScore,
        verificationDetails
      };

    } finally {
      client.release();
    }
  }

  /**
   * Discover and verify website by checking for company data
   * This ensures we found the CORRECT website for the company
   */
  async discoverAndVerifyWebsite(company) {
    if (!company.name) return { website: null, confidence: 0, matches: [] };

    // Get all possible company names to search
    const companyNames = this.extractCompanyNames(company.name);
    
    // Try URLs for each company name variant
    const allGuesses = [];
    
    for (const name of companyNames) {
      const cleanName = name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '');

      // Try common domain patterns
      const tld = company.country === 'England' || company.country === 'Wales' || company.country === 'Scotland' ? 'co.uk' : 'com';
      
      allGuesses.push(
        { url: `https://www.${cleanName}.${tld}`, variant: name },
        { url: `https://${cleanName}.${tld}`, variant: name },
        { url: `https://www.${cleanName}.com`, variant: name }
      );
    }

    console.log(`[Discovery] Trying ${allGuesses.length} URL variations for: ${company.name}`);

    // Try each URL and verify it contains company data
    for (const guess of allGuesses) {
      try {
        const verification = await this.verifyWebsite(guess.url, company, guess.variant);
        
        // Require at least 50 points confidence
        if (verification.isValid && verification.confidence >= 50) {
          return {
            website: guess.url,
            confidence: verification.confidence,
            matches: verification.matches,
            tradingName: guess.variant !== company.name ? guess.variant : null
          };
        }
      } catch (error) {
        // Try next URL
        continue;
      }
    }

    return { website: null, confidence: 0, matches: [] };
  }

  /**
   * Extract all possible company names/trading names
   * Many companies operate under alternative names
   */
  extractCompanyNames(fullName) {
    const names = [fullName]; // Original name
    
    // Remove common suffixes to get trading name
    const tradingName = fullName
      .replace(/\s+LTD$/i, '')
      .replace(/\s+LIMITED$/i, '')
      .replace(/\s+PLC$/i, '')
      .replace(/\s+LLC$/i, '')
      .replace(/\s+INC$/i, '')
      .replace(/\s+\(UK\)$/i, '')
      .trim();
    
    if (tradingName !== fullName) {
      names.push(tradingName);
    }

    // Extract first significant word(s) for brand name
    const words = tradingName.split(/\s+/);
    if (words.length >= 2) {
      // Try first word (e.g., "TESCO" from "TESCO STORES LIMITED")
      names.push(words[0]);
      
      // Try first two words (e.g., "MARKS SPENCER" from "MARKS AND SPENCER PLC")
      names.push(`${words[0]} ${words[1]}`);
    }

    // Remove duplicates and short names (< 3 chars)
    return [...new Set(names)].filter(name => name.length >= 3);
  }

  /**
   * Verify a website contains the company's registration number, address, or officers
   * This confirms it's the RIGHT website for this company
   */
  async verifyWebsite(url, company) {
    const axios = require('axios');
    const cheerio = require('cheerio');
    
    try {
      // Fetch the website
      const response = await axios.get(url, {
        timeout: 5000,
        maxRedirects: 3,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DataBunkerBot/1.0)'
        }
      });

      if (response.status >= 400) {
        return { isValid: false, confidence: 0, matches: [] };
      }

      const html = response.data.toLowerCase();
      const $ = cheerio.load(response.data);
      const bodyText = $('body').text().toLowerCase();
      
      let confidence = 0;
      const matches = [];

      // Check 1: Company registration number (HIGHEST confidence - 70 points)
      const companyNumber = company.company_number.replace(/\s/g, '');
      if (html.includes(companyNumber.toLowerCase()) || 
          bodyText.includes(companyNumber.toLowerCase())) {
        confidence += 70;
        matches.push('company_number');
        console.log(`[Verification] ✓ Found company number: ${companyNumber}`);
      }

      // Check 2: Domain name matches company name (30 points)
      const urlDomain = new URL(url).hostname.replace('www.', '').split('.')[0];
      const companyNameClean = company.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      
      if (urlDomain === companyNameClean || 
          companyNameClean.includes(urlDomain) || 
          urlDomain.includes(companyNameClean)) {
        confidence += 30;
        matches.push('domain_match');
        console.log(`[Verification] ✓ Domain matches company name: ${urlDomain}`);
      }

      // Check 3: Full address match (40 points)
      if (company.address_line_1 && company.postal_code) {
        const address = company.address_line_1.toLowerCase();
        const postcode = company.postal_code.toLowerCase().replace(/\s/g, '');
        
        if (bodyText.includes(address) && bodyText.includes(postcode)) {
          confidence += 40;
          matches.push('full_address');
          console.log(`[Verification] ✓ Found full address`);
        } else if (bodyText.includes(postcode)) {
          // Partial: just postcode (20 points)
          confidence += 20;
          matches.push('postcode');
          console.log(`[Verification] ✓ Found postcode: ${postcode}`);
        }
      }

      // Check 3: Officer names (30 points max, 15 per officer)
      if (company.officers && Array.isArray(company.officers) && company.officers.length > 0) {
        let officerMatches = 0;
        
        for (const officer of company.officers) {
          if (officer.name) {
            const officerName = officer.name.toLowerCase();
            // Check for last name (more reliable than full name)
            const nameParts = officerName.split(/\s+/);
            const lastName = nameParts[nameParts.length - 1];
            
            if (lastName.length > 3 && bodyText.includes(lastName)) {
              officerMatches++;
              console.log(`[Verification] ✓ Found officer: ${lastName}`);
            }
          }
        }
        
        if (officerMatches > 0) {
          confidence += Math.min(30, officerMatches * 15);
          matches.push(`${officerMatches}_officers`);
        }
      }

      // Check 4: Company name exact match (10 points bonus)
      const exactCompanyName = company.name.toLowerCase();
      if (bodyText.includes(exactCompanyName)) {
        confidence += 10;
        matches.push('company_name');
      }

      // Minimum threshold: 50 points (lowered to catch trading names + domain match)
      return {
        isValid: confidence >= 50,
        confidence: Math.min(100, confidence),
        matches
      };

    } catch (error) {
      return { isValid: false, confidence: 0, matches: [] };
    }
  }

  /**
   * Get enrichment statistics
   */
  async getStats() {
    const client = await pool.connect();
    
    try {
      const stats = await client.query(`
        SELECT 
          COUNT(*) as total_companies,
          COUNT(website) as companies_with_website,
          COUNT(email) as companies_with_email,
          COUNT(phone) as companies_with_phone,
          COUNT(CASE WHEN website IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL THEN 1 END) as companies_enriched,
          COUNT(CASE WHEN website IS NULL AND email IS NULL AND phone IS NULL THEN 1 END) as companies_needing_enrichment
        FROM companies
        WHERE jurisdiction = 'gb'
      `);

      return {
        success: true,
        data: stats.rows[0]
      };

    } finally {
      client.release();
    }
  }

  /**
   * Enrich a batch of companies
   */
  async enrichBatch(limit = 10) {
    const client = await pool.connect();
    
    try {
      // Get companies that need enrichment
      const result = await client.query(`
        SELECT id FROM companies 
        WHERE jurisdiction = 'gb'
          AND (website IS NULL OR email IS NULL OR phone IS NULL)
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);

      const results = {
        total: result.rows.length,
        successful: 0,
        failed: 0,
        details: []
      };

      for (const row of result.rows) {
        try {
          const enrichResult = await this.enrichCompany(row.id);
          if (enrichResult.success) {
            results.successful++;
          } else {
            results.failed++;
          }
          results.details.push(enrichResult);
        } catch (error) {
          results.failed++;
          results.details.push({ success: false, error: error.message });
        }
      }

      return {
        success: true,
        ...results
      };

    } finally {
      client.release();
    }
  }
}

module.exports = new SimpleEnrichmentService();
