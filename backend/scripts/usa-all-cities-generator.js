#!/usr/bin/env node

/**
 * USA ALL CITIES GENERATOR
 * Generates a comprehensive list of ALL US cities (20,000+)
 * This ensures we capture ALL 35 million businesses
 */

const axios = require('axios');
const fs = require('fs');

// All US states with their codes
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming'
];

async function getAllUSCities() {
  console.log('🌎 Fetching ALL US cities from OpenStreetMap...\n');

  const allCities = [];

  for (const state of US_STATES) {
    console.log(`📍 Processing: ${state}...`);

    try {
      // Query Nominatim for all cities in this state
      const query = `[out:json][timeout:60];
        area["ISO3166-2"~"US"]["name"="${state}"]->.searchArea;
        (
          node["place"~"city|town|village"](area.searchArea);
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
          state: state,
          population: el.tags.population ? parseInt(el.tags.population) : 0,
          priority: getPriority(el.tags.population, el.tags.place)
        }));

      // Remove duplicates
      const uniqueCities = Array.from(
        new Map(cities.map(c => [c.city.toLowerCase(), c])).values()
      );

      allCities.push(...uniqueCities);
      console.log(`   ✓ Found ${uniqueCities.length} cities in ${state}`);

      // Rate limiting - be nice to OSM
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`   ✗ Error processing ${state}:`, error.message);
    }
  }

  // Sort by priority and population
  allCities.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.population - a.population;
  });

  console.log(`\n✅ Total cities found: ${allCities.length.toLocaleString()}`);

  // Save to file
  const output = `// Complete list of ALL US cities (${allCities.length.toLocaleString()} cities)
// Generated on ${new Date().toISOString()}
// This covers ALL US businesses - estimated 35 million+

module.exports = ${JSON.stringify(allCities, null, 2)};
`;

  fs.writeFileSync('./usa-all-cities.js', output);
  console.log('✅ Saved to usa-all-cities.js');

  return allCities;
}

function getPriority(population, placeType) {
  const pop = parseInt(population) || 0;

  if (placeType === 'city' && pop > 500000) return 1; // Major cities
  if (placeType === 'city' && pop > 100000) return 2; // Large cities
  if (placeType === 'city' || pop > 50000) return 3;  // Cities/large towns
  if (placeType === 'town' || pop > 10000) return 4;  // Towns
  return 5; // Villages and small towns
}

// Run
getAllUSCities().then(() => {
  console.log('\n🎉 Complete! Use this file with mega-discovery-launcher.js');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
