/**
 * TURBO MODE CONFIGURATION
 *
 * Maximum performance settings for all agents
 */

module.exports = {
  // Website Finder - FAST MODE++
  WEBSITE: {
    BATCH_SIZE: 100,             // 100 companies at once (2x increase!)
    PARALLEL: 20,                // 20 parallel (2x increase!)
    DELAY: 500,                  // 0.5 sec between batches
  },

  // Company Discovery - AGGRESSIVE
  DISCOVERY: {
    PARALLEL_SEARCHES: 5,        // Search 5 cities at once
    DELAY_BETWEEN_SEARCHES: 1000, // 1 second (was 3)
    BATCH_SIZE: 50,              // More results per search
  },

  // Contact Finder - FAST MODE++
  CONTACT: {
    BATCH_SIZE: 150,             // Process 150 companies at once (5x increase!)
    PARALLEL: 30,                // 30 parallel requests (6x increase!)
    MAX_CONTACTS_PER_COMPANY: 10, // Up to 10 contacts
    DELAY: 100,                  // 0.1 sec between batches (ultra fast!)
  },

  // Email Finder - FAST MODE++
  EMAIL: {
    BATCH_SIZE: 150,             // 150 contacts at once (3x increase!)
    PARALLEL: 30,                // 30 parallel verifications (3x increase!)
    SMTP_TIMEOUT: 3000,          // 3 sec timeout (faster fail)
    DELAY: 100,                  // 0.1 sec between batches
  },

  // Phone Finder - FAST MODE++
  PHONE: {
    BATCH_SIZE: 150,             // 150 companies (5x increase!)
    PARALLEL: 25,                // 25 parallel (5x increase!)
    TIMEOUT: 6000,               // 6 sec timeout
    DELAY: 100,                  // 0.1 sec between batches
  },

  // Data Quality - FAST MODE++
  QUALITY: {
    BATCH_SIZE: 1000,            // 1000 at once (10x increase!)
    DELAY: 500,                  // 0.5 sec between cycles
  },

  // Search-Based Contact Finder
  // Conservative: search engines rate-limit aggressively
  SEARCH_CONTACT: {
    BATCH_SIZE: 15,              // Small batch - each company runs multiple searches
    PARALLEL: 2,                 // Only 2 companies at once
    MAX_CONTACTS_PER_COMPANY: 10,
    MAX_QUERIES_PER_COMPANY: 6,  // Max search queries per company
    SEARCH_DELAY_MIN: 2000,      // Min 2s between searches
    SEARCH_DELAY_MAX: 5000,      // Max 5s between searches
    DELAY: 12000,                // 12s between batches
  }
};
