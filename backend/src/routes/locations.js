/**
 * Locations API Route
 * Endpoint: /api/locations
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Try multiple possible paths for the locations data
let locationsData;
const possiblePaths = [
  path.join(__dirname, '../../../data/locations/index.json'),
  path.join(__dirname, '../../data/locations/index.json'),
  path.join(process.cwd(), 'data/locations/index.json')
];

for (const jsonPath of possiblePaths) {
  try {
    if (fs.existsSync(jsonPath)) {
      locationsData = require(jsonPath);
      console.log(`✅ Loaded locations data from: ${jsonPath}`);
      break;
    }
  } catch (err) {
    continue;
  }
}

if (!locationsData) {
  console.error('❌ Could not find locations data file');
  // Fallback to minimal data structure
  locationsData = { countries: [] };
}

/**
 * GET /api/locations/countries
 * Get all supported countries
 */
router.get('/countries', (req, res) => {
  try {
    const countries = locationsData.countries.map(country => ({
      code: country.code,
      name: country.name,
      region: country.region,
      dataSource: country.dataSource
    }));

    res.json({
      success: true,
      data: countries
    });
  } catch (error) {
    console.error('[LOCATIONS ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'locations_error'
    });
  }
});

/**
 * GET /api/locations/countries/:countryCode/states
 * Get states/provinces for a country
 */
router.get('/countries/:countryCode/states', (req, res) => {
  try {
    const { countryCode } = req.params;
    const country = locationsData.countries.find(c => c.code === countryCode.toLowerCase());

    if (!country) {
      return res.status(404).json({
        error: 'Country not found',
        supportedCountries: locationsData.countries.map(c => c.code)
      });
    }

    const states = country.states.map(state => ({
      code: state.code,
      name: state.name
    }));

    res.json({
      success: true,
      country: country.name,
      data: states
    });
  } catch (error) {
    console.error('[STATES ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'states_error'
    });
  }
});

/**
 * GET /api/locations/countries/:countryCode/states/:stateCode/cities
 * Get cities for a state/province
 */
router.get('/countries/:countryCode/states/:stateCode/cities', (req, res) => {
  try {
    const { countryCode, stateCode } = req.params;
    const country = locationsData.countries.find(c => c.code === countryCode.toLowerCase());

    if (!country) {
      return res.status(404).json({
        error: 'Country not found'
      });
    }

    const state = country.states.find(s => s.code === stateCode.toLowerCase());

    if (!state) {
      return res.status(404).json({
        error: 'State not found',
        availableStates: country.states.map(s => s.code)
      });
    }

    const cities = state.cities.map(city => ({
      name: city.name
    }));

    res.json({
      success: true,
      country: country.name,
      state: state.name,
      data: cities
    });
  } catch (error) {
    console.error('[CITIES ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'cities_error'
    });
  }
});

/**
 * GET /api/locations/countries/:countryCode/states/:stateCode/cities/:cityName/districts
 * Get districts for a city
 */
router.get('/countries/:countryCode/states/:stateCode/cities/:cityName/districts', (req, res) => {
  try {
    const { countryCode, stateCode, cityName } = req.params;
    const country = locationsData.countries.find(c => c.code === countryCode.toLowerCase());

    if (!country) {
      return res.status(404).json({
        error: 'Country not found'
      });
    }

    const state = country.states.find(s => s.code === stateCode.toLowerCase());

    if (!state) {
      return res.status(404).json({
        error: 'State not found'
      });
    }

    const city = state.cities.find(c => c.name.toLowerCase() === cityName.toLowerCase());

    if (!city) {
      return res.status(404).json({
        error: 'City not found',
        availableCities: state.cities.map(c => c.name)
      });
    }

    res.json({
      success: true,
      country: country.name,
      state: state.name,
      city: city.name,
      data: city.districts || []
    });
  } catch (error) {
    console.error('[DISTRICTS ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'districts_error'
    });
  }
});

/**
 * GET /api/locations/industries
 * Get all supported industries
 */
