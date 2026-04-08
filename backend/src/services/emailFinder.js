/**
 * EMAIL FINDER SERVICE
 *
 * Finds email addresses by name + company domain
 * Same functionality as Mailmeteor/Hunter.io but FREE
 *
 * 1. Generates possible email patterns
 * 2. Verifies each via SMTP
 * 3. Returns the valid email(s)
 */

const { verifyEmail, getMxRecords } = require('./emailVerifier');
const ollama = require('./ollamaService');

// Common email patterns used by companies
const EMAIL_PATTERNS = [
  // Most common patterns (check these first)
  '{first}.{last}',           // john.smith
  '{first}{last}',            // johnsmith
  '{f}{last}',                // jsmith
  '{first}',                  // john
  '{first}_{last}',           // john_smith
  '{last}.{first}',           // smith.john
  '{f}.{last}',               // j.smith
  '{first}{l}',               // johns
  '{f}{l}',                   // js
  '{last}',                   // smith
  '{last}{first}',            // smithjohn
  '{last}{f}',                // smithj
  '{first}-{last}',           // john-smith
  '{f}_{last}',               // j_smith
  '{first}.{l}',              // john.s
];

/**
 * Clean and normalize name
 */
function cleanName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Parse full name into first/last
 */
function parseName(fullName) {
  const cleaned = cleanName(fullName);
  if (!cleaned) return null;

  const parts = cleaned.split(' ').filter(p => p.length > 0);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return { first: parts[0], last: '', initial: parts[0][0] };
  }

  return {
    first: parts[0],
    last: parts[parts.length - 1],
    initial: parts[0][0],
    lastInitial: parts[parts.length - 1][0]
  };
}

/**
 * Generate email from pattern
 */
function generateEmail(pattern, name, domain) {
  const { first, last, initial, lastInitial } = name;

  let email = pattern
    .replace('{first}', first)
    .replace('{last}', last)
    .replace('{f}', initial || '')
    .replace('{l}', lastInitial || '');

  // Remove double dots or empty parts
  email = email.replace(/\.+/g, '.').replace(/^\.|\.$/, '');

  if (!email || email.length < 2) return null;

  return `${email}@${domain}`.toLowerCase();
}

/**
 * Generate all possible email permutations
 */
function generatePermutations(fullName, domain) {
  const name = parseName(fullName);
  if (!name) return [];

  const emails = [];
  const seen = new Set();

  for (const pattern of EMAIL_PATTERNS) {
    const email = generateEmail(pattern, name, domain);
    if (email && !seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }

  return emails;
}

/**
 * Find email for a person at a company
 * Returns: { found: boolean, email: string, pattern: string, score: number }
 */
async function findEmail(fullName, domain, options = {}) {
  const {
    maxAttempts = 10,  // Max patterns to try
    timeout = 5000,
    returnAll = false  // Return all valid emails or just first
  } = options;

  const result = {
    name: fullName,
    domain: domain,
    found: false,
    email: null,
    allEmails: [],
    attempts: 0,
    pattern: null
  };

  // Clean domain
  domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  // Check if domain has MX records first
  const mxRecords = await getMxRecords(domain);
  if (!mxRecords || mxRecords.length === 0) {
    result.error = 'no_mx_records';
    return result;
  }

  // Generate permutations
  const permutations = generatePermutations(fullName, domain);
  if (permutations.length === 0) {
    result.error = 'invalid_name';
    return result;
  }

  // Use LLM to validate the best candidate emails after generation
  let orderedPermutations = permutations;

  // Try each permutation
  const toTry = orderedPermutations.slice(0, maxAttempts);

  for (const email of toTry) {
    result.attempts++;

    try {
      const verification = await verifyEmail(email);

      if (verification.valid === true) {
        result.found = true;
        result.allEmails.push({
          email,
          score: verification.score,
          reason: verification.reason
        });

        if (!result.email) {
          result.email = email;
          result.pattern = EMAIL_PATTERNS[permutations.indexOf(email)] || 'unknown';
        }

        if (!returnAll) break;
      }
    } catch (err) {
      // Continue to next pattern
    }
  }

  return result;
}

/**
 * Find emails for multiple contacts at the same company
 * More efficient - checks MX once, batches SMTP
 */
async function findEmailsBatch(contacts, domain, options = {}) {
  const { concurrency = 3 } = options;

  // Clean domain
  domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  // Check MX once
  const mxRecords = await getMxRecords(domain);
  if (!mxRecords || mxRecords.length === 0) {
    return contacts.map(c => ({
      name: c.name || `${c.firstName} ${c.lastName}`,
      domain,
      found: false,
      error: 'no_mx_records'
    }));
  }

  const results = [];

  // Process in batches
  for (let i = 0; i < contacts.length; i += concurrency) {
    const batch = contacts.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(contact => {
        const name = contact.name || `${contact.firstName} ${contact.lastName}`;
        return findEmail(name, domain, options);
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Detect company's email pattern by testing known contacts
 */
async function detectEmailPattern(domain, knownContacts = []) {
  // Clean domain
  domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  const patternScores = {};

  // Test each pattern with known contacts
  for (const contact of knownContacts.slice(0, 5)) {
    const name = parseName(contact.name || `${contact.firstName} ${contact.lastName}`);
    if (!name) continue;

    for (const pattern of EMAIL_PATTERNS) {
      const email = generateEmail(pattern, name, domain);
      if (!email) continue;

      try {
        const verification = await verifyEmail(email);
        if (verification.valid) {
          patternScores[pattern] = (patternScores[pattern] || 0) + 1;
        }
      } catch (err) {
        // Continue
      }
    }
  }

  // Return most common pattern
  const sorted = Object.entries(patternScores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : null;
}

module.exports = {
  findEmail,
  findEmailsBatch,
  detectEmailPattern,
  generatePermutations,
  parseName,
  EMAIL_PATTERNS
};
