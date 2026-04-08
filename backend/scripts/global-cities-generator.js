#!/usr/bin/env node

/**
 * GLOBAL CITIES GENERATOR
 * Generates comprehensive city lists for ALL countries
 * Target: 100+ million businesses worldwide
 */

const axios = require('axios');
const fs = require('fs');

// Priority countries (high business density)
const COUNTRIES = {
  // North America
  'United States': { code: 'US', priority: 1, estimatedBusinesses: 35000000 },
  'Canada': { code: 'CA', priority: 1, estimatedBusinesses: 1500000 },
  'Mexico': { code: 'MX', priority: 2, estimatedBusinesses: 5000000 },

  // Europe
  'United Kingdom': { code: 'GB', priority: 1, estimatedBusinesses: 6000000 },
  'Germany': { code: 'DE', priority: 1, estimatedBusinesses: 3500000 },
  'France': { code: 'FR', priority: 1, estimatedBusinesses: 4000000 },
  'Italy': { code: 'IT', priority: 1, estimatedBusinesses: 5000000 },
  'Spain': { code: 'ES', priority: 1, estimatedBusinesses: 3500000 },
  'Netherlands': { code: 'NL', priority: 1, estimatedBusinesses: 2000000 },
  'Belgium': { code: 'BE', priority: 2, estimatedBusinesses: 1000000 },
  'Switzerland': { code: 'CH', priority: 1, estimatedBusinesses: 800000 },
  'Austria': { code: 'AT', priority: 2, estimatedBusinesses: 500000 },
  'Poland': { code: 'PL', priority: 2, estimatedBusinesses: 2000000 },
  'Sweden': { code: 'SE', priority: 2, estimatedBusinesses: 1000000 },
  'Norway': { code: 'NO', priority: 2, estimatedBusinesses: 500000 },
  'Denmark': { code: 'DK', priority: 2, estimatedBusinesses: 500000 },
  'Finland': { code: 'FI', priority: 2, estimatedBusinesses: 400000 },
  'Ireland': { code: 'IE', priority: 1, estimatedBusinesses: 300000 },
  'Portugal': { code: 'PT', priority: 2, estimatedBusinesses: 1500000 },
  'Greece': { code: 'GR', priority: 2, estimatedBusinesses: 1000000 },

  // Asia-Pacific
  'China': { code: 'CN', priority: 1, estimatedBusinesses: 50000000 },
  'India': { code: 'IN', priority: 1, estimatedBusinesses: 30000000 },
  'Japan': { code: 'JP', priority: 1, estimatedBusinesses: 4000000 },
  'South Korea': { code: 'KR', priority: 1, estimatedBusinesses: 3000000 },
  'Singapore': { code: 'SG', priority: 1, estimatedBusinesses: 500000 },
  'Hong Kong': { code: 'HK', priority: 1, estimatedBusinesses: 400000 },
  'Australia': { code: 'AU', priority: 1, estimatedBusinesses: 2500000 },
  'New Zealand': { code: 'NZ', priority: 1, estimatedBusinesses: 500000 },
  'Malaysia': { code: 'MY', priority: 2, estimatedBusinesses: 1000000 },
  'Thailand': { code: 'TH', priority: 2, estimatedBusinesses: 3000000 },
  'Indonesia': { code: 'ID', priority: 2, estimatedBusinesses: 5000000 },
  'Philippines': { code: 'PH', priority: 2, estimatedBusinesses: 1000000 },
  'Vietnam': { code: 'VN', priority: 2, estimatedBusinesses: 2000000 },
  'Taiwan': { code: 'TW', priority: 1, estimatedBusinesses: 1500000 },

  // Middle East
  'United Arab Emirates': { code: 'AE', priority: 1, estimatedBusinesses: 500000 },
  'Saudi Arabia': { code: 'SA', priority: 2, estimatedBusinesses: 1000000 },
  'Israel': { code: 'IL', priority: 1, estimatedBusinesses: 500000 },
  'Turkey': { code: 'TR', priority: 2, estimatedBusinesses: 3000000 },

  // Latin America
  'Brazil': { code: 'BR', priority: 2, estimatedBusinesses: 20000000 },
  'Argentina': { code: 'AR', priority: 2, estimatedBusinesses: 2000000 },
  'Chile': { code: 'CL', priority: 2, estimatedBusinesses: 1000000 },
  'Colombia': { code: 'CO', priority: 2, estimatedBusinesses: 2000000 },
  'Peru': { code: 'PE', priority: 3, estimatedBusinesses: 1000000 },

  // Africa
  'South Africa': { code: 'ZA', priority: 2, estimatedBusinesses: 2000000 },
  'Nigeria': { code: 'NG', priority: 3, estimatedBusinesses: 3000000 },
  'Kenya': { code: 'KE', priority: 3, estimatedBusinesses: 500000 },
  'Egypt': { code: 'EG', priority: 3, estimatedBusinesses: 2000000 }
};