router.get('/industries', (req, res) => {
  try {
    const industries = [
      'Accounting',
      'Agriculture',
      'Airlines/Aviation',
      'Alternative Dispute Resolution',
      'Alternative Medicine',
      'Animation',
      'Apparel & Fashion',
      'Architecture & Planning',
      'Arts & Crafts',
      'Automotive',
      'Aviation & Aerospace',
      'Banking',
      'Biotechnology',
      'Broadcast Media',
      'Building Materials',
      'Business Supplies & Equipment',
      'Capital Markets',
      'Chemicals',
      'Civic & Social Organization',
      'Civil Engineering',
      'Commercial Real Estate',
      'Computer & Network Security',
      'Computer Games',
      'Computer Hardware',
      'Computer Networking',
      'Computer Software',
      'Construction',
      'Consumer Electronics',
      'Consumer Goods',
      'Consumer Services',
      'Cosmetics',
      'Dairy',
      'Defense & Space',
      'Design',
      'E-Learning',
      'Education Management',
      'Electrical/Electronic Manufacturing',
      'Entertainment',
      'Environmental Services',
      'Events Services',
      'Executive Office',
      'Facilities Services',
      'Farming',
      'Financial Services',
      'Fine Art',
      'Fishery',
      'Food & Beverages',
      'Food Production',
      'Fund-Raising',
      'Furniture',
      'Gambling & Casinos',
      'Glass, Ceramics & Concrete',
      'Government Administration',
      'Government Relations',
      'Graphic Design',
      'Health, Wellness & Fitness',
      'Higher Education',
      'Hospital & Health Care',
      'Hospitality',
      'Human Resources',
      'Import & Export',
      'Individual & Family Services',
      'Industrial Automation',
      'Information Services',
      'Information Technology & Services',
      'Insurance',
      'International Affairs',
      'International Trade & Development',
      'Internet',
      'Investment Banking',
      'Investment Management',
      'Judiciary',
      'Law Enforcement',
      'Law Practice',
      'Legal Services',
      'Legislative Office',
      'Leisure, Travel & Tourism',
      'Libraries',
      'Logistics & Supply Chain',
      'Luxury Goods & Jewelry',
      'Machinery',
      'Management Consulting',
      'Maritime',
      'Market Research',
      'Marketing & Advertising',
      'Mechanical or Industrial Engineering',
      'Media Production',
      'Medical Devices',
      'Medical Practice',
      'Mental Health Care',
      'Military',
      'Mining & Metals',
      'Motion Pictures & Film',
      'Museums & Institutions',
      'Music',
      'Nanotechnology',
      'Newspapers',
      'Nonprofit Organization Management',
      'Oil & Energy',
      'Online Media',
      'Outsourcing/Offshoring',
      'Package/Freight Delivery',
      'Packaging & Containers',
      'Paper & Forest Products',
      'Performing Arts',
      'Pharmaceuticals',
      'Philanthropy',
      'Photography',
      'Plastics',
      'Political Organization',
      'Primary/Secondary Education',
      'Printing',
      'Professional Training & Coaching',
      'Program Development',
      'Public Policy',
      'Public Relations & Communications',
      'Public Safety',
      'Publishing',
      'Railroad Manufacture',
      'Ranching',
      'Real Estate',
      'Recreational Facilities & Services',
      'Religious Institutions',
      'Renewables & Environment',
      'Research',
      'Restaurants',
      'Retail',
      'Security & Investigations',
      'Semiconductors',
      'Shipbuilding',
      'Sporting Goods',
      'Sports',
      'Staffing & Recruiting',
      'Supermarkets',
      'Telecommunications',
      'Textiles',
      'Think Tanks',
      'Tobacco',
      'Translation & Localization',
      'Transportation/Trucking/Railroad',
      'Utilities',
      'Venture Capital & Private Equity',
      'Veterinary',
      'Warehousing',
      'Wholesale',
      'Wine & Spirits',
      'Wireless',
      'Writing & Editing'
    ];

    res.json({
      success: true,
      data: industries
    });
  } catch (error) {
    console.error('[INDUSTRIES ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'industries_error'
    });
  }
});

module.exports = router;
