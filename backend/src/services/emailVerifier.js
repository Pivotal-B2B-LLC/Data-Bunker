/**
 * EMAIL VERIFICATION SERVICE
 *
 * Free, unlimited email verification using:
 * 1. Syntax validation
 * 2. DNS MX record checking
 * 3. SMTP server verification
 * 4. Disposable email detection
 */

const dns = require('dns').promises;
const net = require('net');

// Common disposable email domains
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com',
  'temp-mail.org', '10minutemail.com', 'fakeinbox.com', 'trashmail.com',
  'yopmail.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc',
  'getnada.com', 'tempr.email', 'tempail.com', 'mohmal.com'
]);

// Common catch-all domains (will accept any email)
const CATCH_ALL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'protonmail.com', 'zoho.com'
]);

/**
 * Validate email syntax
 */
function isValidSyntax(email) {
  if (!email || typeof email !== 'string') return false;
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(email.trim().toLowerCase());
}

/**
 * Check if domain is disposable
 */
function isDisposable(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

/**
 * Check if domain is catch-all (can't verify individual emails)
 */
function isCatchAll(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return CATCH_ALL_DOMAINS.has(domain);
}

/**
 * Get MX records for domain
 */
async function getMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority);
  } catch (err) {
    return null;
  }
}

/**
 * Verify email via SMTP
 * Returns: { valid: boolean, reason: string }
 */
async function smtpVerify(email, mxHost, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let response = '';

    const cleanup = () => {
      socket.destroy();
    };

    socket.setTimeout(timeout);

    socket.on('timeout', () => {
      cleanup();
      resolve({ valid: false, reason: 'timeout' });
    });

    socket.on('error', (err) => {
      cleanup();
      resolve({ valid: false, reason: 'connection_error' });
    });

    socket.on('data', (data) => {
      response = data.toString();
      const code = parseInt(response.substring(0, 3));

      switch (step) {
        case 0: // Connected, send HELO
          if (code === 220) {
            socket.write('HELO verify.local\r\n');
            step = 1;
          } else {
            cleanup();
            resolve({ valid: false, reason: 'smtp_error' });
          }
          break;

        case 1: // HELO response, send MAIL FROM
          if (code === 250) {
            socket.write('MAIL FROM:<verify@verify.local>\r\n');
            step = 2;
          } else {
            cleanup();
            resolve({ valid: false, reason: 'helo_rejected' });
          }
          break;

        case 2: // MAIL FROM response, send RCPT TO
          if (code === 250) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else {
            cleanup();
            resolve({ valid: false, reason: 'mail_from_rejected' });
          }
          break;

        case 3: // RCPT TO response - this tells us if email exists
          socket.write('QUIT\r\n');
          cleanup();
          if (code === 250 || code === 251) {
            resolve({ valid: true, reason: 'smtp_verified' });
          } else if (code === 550 || code === 551 || code === 552 || code === 553) {
            resolve({ valid: false, reason: 'mailbox_not_found' });
          } else if (code === 450 || code === 451 || code === 452) {
            resolve({ valid: null, reason: 'temporary_error' }); // Can't determine
          } else {
            resolve({ valid: null, reason: 'unknown_response' });
          }
          break;
      }
    });

    socket.connect(25, mxHost);
  });
}

/**
 * Full email verification
 * Returns verification result object
 */
async function verifyEmail(email) {
  const result = {
    email: email?.toLowerCase().trim(),
    valid: false,
    syntax_valid: false,
    mx_valid: false,
    smtp_verified: null,
    is_disposable: false,
    is_catch_all: false,
    reason: '',
    score: 0
  };

  // Step 1: Syntax check
  if (!isValidSyntax(email)) {
    result.reason = 'invalid_syntax';
    return result;
  }
  result.syntax_valid = true;
  result.score += 20;

  const domain = email.split('@')[1].toLowerCase();

  // Step 2: Disposable check
  if (isDisposable(email)) {
    result.is_disposable = true;
    result.reason = 'disposable_email';
    return result;
  }
  result.score += 10;

  // Step 3: Catch-all check
  if (isCatchAll(email)) {
    result.is_catch_all = true;
    result.mx_valid = true;
    result.valid = true; // Assume valid for major providers
    result.reason = 'catch_all_domain';
    result.score += 50;
    return result;
  }

  // Step 4: MX record check
  const mxRecords = await getMxRecords(domain);
  if (!mxRecords || mxRecords.length === 0) {
    result.reason = 'no_mx_records';
    return result;
  }
  result.mx_valid = true;
  result.score += 30;

  // Step 5: SMTP verification (try top 2 MX servers)
  for (let i = 0; i < Math.min(2, mxRecords.length); i++) {
    try {
      const smtpResult = await smtpVerify(email, mxRecords[i].exchange);
      result.smtp_verified = smtpResult.valid;

      if (smtpResult.valid === true) {
        result.valid = true;
        result.reason = 'smtp_verified';
        result.score += 40;
        break;
      } else if (smtpResult.valid === false && smtpResult.reason === 'mailbox_not_found') {
        result.reason = 'mailbox_not_found';
        result.score = 20; // Only syntax is valid
        break;
      }
      // If null/unknown, try next server
    } catch (err) {
      // Try next server
    }
  }

  // If SMTP couldn't verify but MX exists, mark as likely valid
  if (result.smtp_verified === null && result.mx_valid) {
    result.valid = true;
    result.reason = 'mx_valid_smtp_unknown';
    result.score += 20;
  }

  return result;
}

/**
 * Batch verify emails
 */
async function verifyEmails(emails, concurrency = 5) {
  const results = [];

  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(email => verifyEmail(email).catch(err => ({
        email,
        valid: null,
        reason: 'verification_error',
        score: 0
      })))
    );
    results.push(...batchResults);
  }

  return results;
}

module.exports = {
  verifyEmail,
  verifyEmails,
  isValidSyntax,
  isDisposable,
  isCatchAll,
  getMxRecords
};
