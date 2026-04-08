import React, { useState } from 'react';

const FEATURES = [
  {
    icon: '🔍',
    title: 'Stealth LinkedIn Scraper',
    desc: 'Silently captures contact details from LinkedIn profiles and search results without triggering detection.',
    accent: 'purple',
  },
  {
    icon: '🤖',
    title: 'Qwen AI Enrichment',
    desc: 'Automatically enriches scraped contacts with AI-powered name parsing, role classification, and data validation.',
    accent: 'teal',
  },
  {
    icon: '🗄️',
    title: 'Direct Database Sync',
    desc: 'Saves contacts directly to your Data Bunker Neon database in real-time — no CSV exports needed.',
    accent: 'blue',
  },
  {
    icon: '⚡',
    title: 'One-Click Capture',
    desc: 'Popup interface lets you scrape the current page with a single click, showing live status and counts.',
    accent: 'gold',
  },
];

const STEPS = [
  { num: '01', title: 'Download the ZIP', desc: 'Click the download button below to get the latest extension package.' },
  { num: '02', title: 'Open Chrome Extensions', desc: 'Navigate to chrome://extensions in your browser and enable Developer Mode.' },
  { num: '03', title: 'Load Unpacked', desc: 'Click "Load unpacked" and select the unzipped extension folder.' },
  { num: '04', title: 'Start Scraping', desc: 'Visit any LinkedIn page, click the Data Bunker icon, and hit "Scrape".' },
];

export default function ExtensionPage() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch('/api/extension/download');
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data-bunker-extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="db-home">
      {/* Hero */}
      <section className="db-hero" style={{ marginBottom: '32px' }}>
        <div className="db-hero-glow" />
        <div className="db-hero-content">
          <span className="db-hero-eyebrow">Browser Extension</span>
          <h2 className="db-hero-title">
            LinkedIn Scraper,<br />
            <span className="db-hero-accent">Supercharged.</span>
          </h2>
          <p className="db-hero-desc">
            Capture contacts from LinkedIn instantly and sync them straight to your Data Bunker
            database with AI enrichment — no copy-pasting, no CSV wrangling.
          </p>
          <div className="db-hero-actions" style={{ alignItems: 'center', gap: '12px' }}>
            <button
              className="db-btn-primary"
              onClick={handleDownload}
              disabled={downloading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '15px',
                padding: '12px 28px',
                opacity: downloading ? 0.7 : 1,
                cursor: downloading ? 'not-allowed' : 'pointer',
              }}
            >
              {downloading ? (
                <>
                  <span className="ext-spin">⟳</span>
                  Preparing download…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download Extension (.zip)
                </>
              )}
            </button>
            <span style={{ color: 'var(--text-2)', fontSize: '13px' }}>
              v1.1.0 · Chrome / Chromium · Free
            </span>
          </div>
          {error && (
            <p style={{ color: 'var(--red)', marginTop: '12px', fontSize: '13px' }}>
              ⚠ {error}
            </p>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="db-section">
        <div className="db-section-header">
          <h3 className="db-section-title">What's Inside</h3>
          <span className="db-section-badge">4 Features</span>
        </div>
        <div className="db-grid-4">
          {FEATURES.map(f => (
            <div key={f.title} className={`db-stat-card db-stat-card--${f.accent}`}>
              <div className="db-stat-card-header">
                <span className="db-stat-card-label">{f.title}</span>
                <span className="db-stat-card-icon">{f.icon}</span>
              </div>
              <p style={{ color: 'var(--text-2)', fontSize: '13px', margin: '8px 0 0', lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Installation Steps */}
      <section className="db-section">
        <div className="db-section-header">
          <h3 className="db-section-title">Installation Guide</h3>
          <span className="db-section-badge">4 Steps</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
          {STEPS.map(step => (
            <div
              key={step.num}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '20px 22px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '28px',
                  lineHeight: 1,
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-l))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {step.num}
              </span>
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-1)' }}>{step.title}</span>
              <span style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.6 }}>{step.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Requirements */}
      <section className="db-section">
        <div className="db-section-header">
          <h3 className="db-section-title">Requirements</h3>
        </div>
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '20px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '24px',
          }}
        >
          {[
            { icon: '🌐', label: 'Chrome 88+', sub: 'or any Chromium browser' },
            { icon: '🔌', label: 'Backend running', sub: 'localhost:5000' },
            { icon: '🗄️', label: 'Neon DB configured', sub: 'connection string in .env' },
            { icon: '🔑', label: 'LinkedIn account', sub: 'any free or premium plan' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '22px' }}>{r.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-1)' }}>{r.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{r.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="db-section" style={{ textAlign: 'center', paddingBottom: '16px' }}>
        <button
          className="db-btn-primary"
          onClick={handleDownload}
          disabled={downloading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '15px',
            padding: '13px 36px',
            opacity: downloading ? 0.7 : 1,
            cursor: downloading ? 'not-allowed' : 'pointer',
          }}
        >
          {downloading ? (
            <><span className="ext-spin">⟳</span> Preparing download…</>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Extension (.zip)
            </>
          )}
        </button>
        <p style={{ color: 'var(--text-3)', fontSize: '12px', marginTop: '10px' }}>
          Unzip, load in Chrome's developer mode, and you're ready to go.
        </p>
      </section>

      <style>{`
        @keyframes ext-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .ext-spin { display: inline-block; animation: ext-spin 0.8s linear infinite; }
      `}</style>
    </div>
  );
}
