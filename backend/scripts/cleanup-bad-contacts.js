#!/usr/bin/env node

/**
 * CLEANUP BAD CONTACTS
 *
 * Removes contacts with garbage names from the database
 * Uses the same validation logic as unified-enrichment-v2.js
 */

require('dotenv').config();
const { pool } = require('../src/db/connection');

// Words that are NOT first names - filter these out
const NOT_FIRST_NAMES = new Set([
  // Business/corporate terms
  'business', 'company', 'corporate', 'enterprise', 'group', 'limited', 'ltd',
  'inc', 'corporation', 'holdings', 'solutions', 'services', 'consulting',
  'international', 'global', 'national', 'regional', 'local',
  // Places
  'university', 'college', 'school', 'institute', 'academy', 'centre', 'center',
  'london', 'edinburgh', 'glasgow', 'manchester', 'birmingham', 'bristol',
  'north', 'south', 'east', 'west', 'central', 'united', 'kingdom', 'british',
  // Industries/sectors
  'healthcare', 'technology', 'financial', 'retail', 'manufacturing', 'energy',
  'construction', 'property', 'real', 'estate', 'life', 'sciences', 'sector',
  'industry', 'market', 'digital', 'media', 'creative',
  // Job titles (that get picked up as names)
  'director', 'manager', 'executive', 'officer', 'president', 'chairman',
  'head', 'chief', 'senior', 'junior', 'lead', 'principal', 'associate',
  'assistant', 'coordinator', 'specialist', 'analyst', 'consultant',
  'operations', 'sales', 'marketing', 'finance', 'human', 'resources',
  // Generic words
  'our', 'the', 'and', 'for', 'with', 'about', 'meet', 'team', 'staff',
  'excellence', 'quality', 'best', 'first', 'new', 'old', 'great', 'good',
  'read', 'more', 'view', 'contact', 'click', 'here', 'learn', 'discover',
  // Organizations
  'board', 'committee', 'council', 'trust', 'foundation', 'charity', 'association',
  // Other common non-names
  'just', 'dogs', 'red', 'blue', 'green', 'black', 'white', 'near', 'silk',
  'factory', 'road', 'street', 'avenue', 'place', 'house', 'building',
  'data', 'protection', 'information', 'freedom', 'policy', 'privacy',
  'cookie', 'terms', 'conditions', 'compliance', 'regulatory', 'legal',
  // Additional bad patterns found
  'columbia', 'yale', 'harvard', 'oxford', 'cambridge', 'princeton',
  'medidata', 'dassault', 'syst', 'tarek', 'riverfront', 'srinagar', 'rajbagh',
  'jhelum', 'bund', 'nordic', 'visitor', 'tribe', 'porty', 'summit',
  'awards', 'news', 'double', 'recruitment', 'getting', 'pilton', 'youth',
  'children', 'project', 'women', 'scotland', 'beira',
  // More garbage words found in cleanup
  'current', 'bank', 'chambers', 'safe', 'contractor', 'quantity', 'surveyor',
  'contacts', 'architects', 'developments', 'morson', 'dessian', 'hulley',
  'mc', 'surveyorstefan', 'managerpaul', 'directorsefan', 'murraydirectorian',
  'cousinsfinance', 'armisteadtom', 'special', 'comprehensive', 'mindset',
  'craftsmanship', 'builders', 'indian', 'ocean', 'virgin', 'islands', 'african',
  'republic', 'krispy', 'kreme', 'bayleaf', 'express', 'piemaker', 'newtown',
  'deli', 'stevenson', 'yaduvanshi', 'restaurant', 'medlock', 'law', 'freshfields',
  'general', 'partner', 'design'
]);

// Common valid first names (subset for validation)
const COMMON_FIRST_NAMES = new Set([
  // Male names
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'benjamin', 'samuel', 'raymond', 'gregory', 'frank', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'nathan',
  'henry', 'douglas', 'zachary', 'peter', 'kyle', 'noah', 'ethan', 'jeremy',
  'walter', 'christian', 'keith', 'roger', 'terry', 'austin', 'sean', 'gerald',
  'carl', 'harold', 'dylan', 'arthur', 'lawrence', 'jordan', 'jesse', 'bryan',
  'billy', 'bruce', 'gabriel', 'joe', 'logan', 'alan', 'juan', 'albert', 'willie',
  'elijah', 'randy', 'wayne', 'vincent', 'philip', 'eugene', 'russell', 'bobby',
  'harry', 'johnny', 'howard', 'martin', 'stuart', 'colin', 'graham', 'neil',
  'ian', 'simon', 'fraser', 'alistair', 'angus', 'duncan', 'hamish', 'callum',
  // Female names
  'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan', 'jessica',
  'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley',
  'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol', 'amanda', 'melissa',
  'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia', 'kathleen',
  'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela', 'emma', 'nicole', 'helen',
  'samantha', 'katherine', 'christine', 'debra', 'rachel', 'carolyn', 'janet',
  'catherine', 'maria', 'heather', 'diane', 'ruth', 'julie', 'olivia', 'joyce',
  'virginia', 'victoria', 'kelly', 'lauren', 'christina', 'joan', 'evelyn', 'judith',
  'megan', 'andrea', 'cheryl', 'hannah', 'jacqueline', 'martha', 'gloria', 'teresa',
  'ann', 'sara', 'madison', 'frances', 'kathryn', 'janice', 'jean', 'abigail',
  'alice', 'judy', 'sophia', 'grace', 'denise', 'amber', 'doris', 'marilyn',
  'danielle', 'beverly', 'isabella', 'theresa', 'diana', 'natalie', 'brittany',
  'charlotte', 'marie', 'kayla', 'alexis', 'lori', 'claire', 'fiona', 'eileen',
  'moira', 'catriona', 'isla', 'ailsa', 'kirsty', 'lynne', 'lesley', 'elaine',
  // Additional common names
  'liza', 'anna', 'annie', 'lorna', 'bernard', 'susan', 'johann', 'mariusz',
  'ashley', 'danielle', 'dani', 'lena'
]);

