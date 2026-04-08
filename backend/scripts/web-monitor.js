#!/usr/bin/env node

/**
 * WEB DASHBOARD - LIVE PROGRESS MONITOR
 * Real-time web interface at http://localhost:3001
 */

const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

// Load .env from backend root directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../src/db/connection');

const app = express();
const PORT = 3001;

let previousStats = {
  companies: 0,
  contacts: 0,
  websites: 0,
  phones: 0,
  emails: 0,
  emailFormats: 0,
  lastUpdate: Date.now()
};

async function getStats() {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) as companies,
        (SELECT COUNT(*) FROM contacts) as contacts,
        (SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website != '') as websites,
        (SELECT COUNT(*) FROM accounts WHERE phone_number IS NOT NULL) as phones,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as emails,
        (SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL AND email_format != '') as email_formats
    `);
    return result.rows[0];
  } catch (e) {
    console.error('❌ Error fetching stats:', e);
    console.error('   Database connection issue - check if backend is running');
    return null;
  }
}

// Store connected clients for Server-Sent Events
const clients = [];

// SSE endpoint for live updates
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Add this client to the list
  clients.push(res);

  // Remove client when they disconnect
  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

// Broadcast stats to all connected clients
async function broadcastStats() {
  const stats = await getStats();
  if (!stats) return;

  const now = Date.now();
  const timeDiff = (now - previousStats.lastUpdate) / 1000; // seconds

  const companiesDiff = parseInt(stats.companies) - previousStats.companies;
  const contactsDiff = parseInt(stats.contacts) - previousStats.contacts;
  const websitesDiff = parseInt(stats.websites) - previousStats.websites;
  const phonesDiff = parseInt(stats.phones) - previousStats.phones;
  const emailsDiff = parseInt(stats.emails) - previousStats.emails;
  const formatsDiff = parseInt(stats.email_formats) - previousStats.emailFormats;

  // Calculate per-minute rates based on actual time elapsed
  const perMinuteMultiplier = 60 / timeDiff;
  const perHourMultiplier = 3600 / timeDiff;

  const data = {
    totals: {
      companies: parseInt(stats.companies),
      contacts: parseInt(stats.contacts),
      websites: parseInt(stats.websites),
      phones: parseInt(stats.phones),
      emails: parseInt(stats.emails),
      emailFormats: parseInt(stats.email_formats)
    },
    diffs: {
      companies: companiesDiff,
      contacts: contactsDiff,
      websites: websitesDiff,
      phones: phonesDiff,
      emails: emailsDiff,
      emailFormats: formatsDiff
    },
    rates: {
      companies: Math.round(companiesDiff * perMinuteMultiplier),
      contacts: Math.round(contactsDiff * perMinuteMultiplier),
      websites: Math.round(websitesDiff * perMinuteMultiplier),
      phones: Math.round(phonesDiff * perMinuteMultiplier),
      emails: Math.round(emailsDiff * perMinuteMultiplier),
      emailFormats: Math.round(formatsDiff * perMinuteMultiplier)
    },
    hourlyRates: {
      companies: Math.round(companiesDiff * perHourMultiplier),
      contacts: Math.round(contactsDiff * perHourMultiplier),
      websites: Math.round(websitesDiff * perHourMultiplier),
      phones: Math.round(phonesDiff * perHourMultiplier),
      emails: Math.round(emailsDiff * perHourMultiplier),
      emailFormats: Math.round(formatsDiff * perHourMultiplier)
    },
    lastUpdate: new Date().toLocaleTimeString()
  };

  // Send to all connected clients
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  // Update previous stats
  previousStats = {
    companies: parseInt(stats.companies),
    contacts: parseInt(stats.contacts),
    websites: parseInt(stats.websites),
    phones: parseInt(stats.phones),
    emails: parseInt(stats.emails),
    emailFormats: parseInt(stats.email_formats),
    lastUpdate: now
  };
}

// Main dashboard page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔥 FAST MODE++ LIVE MONITOR</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 20px;
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      margin-bottom: 40px;
      padding: 30px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 15px;
      backdrop-filter: blur(10px);
    }

    h1 {
      font-size: 3em;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
    }

    .subtitle {
      font-size: 1.2em;
      opacity: 0.9;
    }

    .last-update {
      margin-top: 10px;
      font-size: 0.9em;
      opacity: 0.7;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 15px;
      padding: 25px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .stat-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }

    .stat-label {
      font-size: 0.9em;
      opacity: 0.8;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .stat-value {
      font-size: 2.5em;
      font-weight: bold;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
    }

    .stat-diff {
      font-size: 1.1em;
      margin-bottom: 5px;
    }

    .stat-diff.positive {
      color: #4ade80;
    }

    .stat-diff.negative {
      color: #f87171;
    }

    .stat-rate {
      font-size: 0.9em;
      opacity: 0.8;
    }

    .rate-badge {
      display: inline-block;
      background: rgba(74, 222, 128, 0.2);
      padding: 5px 15px;
      border-radius: 20px;
      margin-top: 5px;
      font-weight: bold;
    }

    .pulse {
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      background: #4ade80;
      border-radius: 50%;
      margin-left: 10px;
      animation: blink 1.5s infinite;
    }

    @keyframes blink {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔥 FAST MODE++ LIVE MONITOR 🔥</h1>
      <div class="subtitle">
        Real-time Discovery & Enrichment Dashboard
        <span class="status-indicator"></span>
      </div>
      <div class="last-update" id="lastUpdate">Connecting...</div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">📊 Total Companies</div>
        <div class="stat-value" id="companies">0</div>
        <div class="stat-diff" id="companiesDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="companiesRate">0/hour</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">👥 Total Contacts</div>
        <div class="stat-value" id="contacts">0</div>
        <div class="stat-diff" id="contactsDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="contactsRate">0/hour</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">🌐 Websites Found</div>
        <div class="stat-value" id="websites">0</div>
        <div class="stat-diff" id="websitesDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="websitesRate">0/hour</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">📞 Phone Numbers</div>
        <div class="stat-value" id="phones">0</div>
        <div class="stat-diff" id="phonesDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="phonesRate">0/hour</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">📧 Contact Emails</div>
        <div class="stat-value" id="emails">0</div>
        <div class="stat-diff" id="emailsDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="emailsRate">0/hour</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">📋 Email Formats</div>
        <div class="stat-value" id="emailFormats">0</div>
        <div class="stat-diff" id="emailFormatsDiff">+0</div>
        <div class="stat-rate">
          <span class="rate-badge" id="emailFormatsRate">0/hour</span>
        </div>
      </div>
    </div>
  </div>

  <script>
    const eventSource = new EventSource('/events');

    function formatNumber(num) {
      return num.toLocaleString();
    }

    function formatDiff(num) {
      if (num > 0) return '+' + formatNumber(num);
      if (num < 0) return formatNumber(num);
      return '0';
    }

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Update last update time
      document.getElementById('lastUpdate').textContent = 'Last Updated: ' + data.lastUpdate;

      // Update totals
      document.getElementById('companies').textContent = formatNumber(data.totals.companies);
      document.getElementById('contacts').textContent = formatNumber(data.totals.contacts);
      document.getElementById('websites').textContent = formatNumber(data.totals.websites);
      document.getElementById('phones').textContent = formatNumber(data.totals.phones);
      document.getElementById('emails').textContent = formatNumber(data.totals.emails);
      document.getElementById('emailFormats').textContent = formatNumber(data.totals.emailFormats);

      // Update diffs
      updateDiff('companiesDiff', data.diffs.companies);
      updateDiff('contactsDiff', data.diffs.contacts);
      updateDiff('websitesDiff', data.diffs.websites);
      updateDiff('phonesDiff', data.diffs.phones);
      updateDiff('emailsDiff', data.diffs.emails);
      updateDiff('emailFormatsDiff', data.diffs.emailFormats);

      // Update rates (per minute)
      document.getElementById('companiesRate').textContent = formatNumber(data.rates.companies) + '/min';
      document.getElementById('contactsRate').textContent = formatNumber(data.rates.contacts) + '/min';
      document.getElementById('websitesRate').textContent = formatNumber(data.rates.websites) + '/min';
      document.getElementById('phonesRate').textContent = formatNumber(data.rates.phones) + '/min';
      document.getElementById('emailsRate').textContent = formatNumber(data.rates.emails) + '/min';
      document.getElementById('emailFormatsRate').textContent = formatNumber(data.rates.emailFormats) + '/min';

      // Add pulse animation to updated values
      document.querySelectorAll('.stat-value').forEach(el => {
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 1000);
      });
    };

    function updateDiff(elementId, value) {
      const el = document.getElementById(elementId);
      el.textContent = formatDiff(value);
      el.className = 'stat-diff';
      if (value > 0) el.classList.add('positive');
      else if (value < 0) el.classList.add('negative');
    }

    eventSource.onerror = () => {
      document.getElementById('lastUpdate').textContent = 'Connection lost... reconnecting...';
    };
  </script>
</body>
</html>
  `);
});

// Initialize and start server
async function startServer() {
  console.log('\n🚀 Starting Web Dashboard...\n');

  // Initialize previous stats
  const initialStats = await getStats();
  if (initialStats) {
    previousStats = {
      companies: parseInt(initialStats.companies),
      contacts: parseInt(initialStats.contacts),
      websites: parseInt(initialStats.websites),
      phones: parseInt(initialStats.phones),
      emails: parseInt(initialStats.emails),
      emailFormats: parseInt(initialStats.email_formats),
      lastUpdate: Date.now()
    };
  }

  // Broadcast stats every 5 seconds
  setInterval(broadcastStats, 5000);

  app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║   🔥  FAST MODE++ WEB DASHBOARD - LIVE MONITOR  🔥        ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`   🌐 Dashboard URL: http://localhost:${PORT}`);
    console.log('   📊 Real-time updates every 5 seconds');
    console.log('   🎯 Auto-refresh with Server-Sent Events');
    console.log('');
    console.log('   👉 Open the URL in your browser to watch live progress!');
    console.log('');
    console.log('   Press Ctrl+C to stop the dashboard');
    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
  });
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n\n✅ Dashboard stopped.\n');
  await pool.end();
  process.exit(0);
});

startServer();
