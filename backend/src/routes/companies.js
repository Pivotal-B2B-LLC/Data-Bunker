/**
 * Companies API Route
 * Endpoint: /api/companies
 * 
 * AUTOMATICALLY USES DATABASE when API keys are not configured
 * No API keys needed if you have data in your database!
 */

const express = require('express');
const router = express.Router();
const companiesHouse = require('../services/companiesHouse');
const openCorporates = require('../services/openCorporates');
const googlePlaces = require('../services/googlePlacesService');
const companyRepository = require('../models/companyRepository');

// Check if API keys are available
const HAS_API_KEYS = !!(process.env.COMPANIES_HOUSE_API_KEY || process.env.OPENCORPORATES_API_KEY);

/**
 * GET /api/companies/test
 * Test Companies House API connectivity
 */
router.get('/test', async (req, res) => {
  try {
    console.log('[TEST] Testing Companies House API...');
    
    // Test with a known UK company (e.g., "TESCO")
    const result = await companiesHouse.searchCompanies('TESCO', { limit: 5 });
    
    console.log('[TEST] Companies House API test successful:', {
      companiesFound: result.companies.length,
      total: result.total
    });
    
    res.json({
      success: true,
      message: 'Companies House API is working correctly',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[TEST] Companies House API test failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/companies/:companyNumber
 * Get detailed company information
 * 
 * Parameters:
 *   - companyNumber (required): company registration number
 *   - country (required): 2-letter country code
 * 
 * Example:
 *   GET /api/companies/03404908?country=gb
 */
router.get('/:companyNumber', async (req, res) => {
  try {
    const { companyNumber } = req.params;
    const { country } = req.query;

    console.log(`[COMPANY DETAILS] Request for ${companyNumber} (${country || 'not specified'})`);
    console.log(`[COMPANY DETAILS] API Keys Available: ${HAS_API_KEYS ? 'Yes' : 'No (using database)'}`);

    // If no API keys, try database first
    if (!HAS_API_KEYS) {
      console.log('[COMPANY DETAILS] No API keys configured - checking database');
      try {
        const company = await companyRepository.getCompanyByNumber(companyNumber);
        
        if (company) {
          console.log('[COMPANY DETAILS] Found in database');
          return res.json({
            success: true,
            source: 'database',
            data: company,
            message: 'Retrieved from local database. To use external APIs, add API keys to .env file.'
          });
        } else {
          console.log('[COMPANY DETAILS] Not found in database');
          return res.status(404).json({
            success: false,
            error: 'Company not found in database',
            message: 'To search external APIs, add API keys to .env file.',
            companyNumber
          });
        }
      } catch (dbError) {
        console.error('[COMPANY DETAILS] Database error:', dbError.message);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          details: dbError.message
        });
      }
    }

    // If API keys available, use external APIs
    if (!country) {
      return res.status(400).json({
        error: 'Country parameter is required when using external APIs'
      });
    }

    if (!companyNumber) {
      return res.status(400).json({
        error: 'Company number is required'
      });
    }

    let companyDetails = {};

    if (country.toLowerCase() === 'gb' || country.toLowerCase() === 'uk') {
      console.log('[COMPANY DETAILS] Using Companies House API');
      companyDetails = await companiesHouse.getCompanyDetails(companyNumber);
      console.log('[COMPANY DETAILS] Successfully retrieved from Companies House');
    } else {
      console.log('[COMPANY DETAILS] Using OpenCorporates API');
      companyDetails = await openCorporates.getCompanyDetails(companyNumber, country);
      console.log('[COMPANY DETAILS] Successfully retrieved from OpenCorporates');
    }

    // Enrich with Google Places data for contact information
    try {
      console.log('[COMPANY DETAILS] Enriching with Google Places data...');
      const enrichedData = await googlePlaces.enrichCompanyData(
        companyDetails.name,
        companyDetails.registeredOffice?.full
      );
      
      if (enrichedData) {
        console.log('[COMPANY DETAILS] Successfully enriched with contact info');
        companyDetails.contactInfo = enrichedData;
      }
    } catch (error) {
      console.warn('[COMPANY DETAILS] Could not enrich with Places data:', error.message);
    }

    res.json({
      success: true,
      data: companyDetails
    });
  } catch (error) {
    console.error('[COMPANY DETAILS ERROR]', {
      message: error.message,
      stack: error.stack,
      companyNumber: req.params.companyNumber,
      country: req.query.country
    });
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Company not found',
        type: 'not_found',
        details: error.message
      });
    }

    if (error.message.includes('Unauthorized') || error.message.includes('API key')) {
      return res.status(401).json({
        success: false,
        error: 'API authentication failed',
        type: 'auth_error',
        details: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      type: 'company_details_error'
    });
  }
});

/**
 * GET /api/companies/:companyNumber/officers
 * Get company officers/directors
 * 
 * Parameters:
 *   - companyNumber (required): company registration number
 *   - country (required): 2-letter country code
 * 
 * Example:
 *   GET /api/companies/03404908/officers?country=gb
 */
router.get('/:companyNumber/officers', async (req, res) => {
  try {
    const { companyNumber } = req.params;
    const { country } = req.query;

    if (!country) {
      return res.status(400).json({
        error: 'Country parameter is required'
      });
    }

    if (country !== 'gb' && country !== 'uk') {
      return res.status(400).json({
        success: false,
        error: 'Officers information only available for UK companies',
        type: 'invalid_country'
      });
    }

    console.log(`[COMPANY OFFICERS] Request for ${companyNumber}`);

    const officers = await companiesHouse.getCompanyOfficers(companyNumber);
    
    console.log('[COMPANY OFFICERS] Successfully retrieved officers');

    res.json({
      success: true,
      data: officers
    });
  } catch (error) {
    console.error('[COMPANY OFFICERS ERROR]', {
      message: error.message,
      companyNumber: req.params.companyNumber
    });
    
    res.status(500).json({
      success: false,
      error: error.message,
      type: 'officers_error'
    });
  }
});

module.exports = router;
