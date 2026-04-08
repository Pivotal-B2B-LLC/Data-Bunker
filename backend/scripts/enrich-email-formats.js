#!/usr/bin/env node

/**
 * EMAIL FORMAT DETECTION SCRIPT
 *
 * Finds EMPLOYEE email patterns like:
 * - {first}.{last}@company.com
 * - {first}{last}@company.com
 * - {f}{last}@company.com
 * - {first}@company.com
 *
 * SKIPS generic emails like info@, contact@, sales@, support@
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const BATCH_SIZE = 30;
const DELAY_BETWEEN_COMPANIES = 2000;
const DELAY_BETWEEN_BATCHES = 5000;

// Generic email prefixes to SKIP
const GENERIC_PREFIXES = [
  'info', 'contact', 'hello', 'hi', 'enquiries', 'enquiry', 'admin',
  'sales', 'support', 'help', 'office', 'reception', 'mail', 'email',
  'customercare', 'customerservice', 'customer', 'service', 'services',
  'bookings', 'booking', 'reservations', 'orders', 'order', 'accounts',
  'billing', 'invoices', 'payments', 'hr', 'jobs', 'careers', 'recruitment',
  'marketing', 'press', 'media', 'pr', 'news', 'team', 'general', 'main',
  'feedback', 'complaints', 'webmaster', 'postmaster', 'noreply', 'no-reply',
  'donotreply', 'auto', 'automated', 'system', 'notify', 'notifications',
  'subscribe', 'unsubscribe', 'newsletter', 'updates', 'alerts'
];

// Common first names for pattern detection
const COMMON_FIRST_NAMES = [
  'james', 'john', 'robert', 'michael', 'david', 'william', 'richard', 'joseph',
  'thomas', 'christopher', 'charles', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra',
  'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
  'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
  'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra',
  'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather', 'diane',
  'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren',
  'christina', 'joan', 'evelyn', 'judith', 'megan', 'andrea', 'cheryl', 'hannah',
  // UK common names
  'oliver', 'jack', 'harry', 'charlie', 'oscar', 'leo', 'alfie', 'henry',
  'archie', 'noah', 'theo', 'freddie', 'arthur', 'max', 'finn', 'lucas',
  'amelia', 'isla', 'ava', 'mia', 'ivy', 'lily', 'isabella', 'rosie',
  'sophia', 'grace', 'freya', 'florence', 'poppy', 'ella', 'willow', 'sienna',
  'peter', 'simon', 'ian', 'neil', 'graham', 'stuart', 'alan', 'martin',
  'colin', 'gordon', 'fraser', 'angus', 'duncan', 'ross', 'craig', 'darren'
];

let stats = {
  processed: 0,
  formatsFound: 0,
  websitesFound: 0,
  errors: 0,
  startTime: Date.now()
};

/**
 * Check if email is a generic/role-based email
 */
function isGenericEmail(email) {
  if (!email) return true;
  const localPart = email.split('@')[0].toLowerCase();

  // Check against generic prefixes
  for (const prefix of GENERIC_PREFIXES) {
    if (localPart === prefix || localPart.startsWith(prefix + '.') ||
        localPart.endsWith('.' + prefix) || localPart.includes(prefix)) {
      return true;
    }
  }

  // Check if it's just numbers
  if (/^\d+$/.test(localPart)) return true;

  // Check if it starts with numbers (like 1420info@)
  if (/^\d+/.test(localPart)) return true;

  return false;
}

/**
 * Detect email format pattern from an employee email
 */
