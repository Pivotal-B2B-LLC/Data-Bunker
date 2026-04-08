#!/usr/bin/env node

/**
 * OPENAI-POWERED US COMPANY DISCOVERY
 * 
 * Uses OpenAI to generate realistic company data for any US location
 * Usage: node discover-with-openai.js <city> <state> [limit]
 */

const OpenAI = require('openai');
const { pool } = require('../src/db/connection');

class OpenAICompanyDiscovery {
  constructor(city, state, stateCode) {
    this.city = city;
    this.state = state;
    this.stateCode = stateCode;
    this.companiesFound = 0;
    this.openai = null;
    
    // Try to initialize OpenAI if API key is available
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  /**
   * Generate LinkedIn URL for a company
   */
  generateCompanyLinkedInURL(companyName) {
    const slug = companyName.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `https://www.linkedin.com/company/${slug}`;
  }

  /**
   * Generate LinkedIn URL for a person
   */
  generatePersonLinkedInURL(firstName, lastName) {
    const slug = `${firstName}-${lastName}`.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `https://www.linkedin.com/in/${slug}`;
  }

  /**
   * Get diverse industries
   */
  getIndustries() {
    return [
      'Restaurant', 'Retail', 'Healthcare', 'Legal Services', 'Accounting',
      'Real Estate', 'Construction', 'Marketing', 'IT Services', 'Consulting',
      'Insurance', 'Financial Services', 'Architecture', 'Design', 'Photography',
      'Fitness', 'Beauty & Spa', 'Automotive', 'Home Services', 'Education',
      'Entertainment', 'Manufacturing', 'Wholesale', 'E-commerce', 'Software'
    ];
  }

  /**
   * Generate realistic email format based on contact names
   */
  inferEmailFormat(contacts, companyDomain) {
    // Common email formats
    const formats = [
      'first@domain',           // john@company.com
      'first.last@domain',      // john.smith@company.com
      'firstlast@domain',       // johnsmith@company.com
      'flast@domain',           // jsmith@company.com
      'first_last@domain',      // john_smith@company.com
      'firstl@domain',          // johns@company.com
      'lastf@domain'            // smithj@company.com
    ];
    
    // Pick a random format for this company
    const selectedFormat = formats[Math.floor(Math.random() * formats.length)];
    
    // Apply format to generate sample email
    if (contacts && contacts.length > 0) {
      const contact = contacts[0];
      const first = contact.first_name.toLowerCase();
      const last = contact.last_name.toLowerCase();
      const firstInitial = first.charAt(0);
      const lastInitial = last.charAt(0);
      
      switch(selectedFormat) {
        case 'first@domain':
          return { format: '{first}@' + companyDomain, sample: `${first}@${companyDomain}` };
        case 'first.last@domain':
          return { format: '{first}.{last}@' + companyDomain, sample: `${first}.${last}@${companyDomain}` };
        case 'firstlast@domain':
          return { format: '{first}{last}@' + companyDomain, sample: `${first}${last}@${companyDomain}` };
        case 'flast@domain':
          return { format: '{f}{last}@' + companyDomain, sample: `${firstInitial}${last}@${companyDomain}` };
        case 'first_last@domain':
          return { format: '{first}_{last}@' + companyDomain, sample: `${first}_${last}@${companyDomain}` };
        case 'firstl@domain':
          return { format: '{first}{l}@' + companyDomain, sample: `${first}${lastInitial}@${companyDomain}` };
        case 'lastf@domain':
          return { format: '{last}{f}@' + companyDomain, sample: `${last}${firstInitial}@${companyDomain}` };
        default:
          return { format: '{first}.{last}@' + companyDomain, sample: `${first}.${last}@${companyDomain}` };
      }
    }
    
    return { format: '{first}.{last}@' + companyDomain, sample: `info@${companyDomain}` };
  }

  /**
   * Generate contact email based on company format
   */
  generateContactEmail(firstName, lastName, emailFormat, companyDomain) {
    const first = firstName.toLowerCase();
    const last = lastName.toLowerCase();
    const firstInitial = first.charAt(0);
    const lastInitial = last.charAt(0);
    
    // Extract format pattern
    if (emailFormat.includes('{first}.{last}')) {
      return `${first}.${last}@${companyDomain}`;
    } else if (emailFormat.includes('{first}_{last}')) {
      return `${first}_${last}@${companyDomain}`;
    } else if (emailFormat.includes('{first}{last}')) {
      return `${first}${last}@${companyDomain}`;
    } else if (emailFormat.includes('{f}{last}')) {
      return `${firstInitial}${last}@${companyDomain}`;
    } else if (emailFormat.includes('{first}{l}')) {
      return `${first}${lastInitial}@${companyDomain}`;
    } else if (emailFormat.includes('{last}{f}')) {
      return `${last}${firstInitial}@${companyDomain}`;
    } else if (emailFormat.includes('{first}@')) {
      return `${first}@${companyDomain}`;
    }
    
    return `${first}.${last}@${companyDomain}`;
  }

  /**
   * Generate realistic contact data - Management level only
   */
  generateContacts(companyName, companySize, count = 5) {
    const contacts = [];
    
    // Management titles based on company size
    const cLevelTitles = ['CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CIO', 'CPO', 'CHRO'];
    const vpTitles = [
      'VP of Sales', 'VP of Marketing', 'VP of Operations', 'VP of Engineering',
      'VP of Finance', 'VP of Human Resources', 'VP of Product', 'VP of Business Development',
      'VP of Customer Success', 'VP of Strategy', 'VP of Technology', 'VP of Communications'
    ];
    const directorTitles = [
      'Director of Operations', 'Director of Sales', 'Director of Marketing',
      'Director of IT', 'Director of Finance', 'Director of Human Resources',
      'Director of Product Management', 'Director of Engineering', 'Director of Business Development',
      'Director of Customer Service', 'Director of Analytics', 'Director of Partnerships',
      'Director of Supply Chain', 'Director of Quality Assurance', 'Director of Legal'
    ];
    const seniorTitles = [
      'Senior Vice President', 'Executive Vice President', 'Managing Director',
      'General Manager', 'Chief of Staff', 'President', 'Executive Director'
    ];
    
    let titles = [];
    
    // More contacts for larger companies
    if (companySize === 'Large') {
      count = Math.max(count, 15); // Large companies: 15-20 contacts
      titles = [
        ...cLevelTitles.slice(0, 5), 
        ...seniorTitles.slice(0, 3), 
        ...vpTitles.slice(0, 8), 
        ...directorTitles.slice(0, 10)
      ];
    } else if (companySize === 'Medium') {
      count = Math.max(count, 10); // Medium companies: 10-12 contacts
      titles = [
        ...cLevelTitles.slice(0, 3), 
        ...seniorTitles.slice(0, 2),
        ...vpTitles.slice(0, 5), 
        ...directorTitles.slice(0, 5)
      ];
    } else {
      count = Math.max(count, 5); // Small companies: 5-7 contacts
      titles = [...cLevelTitles.slice(0, 2), ...vpTitles.slice(0, 2), ...directorTitles.slice(0, 3)];
    }
    
    const firstNames = [
      'John', 'Sarah', 'Michael', 'Emily', 'David', 'Jessica',
      'Robert', 'Jennifer', 'William', 'Amanda', 'James', 'Lisa',
      'Christopher', 'Michelle', 'Daniel', 'Stephanie', 'Matthew', 'Rachel',
      'Andrew', 'Laura', 'Thomas', 'Nicole', 'Mark', 'Karen',
      'Paul', 'Susan', 'Steven', 'Linda', 'Kevin', 'Patricia'
    ];
    
    const lastNames = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
      'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
      'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson',
      'Martin', 'Lee', 'Walker', 'Hall', 'Allen', 'Young',
      'King', 'Wright', 'Scott', 'Green', 'Adams', 'Baker'
    ];
    
    const domain = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').substring(0, 20);
    
    // Generate contacts first with varied email formats
    const tempContacts = [];
    const emailFormats = [
      '{first}.{last}@',
      '{first}_{last}@',
      '{first}{last}@',
      '{f}{last}@',
      '{first}{l}@',
      '{first}@',
      '{last}{f}@'
    ];
    
    // Generate contacts with random email formats initially
    for (let i = 0; i < Math.min(count, titles.length); i++) {
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      
      // Most employees use one format, but some might use different ones
      let formatIndex;
      if (Math.random() < 0.7) { // 70% use the primary format
        formatIndex = 0;
      } else if (Math.random() < 0.85) { // 15% use secondary format
        formatIndex = 1;
      } else { // 15% use other formats
        formatIndex = Math.floor(Math.random() * emailFormats.length);
      }
      
      tempContacts.push({ 
        first_name: firstName, 
        last_name: lastName,
        formatIndex: formatIndex
      });
    }
    
    // Count which email format is used most
    const formatCounts = {};
    tempContacts.forEach(contact => {
      formatCounts[contact.formatIndex] = (formatCounts[contact.formatIndex] || 0) + 1;
    });
    
    // Find the most common format
    let mostCommonFormatIndex = 0;
    let maxCount = 0;
    Object.keys(formatCounts).forEach(formatIdx => {
      if (formatCounts[formatIdx] > maxCount) {
        maxCount = formatCounts[formatIdx];
        mostCommonFormatIndex = parseInt(formatIdx);
      }
    });
    
    const primaryFormat = emailFormats[mostCommonFormatIndex] + domain;
    
    // Now generate contacts with proper emails based on their assigned format
    for (let i = 0; i < Math.min(count, titles.length); i++) {
      const firstName = tempContacts[i].first_name;
      const lastName = tempContacts[i].last_name;
      const title = titles[i];
      const formatToUse = emailFormats[tempContacts[i].formatIndex] + domain;
      const email = this.generateContactEmail(firstName, lastName, formatToUse, domain);
      const phone = `+1${Math.floor(Math.random() * 900 + 100)}${Math.floor(Math.random() * 900 + 100)}${Math.floor(Math.random() * 9000 + 1000)}`;
      
      // Generate personal email (alternative email)
      const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
      const personalDomain = personalDomains[Math.floor(Math.random() * personalDomains.length)];
      const personalEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${personalDomain}`;
      
      contacts.push({
        first_name: firstName,
        last_name: lastName,
        title: title,
        email: email,
        personal_email: personalEmail,
        phone: phone,
        management_level: i < 5 ? 'C-Level' : (i < 10 ? 'VP' : 'Director'),
        linkedin_url: this.generatePersonLinkedInURL(firstName, lastName)
      });
    }
    
    return { contacts, emailFormat: primaryFormat };
  }

  /**
   * Generate company size
   */
  generateCompanySize() {
    const sizes = ['Small', 'Medium', 'Large'];
    const weights = [0.5, 0.35, 0.15]; // 50% small, 35% medium, 15% large
    
    const random = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < sizes.length; i++) {
      cumulative += weights[i];
      if (random <= cumulative) {
        return sizes[i];
      }
    }
    
    return 'Medium';
  }

  /**
   * Generate realistic phone and email for company
   */
  generateCompanyContact(companyName) {
    const domain = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').substring(0, 20);
    const phone = `+1${Math.floor(Math.random() * 900 + 100)}${Math.floor(Math.random() * 900 + 100)}${Math.floor(Math.random() * 9000 + 1000)}`;
    const email = `info@${domain}.com`;
    
    return { phone, email };
  }

  /**
   * Generate companies using OpenAI
   */
  async generateCompaniesWithAI(industry, count = 5) {
    if (!this.openai) {
      console.log('⚠️  No OpenAI API key - using fallback generator');
      return this.generateCompaniesFallback(industry, count);
    }

    try {
      const prompt = `Generate ${count} realistic ${industry} companies in ${this.city}, ${this.state}. 
For each company provide:
- Company name (realistic, creative)
- City/neighborhood in ${this.city}
- Brief description
- Website URL (format: https://domain.com)
- Industry category

Return as JSON array with fields: name, city, description, website, industry`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a business data generator that creates realistic company information.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 1000
      });

      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return this.generateCompaniesFallback(industry, count);
    } catch (error) {
      console.error(`❌ OpenAI error: ${error.message}`);
      return this.generateCompaniesFallback(industry, count);
    }
  }

  /**
   * Fallback: Generate realistic companies without OpenAI
   */
  generateCompaniesFallback(industry, count = 5) {
    const companies = [];
    const neighborhoods = this.getNeighborhoods();
    
    const templates = {
      'Restaurant': ['Bistro', 'Grill', 'Kitchen', 'Cafe', 'Eatery', 'Diner'],
      'Retail': ['Shop', 'Store', 'Boutique', 'Market', 'Emporium'],
      'Healthcare': ['Medical', 'Health', 'Clinic', 'Wellness', 'Care'],
      'Legal Services': ['Law', 'Legal', 'Attorneys', 'Advocates'],
      'Accounting': ['Accounting', 'Tax', 'Financial', 'CPA'],
      'Real Estate': ['Realty', 'Properties', 'Real Estate', 'Homes'],
      'Construction': ['Construction', 'Builders', 'Contractors'],
      'Marketing': ['Marketing', 'Media', 'Creative', 'Digital'],
      'IT Services': ['Tech', 'Solutions', 'Systems', 'IT'],
      'Consulting': ['Consulting', 'Advisors', 'Partners', 'Group'],
      'Insurance': ['Insurance', 'Assurance', 'Protection'],
      'Financial Services': ['Financial', 'Investments', 'Capital'],
      'Architecture': ['Architecture', 'Design', 'Planning'],
      'Design': ['Design', 'Creative', 'Studio'],
      'Photography': ['Photography', 'Photos', 'Images', 'Studio'],
      'Fitness': ['Fitness', 'Gym', 'Training', 'Wellness'],
      'Beauty & Spa': ['Spa', 'Beauty', 'Salon', 'Wellness'],
      'Automotive': ['Auto', 'Motors', 'Automotive', 'Cars'],
      'Home Services': ['Home', 'Services', 'Repair', 'Maintenance'],
      'Education': ['Academy', 'Learning', 'Education', 'School'],
      'Entertainment': ['Entertainment', 'Events', 'Productions'],
      'Manufacturing': ['Manufacturing', 'Industries', 'Production'],
      'Wholesale': ['Wholesale', 'Distribution', 'Supply'],
      'E-commerce': ['Online', 'Digital', 'E-commerce'],
      'Software': ['Software', 'Apps', 'Solutions', 'Tech']
    };

    const prefixes = ['Elite', 'Premier', 'Golden', 'Summit', 'Metro', 'Urban', 'Apex', 'Prime', 'Central'];
    const suffixes = ['Group', 'Co.', 'Associates', 'Partners', 'Services', 'Solutions', 'Pros'];
    
    const industryTemplates = templates[industry] || ['Company', 'Business', 'Services'];
    
    for (let i = 0; i < count; i++) {
      const neighborhood = neighborhoods[i % neighborhoods.length];
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const template = industryTemplates[Math.floor(Math.random() * industryTemplates.length)];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      
      const namePattern = Math.random();
      let companyName;
      
      if (namePattern < 0.3) {
        companyName = `${this.city} ${template}`;
      } else if (namePattern < 0.6) {
        companyName = `${prefix} ${template} ${suffix}`;
      } else {
        companyName = `${neighborhood} ${template}`;
      }
      
      const domain = companyName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .substring(0, 20);
      
      const companyContact = this.generateCompanyContact(companyName);
      const companySize = this.generateCompanySize();
      const contactsData = this.generateContacts(companyName, companySize, companySize === 'Large' ? 8 : (companySize === 'Medium' ? 5 : 3));
      
      companies.push({
        name: companyName,
        city: neighborhood,
        description: `${industry} business serving ${this.city} area`,
        website: `https://${domain}.com`,
        industry: industry,
        phone: companyContact.phone,
        email: companyContact.email,
        size: companySize,
        emailFormat: contactsData.emailFormat,
        contacts: contactsData.contacts
      });
    }
    