function isValidPersonName(firstName, lastName) {
  if (!firstName || !lastName) return false;

  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();

  // Check if first name is in the NOT list
  if (NOT_FIRST_NAMES.has(first)) return false;
  if (NOT_FIRST_NAMES.has(last)) return false;

  // First name should be 2-15 chars
  if (first.length < 2 || first.length > 15) return false;

  // Last name should be 2-20 chars (but min 2 for asian names like Ho, Li, Yu)
  if (last.length < 2 || last.length > 25) return false;

  // Names should be mostly letters (allow apostrophe and hyphen)
  if (!/^[a-z'-]+$/.test(first)) return false;
  if (!/^[a-z'-]+$/.test(last)) return false;

  // Reject names that look like concatenated words (e.g., "Surveyorstefan", "Managerpaul")
  // These have a pattern like "wordWord" when mixed case, which becomes one long lowercase
  if (first.length > 12 && !COMMON_FIRST_NAMES.has(first)) return false;
  if (last.length > 15) return false;

  // Reject common English words that aren't names
  const wordPatterns = /^(the|and|for|with|our|all|new|old|big|top|best|first|last|next|only|real|true|full|high|low|open|free|easy|fast|hard|soft|long|short|wide|deep|dark|light|good|bad|hot|cold|dry|wet|raw|current|safe|bank|quantity|special|comprehensive|general|total|main|major|minor|super|extra|ultra|mega|mini|micro|macro|multi|mono|semi|anti|pre|post|pro|non|sub|co|re|un|in|out|up|down|over|under|inter|trans|cross|self|auto|tele|cyber|bio|eco|geo|techno|electro|hydro|photo|thermo|aero|astro|cosmo|any|some|every|no|each|few|many|much|more|most|less|least|such|what|which|who|whom|whose|how|why|when|where|there|here|this|that|these|those)$/;
  if (wordPatterns.test(first)) return false;

  // If first name is a known common name, definitely valid
  if (COMMON_FIRST_NAMES.has(first)) return true;

  // For uncommon first names, apply additional checks:
  // - Must be at least 3 chars
  // - Must look like a name (not ending in common word suffixes)
  if (first.length < 3) return false;

  const badSuffixes = /(tion|ment|ness|ship|hood|ity|ism|ist|ive|ous|ful|less|able|ible|ward|wise|like|free)$/;
  if (badSuffixes.test(first)) return false;
  if (badSuffixes.test(last)) return false;

  return true;
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   CLEANUP BAD CONTACTS');
  console.log('='.repeat(60));
  console.log('   Removing contacts with invalid names...\n');

  // Get all contacts
  const result = await pool.query(`
    SELECT contact_id, first_name, last_name, email
    FROM contacts
  `);

  const contacts = result.rows;
  console.log(`  Total contacts in database: ${contacts.length}\n`);

  let deleted = 0;
  let kept = 0;
  const badContacts = [];

  for (const contact of contacts) {
    const isValid = isValidPersonName(contact.first_name, contact.last_name);

    if (!isValid) {
      badContacts.push({
        id: contact.contact_id,
        name: `${contact.first_name} ${contact.last_name}`,
        email: contact.email
      });
    } else {
      kept++;
    }
  }

  console.log(`  Valid contacts: ${kept}`);
  console.log(`  Invalid contacts to delete: ${badContacts.length}\n`);

  if (badContacts.length > 0) {
    console.log('  Sample of contacts being deleted:');
    for (const c of badContacts.slice(0, 20)) {
      console.log(`    - "${c.name}" (${c.email || 'no email'})`);
    }
    console.log('');

    // Delete bad contacts
    console.log('  Deleting bad contacts...');

    const ids = badContacts.map(c => c.id);

    // Delete in batches of 100
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await pool.query(
        `DELETE FROM contacts WHERE contact_id = ANY($1)`,
        [batch]
      );
      deleted += batch.length;
      process.stdout.write(`    Deleted ${deleted}/${badContacts.length}\r`);
    }

    console.log(`\n\n  ✓ Deleted ${deleted} bad contacts`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('   CLEANUP COMPLETE');
  console.log('='.repeat(60));
  console.log(`   Kept: ${kept} valid contacts`);
  console.log(`   Deleted: ${deleted} invalid contacts`);
  console.log('='.repeat(60) + '\n');

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