function detectEmailFormat(email, possibleFirstName, possibleLastName) {
  if (!email) return null;

  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain) return null;

  // Skip generic emails
  if (isGenericEmail(email)) return null;

  const first = possibleFirstName?.toLowerCase() || '';
  const last = possibleLastName?.toLowerCase() || '';

  // Try to match patterns
  if (first && last) {
    // {first}.{last}
    if (localPart === `${first}.${last}`) {
      return `{first}.{last}@${domain}`;
    }
    // {first}_{last}
    if (localPart === `${first}_${last}`) {
      return `{first}_{last}@${domain}`;
    }
    // {first}{last}
    if (localPart === `${first}${last}`) {
      return `{first}{last}@${domain}`;
    }
    // {last}.{first}
    if (localPart === `${last}.${first}`) {
      return `{last}.{first}@${domain}`;
    }
    // {f}{last}
    if (localPart === `${first[0]}${last}`) {
      return `{f}{last}@${domain}`;
    }
    // {f}.{last}
    if (localPart === `${first[0]}.${last}`) {
      return `{f}.{last}@${domain}`;
    }
    // {first}.{l}
    if (localPart === `${first}.${last[0]}`) {
      return `{first}.{l}@${domain}`;
    }
    // {first}{l}
    if (localPart === `${first}${last[0]}`) {
      return `{first}{l}@${domain}`;
    }
    // {first}
    if (localPart === first) {
      return `{first}@${domain}`;
    }
    // {last}
    if (localPart === last) {
      return `{last}@${domain}`;
    }
  }

  // Try to infer pattern from email structure
  // Pattern: word.word@domain (likely first.last)
  if (/^[a-z]+\.[a-z]+$/.test(localPart)) {
    const parts = localPart.split('.');
    // Check if first part looks like a first name
    if (COMMON_FIRST_NAMES.includes(parts[0])) {
      return `{first}.{last}@${domain}`;
    }
    // Still likely first.last pattern
    return `{first}.{last}@${domain}`;
  }

  // Pattern: word_word@domain
  if (/^[a-z]+_[a-z]+$/.test(localPart)) {
    const parts = localPart.split('_');
    if (COMMON_FIRST_NAMES.includes(parts[0])) {
      return `{first}_{last}@${domain}`;
    }
    return `{first}_{last}@${domain}`;
  }

  // Pattern: letter + word (like jsmith)
  if (/^[a-z][a-z]{3,}$/.test(localPart)) {
    // Check if it might be first initial + last name
    const potentialLast = localPart.substring(1);
    if (potentialLast.length >= 3) {
      return `{f}{last}@${domain}`;
    }
  }

  // Pattern: letter.word (like j.smith)
  if (/^[a-z]\.[a-z]+$/.test(localPart)) {
    return `{f}.{last}@${domain}`;
  }

  return null;
}

/**
 * Search for company website
 */
async function findWebsite(companyName, city, country) {
  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|company)\.?\s*$/i, '')
    .trim();

  const locationContext = city ? `${city} ${country || ''}` : (country || '');
  const query = `"${cleanName}" ${locationContext} official website`;

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const $ = cheerio.load(response.data);
    const skipDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com',
                        'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'glassdoor.com',
                        'indeed.com', 'crunchbase.com', 'bloomberg.com', 'gov.uk',
                        'companies-house.gov.uk', 'yell.com', 'thomsonlocal.com'];

    let website = null;
    $('.result__url').each((i, el) => {
      if (i > 10 || website) return false;
      const url = $(el).text().trim();
      if (url && !skipDomains.some(domain => url.includes(domain)) && url.includes('.')) {
        website = url.startsWith('http') ? url : `https://${url}`;
        return false;
      }
    });

    return website;
  } catch (error) {
    return null;
  }
}

/**
 * Extract domain from website URL
 */
function extractDomain(websiteUrl) {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    return url.hostname.replace(/^www\./, '');
  } catch {
    // Try to extract from simple URL
    const match = websiteUrl.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
    return match ? match[1] : null;
  }
}

/**
 * Search for employee emails on company pages
 */
