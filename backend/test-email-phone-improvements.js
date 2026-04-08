/**
 * TEST: Improved Email and Phone Selection
 * Run: node test-email-phone-improvements.js
 */

// Test email selection
function chooseEmail_OLD(emails, domain) {
  const generic = emails.find(email => /^(info|contact|hello|support|sales)[+_.-]?/i.test(email));
  const sameDomain = emails.find(email => email.toLowerCase().includes(`@${domain}`));
  return generic || sameDomain || emails[0];
}

function chooseEmail_NEW(emails, domain) {
  // 1. SKIP generic emails
  const genericPatterns = /^(info|contact|hello|support|sales|admin|noreply|no-reply|enquiries|enquiry|mail|office)[@+_.-]/i;
  
  // 2. Filter to company domain only
  const companyEmails = emails.filter(email => {
    return email.toLowerCase().includes(`@${domain}`) && 
           !genericPatterns.test(email);
  });
  
  // 3. PREFER personal format: firstname@, first.last@, name@
  const personalEmail = companyEmails.find(email => {
    const localPart = email.split('@')[0].toLowerCase();
    // Has dot (john.smith) or looks like a name (single word without numbers)
    return localPart.includes('.') || (/^[a-z]+$/.test(localPart) && localPart.length >= 3);
  });
  
  return personalEmail || companyEmails[0] || null;
}

// Test phone formatting for UK
function formatUKPhone_NEW(phone, country) {
  if (!country || !['england', 'scotland', 'wales', 'united kingdom', 'uk'].some(c => country.toLowerCase().includes(c))) {
    return phone; // Not UK, return as-is
  }
  
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  
  // Remove leading 0 or 44
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (digits.startsWith('44')) digits = digits.substring(2);
  
  // Validate length (UK numbers are 10 digits after removing 0)
  if (digits.length < 10 || digits.length > 11) return null; // Invalid
  
  // Format: +44 XXXX XXX XXX or +44 XXX XXXX XXXX
  if (digits.length === 10) {
    return `+44 ${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}`;
  } else {
    return `+44 ${digits.substring(0, 3)} ${digits.substring(3, 7)} ${digits.substring(7)}`;
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('📧 EMAIL SELECTION TEST');
console.log('═══════════════════════════════════════════════════════════\n');

// Test cases
const testCases = [
  {
    name: 'Company with personal email',
    emails: ['hello@company.com', 'john.smith@company.com', 'info@company.com'],
    domain: 'company.com'
  },
  {
    name: 'Company with firstname email',
    emails: ['contact@company.com', 'james@company.com', 'sales@company.com'],
    domain: 'company.com'
  },
  {
    name: 'Mixed emails',
    emails: ['info@company.com', 'hello@company.com', 'sarah.jones@company.com', 'support@company.com'],
    domain: 'company.com'
  },
  {
    name: 'Only generic emails',
    emails: ['info@company.com', 'hello@company.com', 'contact@company.com'],
    domain: 'company.com'
  }
];

testCases.forEach(test => {
  console.log(`\n🔍 ${test.name}`);
  console.log(`   Emails found: ${test.emails.join(', ')}`);
  console.log(`   ❌ OLD Logic would choose: ${chooseEmail_OLD(test.emails, test.domain)}`);
  console.log(`   ✅ NEW Logic would choose: ${chooseEmail_NEW(test.emails, test.domain) || 'null (skip generic)'}`);
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('📞 UK PHONE FORMATTING TEST');
console.log('═══════════════════════════════════════════════════════════\n');

const phoneCases = [
  { phone: '07912 345678', country: 'England', desc: 'Mobile with 0' },
  { phone: '020 7946 0958', country: 'England', desc: 'London landline' },
  { phone: '01234567890', country: 'Scotland', desc: 'Landline no spaces' },
  { phone: '+44 161 234 5678', country: 'England', desc: 'Already formatted' },
  { phone: '441612345678', country: 'Wales', desc: 'With country code, no spaces' },
  { phone: '2.1111111111', country: 'England', desc: 'Bad format from DB' },
  { phone: '6519276456232', country: 'England', desc: 'Too long, invalid' },
  { phone: '020 1234 5678', country: 'United States', desc: 'US number (should skip)' },
];

phoneCases.forEach(test => {
  console.log(`\n📞 ${test.desc}`);
  console.log(`   Input: ${test.phone} (${test.country})`);
  const formatted = formatUKPhone_NEW(test.phone, test.country);
  if (formatted) {
    console.log(`   ✅ OUTPUT: ${formatted}`);
  } else {
    console.log(`   ❌ REJECTED: Invalid format`);
  }
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('✅ TEST COMPLETE - Review results above');
console.log('═══════════════════════════════════════════════════════════\n');