async function getCitiesForCountry(countryName, countryData) {
  console.log(`\n📍 Processing: ${countryName} (Est. ${countryData.estimatedBusinesses.toLocaleString()} businesses)`);

  try {
    // Query Nominatim for major cities
    const query = `[out:json][timeout:60];
      area["ISO3166-1:alpha2"="${countryData.code}"]->.searchArea;
      (
        node["place"~"city|town"]["population"](area.searchArea);
      );
      out body;`;

    const response = await axios.post('https://overpass-api.de/api/interpreter', query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 65000
    });

    const cities = response.data.elements
      .filter(el => el.tags && el.tags.name)
      .map(el => ({
        city: el.tags.name,
        country: countryName,
        population: el.tags.population ? parseInt(el.tags.population) : 0,
        priority: countryData.priority
      }))
      .filter(c => c.population > 10000); // Only cities with 10k+ population

    // Remove duplicates and sort by population
    const uniqueCities = Array.from(
      new Map(cities.map(c => [c.city.toLowerCase(), c])).values()
    );

    uniqueCities.sort((a, b) => b.population - a.population);

    console.log(`   ✓ Found ${uniqueCities.length} major cities`);
    return uniqueCities;

  } catch (error) {
    console.error(`   ✗ Error:`, error.message);
    return [];
  }
}

async function generateGlobalCities() {
  console.log('🌍 GLOBAL CITIES GENERATOR');
  console.log('=' .repeat(80));
  console.log(`Processing ${Object.keys(COUNTRIES).length} countries...`);

  const totalEstimated = Object.values(COUNTRIES).reduce((sum, c) => sum + c.estimatedBusinesses, 0);
  console.log(`Estimated total businesses: ${totalEstimated.toLocaleString()}`);

  const allCities = {};

  for (const [countryName, countryData] of Object.entries(COUNTRIES)) {
    const cities = await getCitiesForCountry(countryName, countryData);

    if (cities.length > 0) {
      allCities[countryName] = {
        code: countryData.code,
        estimatedBusinesses: countryData.estimatedBusinesses,
        cities: cities
      };
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save to file
  const output = `// Global Cities Database
// Generated on ${new Date().toISOString()}
// ${Object.keys(COUNTRIES).length} countries
// Estimated total: ${totalEstimated.toLocaleString()} businesses

module.exports = ${JSON.stringify(allCities, null, 2)};
`;

  fs.writeFileSync('./global-cities-database.js', output);

  console.log('\n' + '='.repeat(80));
  console.log('✅ COMPLETE!');
  console.log('='.repeat(80));
  console.log(`Countries processed: ${Object.keys(allCities).length}`);
  console.log(`Total cities: ${Object.values(allCities).reduce((sum, c) => sum + c.cities.length, 0).toLocaleString()}`);
  console.log(`Saved to: global-cities-database.js`);

  return allCities;
}

// Run
generateGlobalCities().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