async function findEmployeeEmails(websiteUrl) {
  const emails = [];
  if (!websiteUrl) return emails;

  const baseUrl = websiteUrl.replace(/\/$/, '');
  const domain = extractDomain(websiteUrl);

  // Pages likely to have employee emails
  const pagesToTry = [
    `${baseUrl}/about`,
    `${baseUrl}/about-us`,
    `${baseUrl}/team`,
    `${baseUrl}/our-team`,
    `${baseUrl}/meet-the-team`,
    `${baseUrl}/people`,
    `${baseUrl}/staff`,
    `${baseUrl}/leadership`,
    `${baseUrl}/management`,
    `${baseUrl}/contact`,
    `${baseUrl}/contact-us`,
    baseUrl
  ];

  for (const pageUrl of pagesToTry) {
    try {
      const response = await axios.get(pageUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      const html = response.data;
      const text = $('body').text();

      // Find all emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const foundEmails = html.match(emailRegex) || [];

      for (const email of foundEmails) {
        const emailLower = email.toLowerCase();
        const emailDomain = emailLower.split('@')[1];

        // Only consider emails from the company's domain
        if (domain && emailDomain && (emailDomain === domain || emailDomain.includes(domain.split('.')[0]))) {
          if (!isGenericEmail(emailLower) && !emails.includes(emailLower)) {
            // Try to find associated name
            const localPart = emailLower.split('@')[0];

            // Look for name patterns near the email
            const namePatterns = [
              // "John Smith" or "Smith, John"
              new RegExp(`([A-Z][a-z]+)\\s+([A-Z][a-z]+)\\s*[^@]*${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
              new RegExp(`${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^@]*([A-Z][a-z]+)\\s+([A-Z][a-z]+)`, 'i')
            ];

            let firstName = null, lastName = null;
            for (const pattern of namePatterns) {
              const match = html.match(pattern);
              if (match) {
                firstName = match[1];
                lastName = match[2];
                break;
              }
            }

            emails.push({
              email: emailLower,
              firstName,
              lastName,
              domain: emailDomain
            });
          }
        }
      }

      // Also look for mailto: links which might have names
      $('a[href^="mailto:"]').each((i, el) => {
        const mailto = $(el).attr('href');
        const emailMatch = mailto.match(/mailto:([^?]+)/);
        if (emailMatch) {
          const email = emailMatch[1].toLowerCase();
          const emailDomain = email.split('@')[1];

          if (domain && emailDomain && (emailDomain === domain || emailDomain.includes(domain.split('.')[0]))) {
            if (!isGenericEmail(email) && !emails.find(e => e.email === email)) {
              // Try to get name from link text
              const linkText = $(el).text().trim();
              const nameParts = linkText.split(/\s+/);

              emails.push({
                email,
                firstName: nameParts[0] || null,
                lastName: nameParts[1] || null,
                domain: emailDomain
              });
            }
          }
        }
      });

      if (emails.length >= 3) break; // Found enough samples

    } catch (e) {
      continue;
    }
  }

  return emails;
}

/**
 * Search for employee emails via web search
 */
async function searchEmployeeEmails(companyName, domain) {
  const emails = [];

  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|company)\.?\s*$/i, '')
    .trim();

  // Search for employee emails
  const queries = [
    `"@${domain}" email`,
    `"${cleanName}" employee email "@${domain}"`,
    `site:linkedin.com "${cleanName}" "@${domain}"`
  ];

  for (const query of queries) {
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      const emailRegex = new RegExp(`[a-zA-Z0-9._%+-]+@${domain.replace('.', '\\.')}`, 'gi');
      const foundEmails = response.data.match(emailRegex) || [];

      for (const email of foundEmails) {
        const emailLower = email.toLowerCase();
        if (!isGenericEmail(emailLower) && !emails.find(e => e.email === emailLower)) {
          emails.push({
            email: emailLower,
            firstName: null,
            lastName: null,
            domain
          });
        }
      }

      if (emails.length >= 3) break;
      await new Promise(r => setTimeout(r, 1000));

    } catch (e) {
      continue;
    }
  }

  return emails;
}

/**
 * Determine the most likely email format from found emails
 */
function determineBestFormat(emails, domain) {
  if (!emails || emails.length === 0) return null;

  const formatCounts = {};

  for (const emailData of emails) {
    const format = detectEmailFormat(emailData.email, emailData.firstName, emailData.lastName);
    if (format) {
      formatCounts[format] = (formatCounts[format] || 0) + 1;
    }
  }

  // Return the most common format
  let bestFormat = null;
  let maxCount = 0;

  for (const [format, count] of Object.entries(formatCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestFormat = format;
    }
  }

  // If no pattern detected, but we have employee emails, try to infer
  if (!bestFormat && emails.length > 0) {
    const sampleEmail = emails[0].email;
    const localPart = sampleEmail.split('@')[0];

    if (localPart.includes('.')) {
      bestFormat = `{first}.{last}@${domain}`;
    } else if (localPart.includes('_')) {
      bestFormat = `{first}_{last}@${domain}`;
    } else if (/^[a-z][a-z]+$/.test(localPart) && localPart.length > 4) {
      bestFormat = `{f}{last}@${domain}`;
    }
  }

  return bestFormat;
}

/**
 * Get companies that need email format enrichment
 */
async function getCompaniesToEnrich(limit = BATCH_SIZE) {
  const result = await pool.query(`
    SELECT account_id, company_name, city, state_region, country, website
    FROM accounts
    WHERE (email_format IS NULL OR email_format = '' OR email_format LIKE '%@%' AND email_format NOT LIKE '{%')
      AND company_name IS NOT NULL
      AND company_name != ''
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Update company with email format
 */
async function updateCompany(accountId, data) {
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (data.website) {
    updates.push(`website = $${paramIndex++}`);
    values.push(data.website);
  }

  if (data.emailFormat) {
    updates.push(`email_format = $${paramIndex++}`);
    values.push(data.emailFormat);
  }

  if (updates.length === 0) return false;

  updates.push(`updated_at = NOW()`);
  values.push(accountId);

  await pool.query(
    `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${paramIndex}`,
    values
  );

  return true;
}

/**
 * Process a single company
 */
async function processCompany(company) {
  console.log(`  Processing: ${company.company_name}`);

  let website = company.website;
  let emailFormat = null;

  // Find website if missing
  if (!website) {
    website = await findWebsite(company.company_name, company.city, company.country);
    if (website) {
      console.log(`    + Found website: ${website}`);
      stats.websitesFound++;
    }
  }

  if (website) {
    const domain = extractDomain(website);

    if (domain) {
      // Search for employee emails on website
      let employeeEmails = await findEmployeeEmails(website);

      // If not found on website, try web search
      if (employeeEmails.length === 0) {
        employeeEmails = await searchEmployeeEmails(company.company_name, domain);
      }

      if (employeeEmails.length > 0) {
        console.log(`    + Found ${employeeEmails.length} employee email(s)`);

        // Determine format
        emailFormat = determineBestFormat(employeeEmails, domain);

        if (emailFormat) {
          console.log(`    + Email format: ${emailFormat}`);
          stats.formatsFound++;
        }
      }
    }
  }

  // Update company
  const updated = await updateCompany(company.account_id, {
    website: website !== company.website ? website : null,
    emailFormat
  });

  stats.processed++;
  return updated;
}

/**
 * Main enrichment loop
 */
async function runEnrichment() {
  console.log('\n' + '='.repeat(60));
  console.log('   EMAIL FORMAT DETECTION SYSTEM');
  console.log('='.repeat(60));
  console.log(`   Detecting patterns like: {first}.{last}@domain.com`);
  console.log(`   Skipping generic emails: info@, contact@, sales@, etc.`);
  console.log(`   Batch Size: ${BATCH_SIZE}`);
  console.log(`   Press Ctrl+C to stop\n`);

  let batchNumber = 0;

  while (true) {
    batchNumber++;
    console.log(`\n[Batch ${batchNumber}] Fetching companies...`);

    try {
      const companies = await getCompaniesToEnrich();

      if (companies.length === 0) {
        console.log('  No more companies to process! Waiting 60 seconds...');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      console.log(`  Found ${companies.length} companies to process\n`);

      for (const company of companies) {
        try {
          await processCompany(company);
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_COMPANIES));
        } catch (error) {
          console.log(`    x Error: ${error.message}`);
          stats.errors++;
        }
      }

      // Print stats
      const duration = Math.floor((Date.now() - stats.startTime) / 1000);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;

      console.log(`\n[Stats] Processed: ${stats.processed} | Formats Found: ${stats.formatsFound} | Websites: ${stats.websitesFound} | Errors: ${stats.errors} | Time: ${minutes}m ${seconds}s`);

      // Wait before next batch
      console.log(`\nWaiting ${DELAY_BETWEEN_BATCHES/1000}s before next batch...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

    } catch (error) {
      console.error(`[Batch Error] ${error.message}`);
      console.log('Waiting 30 seconds before retry...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n' + '='.repeat(60));
  console.log('   EMAIL FORMAT DETECTION STOPPED');
  console.log('='.repeat(60));
  console.log(`   Total Processed: ${stats.processed}`);
  console.log(`   Formats Found: ${stats.formatsFound}`);
  console.log(`   Websites Found: ${stats.websitesFound}`);
  console.log(`   Errors: ${stats.errors}`);
  process.exit(0);
});

// Start enrichment
runEnrichment().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