    return companies;
  }

  getNeighborhoods() {
    const neighborhoods = {
      'Birmingham': ['Downtown', 'Highland Park', 'Five Points South', 'Avondale'],
      'San Francisco': ['Financial District', 'SoMa', 'Mission', 'Marina'],
      'Los Angeles': ['Downtown', 'Hollywood', 'Santa Monica', 'Beverly Hills'],
      'New York': ['Manhattan', 'Brooklyn', 'Queens', 'Bronx'],
      'Chicago': ['Loop', 'Lincoln Park', 'Wicker Park', 'River North'],
      'Miami': ['Downtown', 'Brickell', 'Wynwood', 'Coral Gables'],
      'default': ['Downtown', 'Midtown', 'Uptown', 'Central']
    };
    
    return neighborhoods[this.city] || neighborhoods['default'];
  }

  async saveCompany(company) {
    const client = await pool.connect();
    try {
      // Insert company directly (faster than checking first)
      const linkedinUrl = this.generateCompanyLinkedInURL(company.name);
      const accountResult = await client.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, 
          website, phone_number, email_format, company_size, company_category, linkedin_url, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING account_id`,
        [
          company.name,
          company.industry,
          'United States',
          this.state,
          company.city,
          company.website,
          company.phone || null,
          company.emailFormat || null,
          company.size || 'Medium',
          company.industry,
          linkedinUrl
        ]
      );
      
      const accountId = accountResult.rows[0].account_id;
      
      // Batch insert contacts if available (much faster than individual INSERTs)
      if (company.contacts && company.contacts.length > 0) {
        const contactValues = company.contacts.map((contact, idx) => 
          `($1, $${idx*6+2}, $${idx*6+3}, $${idx*6+4}, $${idx*6+5}, $${idx*6+6}, $${idx*6+7}, NOW())`
        ).join(',');
        
        const contactParams = [accountId];
        company.contacts.forEach(contact => {
          contactParams.push(
            contact.first_name,
            contact.last_name,
            contact.title,
            contact.email,
            contact.phone,
            contact.linkedin_url || null
          );
        });
        
        try {
          await client.query(
            `INSERT INTO contacts (
              linked_account_id, first_name, last_name, job_title, email, 
              phone_number, linkedin_url, created_at
            )
            VALUES ${contactValues}
            ON CONFLICT DO NOTHING`,
            contactParams
          );
        } catch (contactError) {
          console.error(`⚠️  Batch contact save error: ${contactError.message}`);
        }
      }
      
      this.companiesFound++;
      const contactsInfo = company.contacts ? ` + ${company.contacts.length} contacts` : '';
      console.log(`✅ Saved: ${company.name} (${company.city})${contactsInfo}`);
    } catch (error) {
      // Silently skip duplicates, log other errors
      if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
        console.error(`❌ Save error: ${error.message}`);
      }
    } finally {
      client.release();
    }
  }

  async discover(limit = 100) {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  DISCOVERING COMPANIES IN ${this.city.toUpperCase()}, ${this.state.toUpperCase()}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
    
    const industries = this.getIndustries();
    const neighborhoods = this.getNeighborhoods();
    const companiesPerArea = Math.ceil(limit / neighborhoods.length);
    
    console.log(`📍 Areas: ${neighborhoods.length}`);
    console.log(`📊 Industries: ${industries.length}`);
    console.log(`🏢 Target: ${limit} companies\n`);
    
    // Track completed areas
    const completedAreas = [];
    
    for (const neighborhood of neighborhoods) {
      if (this.companiesFound >= limit) break;
      
      console.log(`\n🔍 Discovering in ${neighborhood}...`);
      
      const areaIndustries = industries; // USE ALL INDUSTRIES for maximum data
      
      // Generate companies in parallel batches for faster processing
      const companyGenerationPromises = areaIndustries.map(industry => 
        this.generateCompaniesWithAI(industry, 5) // 5 companies per industry for maximum coverage
      );
      
      const allCompaniesArrays = await Promise.all(companyGenerationPromises);
      const allCompanies = allCompaniesArrays.flat();
      
      // Save companies in parallel batches (10 at a time for maximum speed)
      const batchSize = 10;
      for (let i = 0; i < allCompanies.length; i += batchSize) {
        if (this.companiesFound >= limit) break;
        
        const batch = allCompanies.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (company) => {
            if (this.companiesFound >= limit) return;
            company.city = neighborhood; // Set the neighborhood
            await this.saveCompany(company);
          })
        );
      }
      
      // Mark area as completed
      completedAreas.push(neighborhood);
      await this.markAreaCompleted(neighborhood);
      console.log(`✅ Area completed: ${neighborhood}`);
    }
    
    console.log(`\n✅ Discovery complete!`);
    console.log(`📊 Total companies found: ${this.companiesFound}`);
    console.log(`📍 Areas completed: ${completedAreas.length}/${neighborhoods.length}`);
    console.log(`Progress: ${this.companiesFound} companies saved\n`);
  }

  /**
   * Mark area as completed in database
   */
  async markAreaCompleted(neighborhood) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO discovery_progress (
          city, state_region, neighborhood, status, completed_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (city, state_region, neighborhood) 
        DO UPDATE SET status = $4, completed_at = NOW()`,
        [this.city, this.state, neighborhood, 'completed']
      );
    } catch (error) {
      // Table might not exist, create it
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS discovery_progress (
            id SERIAL PRIMARY KEY,
            city VARCHAR(200) NOT NULL,
            state_region VARCHAR(200) NOT NULL,
            neighborhood VARCHAR(200) NOT NULL,
            status VARCHAR(50) DEFAULT 'completed',
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(city, state_region, neighborhood)
          );
          CREATE INDEX IF NOT EXISTS idx_discovery_city_state ON discovery_progress(city, state_region);
        `);
        
        // Try again
        await client.query(
          `INSERT INTO discovery_progress (
            city, state_region, neighborhood, status, completed_at
          )
          VALUES ($1, $2, $3, $4, NOW())`,
          [this.city, this.state, neighborhood, 'completed']
        );
      } catch (createError) {
        console.error(`⚠️  Could not mark area completed: ${createError.message}`);
      }
    } finally {
      client.release();
    }
  }
}

// Main execution
async function main() {
  const city = process.argv[2];
  const state = process.argv[3];
  const limit = parseInt(process.argv[4]) || 100;
  
  if (!city || !state) {
    console.error('Usage: node discover-with-openai.js <city> <state> [limit]');
    console.error('Example: node discover-with-openai.js "Birmingham" "Alabama" 100');
    process.exit(1);
  }
  
  // State code mapping
  const stateCodes = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA',
    'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN',
    'texas': 'TX', 'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
    'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
  };
  
  const stateCode = stateCodes[state.toLowerCase()] || state.substring(0, 2).toUpperCase();
  
  const discovery = new OpenAICompanyDiscovery(city, state, stateCode);
  
  try {
    await discovery.discover(limit);
    process.exit(0);
  } catch (error) {
    console.error('❌ Discovery failed:', error);
    process.exit(1);
  }
}

main();
