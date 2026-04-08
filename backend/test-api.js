/**
 * Companies House API Test Script
 * 
 * Usage:
 *   node test-api.js
 * 
 * Make sure your .env file has:
 *   COMPANIES_HOUSE_API_KEY=your_api_key_here
 */

require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = 'https://api.company-information.service.gov.uk';

// Encode API key for Basic Auth
const auth = Buffer.from(`${API_KEY}:`).toString('base64');

console.log('\n=== Companies House API Test ===\n');

if (!API_KEY) {
  console.error('❌ ERROR: COMPANIES_HOUSE_API_KEY not found in .env file');
  console.error('Please add your API key to backend/.env');
  process.exit(1);
}

console.log('✓ API Key found:', API_KEY.substring(0, 8) + '...');
console.log('✓ Base URL:', BASE_URL);
console.log('✓ Auth Header: Basic', auth.substring(0, 20) + '...\n');

// Test 1: Search for companies
async function testSearch() {
  console.log('Test 1: Searching for "TESCO"...');
  try {
    const response = await axios.get(`${BASE_URL}/search/companies`, {
      params: {
        q: 'TESCO',
        items_per_page: 5
      },
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    console.log('✅ Search successful!');
    console.log(`   Found ${response.data.items?.length || 0} companies`);
    console.log(`   Total results: ${response.data.total_results}`);
    
    if (response.data.items && response.data.items.length > 0) {
      const first = response.data.items[0];
      console.log(`   First result: ${first.title} (${first.company_number})`);
      return first.company_number;
    }
  } catch (error) {
    console.error('❌ Search failed:', error.response?.status, error.response?.data);
    throw error;
  }
}

// Test 2: Get company details
async function testCompanyDetails(companyNumber) {
  console.log(`\nTest 2: Getting details for company ${companyNumber}...`);
  try {
    const response = await axios.get(`${BASE_URL}/company/${companyNumber}`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    console.log('✅ Company details retrieved!');
    console.log(`   Name: ${response.data.company_name}`);
    console.log(`   Status: ${response.data.company_status}`);
    console.log(`   Type: ${response.data.type}`);
    console.log(`   Incorporation date: ${response.data.date_of_creation}`);
    console.log(`   SIC codes: ${response.data.sic_codes?.join(', ') || 'None'}`);
  } catch (error) {
    console.error('❌ Company details failed:', error.response?.status, error.response?.data);
    throw error;
  }
}

// Test 3: Get company officers
async function testOfficers(companyNumber) {
  console.log(`\nTest 3: Getting officers for company ${companyNumber}...`);
  try {
    const response = await axios.get(`${BASE_URL}/company/${companyNumber}/officers`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    console.log('✅ Officers retrieved!');
    console.log(`   Active count: ${response.data.active_count || 0}`);
    console.log(`   Total count: ${response.data.total_results || 0}`);
    
    if (response.data.items && response.data.items.length > 0) {
      console.log(`   First officer: ${response.data.items[0].name}`);
      console.log(`   Role: ${response.data.items[0].officer_role}`);
    }
  } catch (error) {
    console.error('❌ Officers retrieval failed:', error.response?.status, error.response?.data);
    throw error;
  }
}

// Run all tests
(async () => {
  try {
    const companyNumber = await testSearch();
    if (companyNumber) {
      await testCompanyDetails(companyNumber);
      await testOfficers(companyNumber);
    }
    
    console.log('\n✅ All tests passed!\n');
    console.log('Your Companies House API integration is working correctly.');
    console.log('You can now start the backend server with: npm start\n');
  } catch (error) {
    console.log('\n❌ Tests failed!\n');
    console.log('Common issues:');
    console.log('  1. Invalid API key - check your .env file');
    console.log('  2. Network connectivity issues');
    console.log('  3. Rate limiting - wait a moment and try again\n');
    process.exit(1);
  }
})();
