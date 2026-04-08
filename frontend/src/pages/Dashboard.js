import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const STAT_CARDS = [
  { label: 'Total Accounts',    value: '6M+',  sub: 'companies indexed',    accent: 'purple', icon: '🏢' },
  { label: 'Contacts',          value: '—',    sub: 'loading…',             accent: 'teal',   icon: '👤', live: 'contacts' },
  { label: 'Countries',         value: '2',    sub: 'UK & US',              accent: 'gold',   icon: '🌍' },
  { label: 'LLM Cleaned Today', value: '—',    sub: 'records validated',    accent: 'green',  icon: '🛡', live: 'cleaned' },
];

const NAV_TILES = [
  { to: '/accounts',   icon: '🏢', label: 'Accounts',    desc: 'Browse 6M+ companies',         accent: 'purple' },
  { to: '/contacts',   icon: '👤', label: 'Contacts',    desc: 'Verified business contacts',    accent: 'teal' },
  { to: '/discovery',  icon: '🔭', label: 'Discovery',   desc: 'Live company discovery map',    accent: 'blue' },
  { to: '/enrichment', icon: '✦',  label: 'AI Enrichment','desc': 'Enrich & validate data',     accent: 'gold' },
];

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`db-stat-card db-stat-card--${accent}`}>
      <div className="db-stat-card-header">
        <span className="db-stat-card-label">{label}</span>
        <span className="db-stat-card-icon">{icon}</span>
      </div>
      <div className="db-stat-card-value">{value}</div>
      <div className="db-stat-card-sub">{sub}</div>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState({ contacts: '—', cleaned: '—' });

  useEffect(() => {
    fetch('/api/contacts?limit=0')
      .then(r => r.json())
      .then(d => {
        const count = d.total ?? d.count ?? d.pagination?.total;
        if (count != null) setStats(s => ({ ...s, contacts: Number(count).toLocaleString() }));
      })
      .catch(() => {});

    fetch('/api/llm/cleaner/stats')
      .then(r => r.json())
      .then(d => {
        const n = (d.companiesFlagged ?? 0) + (d.contactsRemoved ?? 0);
        setStats(s => ({ ...s, cleaned: n.toLocaleString() }));
      })
      .catch(() => {});
  }, []);

  const cards = STAT_CARDS.map(c => ({
    ...c,
    value: c.live === 'contacts' ? stats.contacts
         : c.live === 'cleaned'  ? stats.cleaned
         : c.value,
    sub: c.live === 'contacts' && stats.contacts !== '—' ? 'verified contacts'
       : c.live === 'cleaned'  && stats.cleaned  !== '—' ? 'records validated'
       : c.sub,
  }));

  return (
    <div className="db-home">
      {/* Hero */}
      <section className="db-hero">
        <div className="db-hero-glow" />
        <div className="db-hero-content">
          <span className="db-hero-eyebrow">Business Intelligence Platform</span>
          <h2 className="db-hero-title">
            Your Data,<br />
            <span className="db-hero-accent">Fully Enriched.</span>
          </h2>
          <p className="db-hero-desc">
            Discover, enrich, and validate millions of company records with AI-powered accuracy.
            Real-time agents run 24/7 so your database stays clean and useful.
          </p>
          <div className="db-hero-actions">
            <Link to="/accounts" className="db-btn-primary">Browse Accounts</Link>
            <Link to="/discovery" className="db-btn-ghost">View Discovery Map →</Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="db-section">
        <div className="db-section-header">
          <h3 className="db-section-title">Platform Overview</h3>
          <span className="db-section-badge live">● Live</span>
        </div>
        <div className="db-grid-4">
          {cards.map(c => <StatCard key={c.label} {...c} />)}
        </div>
      </section>

      {/* Navigation tiles */}
      <section className="db-section">
        <div className="db-section-header">
          <h3 className="db-section-title">Quick Access</h3>
        </div>
        <div className="db-grid-4">
          {NAV_TILES.map(t => (
            <Link key={t.to} to={t.to} className={`db-tile db-tile--${t.accent}`}>
              <div className="db-tile-icon">{t.icon}</div>
              <div className="db-tile-body">
                <div className="db-tile-label">{t.label}</div>
                <div className="db-tile-desc">{t.desc}</div>
              </div>
              <div className="db-tile-arrow">→</div>
            </Link>
          ))}
        </div>
      </section>

      {/* System status strip */}
      <section className="db-section">
        <div className="db-status-strip">
          <div className="db-status-item">
            <span className="db-status-dot green" />
            <span>Backend API</span>
          </div>
          <div className="db-status-item">
            <span className="db-status-dot green" />
            <span>Ollama LLM</span>
          </div>
          <div className="db-status-item">
            <span className="db-status-dot green" />
            <span>9 Agents Running</span>
          </div>
          <div className="db-status-item">
            <span className="db-status-dot teal" />
            <span>Database Connected</span>
          </div>
          <div className="db-status-sep" />
          <span className="db-status-version">llama3.2:1b · v3.0 Pro</span>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
