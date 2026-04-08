import React, { useState, useEffect, useCallback, useRef } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/* ── Agent registry (mirrors backend) ─────────────────────────────────────── */
const CATEGORIES = [
  {
    id: 'discovery',
    label: 'Discovery',
    icon: '🔭',
    color: 'var(--accent)',
    agents: [
      { id: 'company-discovery', icon: '🌍', name: 'Company Discovery', desc: 'Open-web company finder via Google & Bing' },
      { id: 'companies-house',   icon: '🏛', name: 'Companies House',   desc: 'UK official registry — 5 M+ companies' },
      { id: 'google-maps',       icon: '🗺', name: 'Google Maps',       desc: 'Local business scraper (Maps data)' },
    ],
  },
  {
    id: 'enrichment',
    label: 'Enrichment',
    icon: '✦',
    color: 'var(--teal)',
    agents: [
      { id: 'contact-finder',  icon: '👤', name: 'Contact Finder',  desc: 'Locates decision-maker contacts' },
      { id: 'email-finder',    icon: '📧', name: 'Email Finder',    desc: 'Discovers & validates email addresses' },
      { id: 'phone-finder',    icon: '📞', name: 'Phone Finder',    desc: 'Extracts and validates phone numbers' },
      { id: 'website-finder',  icon: '🌐', name: 'Website Finder',  desc: 'Finds official company websites' },
      { id: 'social-media',    icon: '📱', name: 'Social Media',    desc: 'LinkedIn, Twitter, Facebook profiles' },
      { id: 'address-enricher',icon: '📍', name: 'Address Enricher',desc: 'Resolves & normalises postal addresses' },
      { id: 'linkedin-scraper',icon: '💼', name: 'LinkedIn Scraper',desc: 'Profile & company page scraper' },
    ],
  },
  {
    id: 'quality',
    label: 'Quality & AI',
    icon: '🤖',
    color: 'var(--gold)',
    agents: [
      { id: 'industry-classifier', icon: '🏷', name: 'Industry Classifier', desc: 'AI-powered SIC/NACE industry tagging' },
      { id: 'data-quality',        icon: '🛡', name: 'Data Quality',        desc: 'Deduplication, formatting & scoring' },
      { id: 'qwen-enricher',       icon: '⚡', name: 'Qwen AI Enricher',    desc: 'Local LLM contact extraction (Qwen)' },
    ],
  },
];

const FOCUS_OPTIONS = [
  { key: 'emails',    label: '📧 Emails' },
  { key: 'phones',    label: '📞 Phones' },
  { key: 'websites',  label: '🌐 Websites' },
  { key: 'contacts',  label: '👤 Contacts' },
  { key: 'companies', label: '🏢 Companies' },
  { key: 'addresses', label: '📍 Addresses' },
  { key: 'social',    label: '📱 Social' },
];

const DEFAULT_CONFIG = { focus: ['emails','phones','websites'], concurrency: 3, batchSize: 50, delayMs: 1000 };

/* ── helpers ──────────────────────────────────────────────────────────────── */
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function elapsed(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ── AgentCard ────────────────────────────────────────────────────────────── */
function AgentCard({ agent, status = {}, catColor, onStart, onStop, onConfig }) {
  const [configOpen, setConfigOpen] = useState(false);
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [logs, setLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isRunning = status.running;
  const uptime = isRunning && status.startedAt ? elapsed(Date.now() - new Date(status.startedAt).getTime()) : null;

  const fetchLogs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/agents/${agent.id}/logs`);
      const d = await r.json();
      setLogs(d.logs || []);
    } catch { setLogs([]); }
  }, [agent.id]);

  useEffect(() => {
    if (logsOpen) fetchLogs();
  }, [logsOpen, fetchLogs, status.running]);

  const toggleFocus = (key) => {
    setCfg(c => ({
      ...c,
      focus: c.focus.includes(key) ? c.focus.filter(k => k !== key) : [...c.focus, key],
    }));
  };

  const handleStart = async () => {
    setLoading(true);
    await onStart(agent.id, cfg);
    setLoading(false);
    setConfigOpen(false);
  };

  const handleStop = async () => {
    setLoading(true);
    await onStop(agent.id);
    setLoading(false);
  };

  return (
    <div className={`army-card${isRunning ? ' army-card--running' : ''}`} style={{ '--cat-color': catColor }}>
      {/* Header */}
      <div className="army-card-head">
        <span className="army-card-icon">{agent.icon}</span>
        <div className="army-card-info">
          <div className="army-card-name">{agent.name}</div>
          <div className="army-card-desc">{agent.desc}</div>
        </div>
        <div className="army-card-status">
          <span className={`army-dot${isRunning ? ' army-dot--on' : ''}`} />
          <span className="army-dot-label">{isRunning ? 'Running' : 'Stopped'}</span>
        </div>
      </div>

      {/* Meta */}
      {isRunning && (
        <div className="army-meta">
          <span>⏱ {uptime}</span>
          {status.processed != null && <span>📦 {fmt(status.processed)} processed</span>}
          {status.saved     != null && <span>💾 {fmt(status.saved)} saved</span>}
        </div>
      )}

      {/* Actions */}
      <div className="army-actions">
        {isRunning ? (
          <button className="army-btn army-btn--stop" onClick={handleStop} disabled={loading}>
            {loading ? '…' : '⏹ Stop'}
          </button>
        ) : (
          <button className="army-btn army-btn--start" onClick={handleStart} disabled={loading}>
            {loading ? '…' : '▶ Start'}
          </button>
        )}
        <button className="army-btn army-btn--cfg" onClick={() => setConfigOpen(o => !o)}>
          ⚙ Config
        </button>
        <button className="army-btn army-btn--log" onClick={() => setLogsOpen(o => !o)}>
          {logsOpen ? '▲ Hide Logs' : '▼ Logs'}
        </button>
      </div>

      {/* Config panel */}
      {configOpen && (
        <div className="army-config">
          <div className="army-config-label">Focus Areas</div>
          <div className="army-focus-grid">
            {FOCUS_OPTIONS.map(f => (
              <label key={f.key} className={`army-focus-chip${cfg.focus.includes(f.key) ? ' active' : ''}`}>
                <input
                  type="checkbox"
                  checked={cfg.focus.includes(f.key)}
                  onChange={() => toggleFocus(f.key)}
                  style={{ display: 'none' }}
                />
                {f.label}
              </label>
            ))}
          </div>

          <div className="army-config-row">
            <div className="army-config-field">
              <label>Concurrency</label>
              <div className="army-slider-row">
                <input
                  type="range" min={1} max={10} value={cfg.concurrency}
                  onChange={e => setCfg(c => ({ ...c, concurrency: +e.target.value }))}
                />
                <span>{cfg.concurrency}</span>
              </div>
            </div>
            <div className="army-config-field">
              <label>Batch Size</label>
              <input
                type="number" min={1} max={500} value={cfg.batchSize}
                onChange={e => setCfg(c => ({ ...c, batchSize: +e.target.value }))}
                className="army-input"
              />
            </div>
            <div className="army-config-field">
              <label>Delay (ms)</label>
              <input
                type="number" min={0} max={10000} value={cfg.delayMs}
                onChange={e => setCfg(c => ({ ...c, delayMs: +e.target.value }))}
                className="army-input"
              />
            </div>
          </div>

          {!isRunning && (
            <button className="army-btn army-btn--start" style={{ marginTop: 8 }} onClick={handleStart} disabled={loading}>
              {loading ? '…' : '▶ Start with this config'}
            </button>
          )}
        </div>
      )}

      {/* Log tail */}
      {logsOpen && (
        <div className="army-logs">
          <div className="army-logs-head">
            <span>Last logs</span>
            <button className="army-logs-refresh" onClick={fetchLogs}>↺ Refresh</button>
          </div>
          <div className="army-logs-body">
            {logs.length === 0
              ? <span className="army-logs-empty">No logs yet.</span>
              : logs.slice(-10).map((line, i) => <div key={i} className="army-log-line">{line}</div>)
            }
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main ArmyPage ────────────────────────────────────────────────────────── */
export default function ArmyPage() {
  const [statuses, setStatuses] = useState({});
  const [globalStats, setGlobalStats]   = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [toast, setToast]               = useState(null);
  const pollRef = useRef(null);

  /* ── fetch status ── */
  const fetchStatuses = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/agents/status`);
      const d = await r.json();
      // API returns agents as array — convert to id-keyed object
      const agentList = d.agents || [];
      const keyed = {};
      agentList.forEach(a => { keyed[a.id] = a.status || {}; });
      setStatuses(keyed);
    } catch { /* silent */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/agents/stats`);
      const d = await r.json();
      setGlobalStats(d.stats || d);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatuses();
    fetchStats();
    pollRef.current = setInterval(() => { fetchStatuses(); fetchStats(); }, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatuses, fetchStats]);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* ── per-agent actions ── */
  const startAgent = async (id, cfg) => {
    try {
      const r = await fetch(`${API}/api/agents/${id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      showToast(`${id} started`);
      fetchStatuses();
    } catch (e) { showToast(e.message, 'err'); }
  };

  const stopAgent = async (id) => {
    try {
      const r = await fetch(`${API}/api/agents/${id}/stop`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      showToast(`${id} stopped`);
      fetchStatuses();
    } catch (e) { showToast(e.message, 'err'); }
  };

  /* ── batch actions ── */
  const startCategory = async (catId) => {
    setBatchLoading(true);
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    try {
      await fetch(`${API}/api/agents/start-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: cat.agents.map(a => a.id), config: DEFAULT_CONFIG }),
      });
      showToast(`All ${cat.label} agents started`);
      fetchStatuses();
    } catch (e) { showToast(e.message, 'err'); }
    setBatchLoading(false);
  };

  const stopAll = async () => {
    setBatchLoading(true);
    try {
      await fetch(`${API}/api/agents/stop-all`, { method: 'POST' });
      showToast('All agents stopped');
      fetchStatuses();
    } catch (e) { showToast(e.message, 'err'); }
    setBatchLoading(false);
  };

  const runningCount = Object.values(statuses).filter(s => s.running).length;

  return (
    <div className="army-page">
      {/* ── Toast ── */}
      {toast && (
        <div className={`army-toast army-toast--${toast.type}`}>{toast.msg}</div>
      )}

      {/* ── Stats bar ── */}
      <div className="army-stats-bar">
        {[
          { label: 'Running Agents', value: runningCount, accent: true },
          { label: 'Total Contacts', value: fmt(globalStats?.totalContacts) },
          { label: 'Emails Found',   value: fmt(globalStats?.withEmail) },
          { label: 'Phones Found',   value: fmt(globalStats?.withPhone) },
          { label: 'Websites Found', value: fmt(globalStats?.withWebsite) },
          { label: 'Companies',      value: fmt(globalStats?.totalCompanies) },
        ].map(stat => (
          <div key={stat.label} className={`army-stat${stat.accent ? ' army-stat--accent' : ''}`}>
            <div className="army-stat-val">{stat.value}</div>
            <div className="army-stat-lbl">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── Global controls ── */}
      <div className="army-global-ctrl">
        <div className="army-global-title">
          <span className="army-global-icon">⚔️</span>
          <span>Army Command Centre</span>
        </div>
        <div className="army-global-btns">
          <button className="army-batch-btn army-batch-btn--discovery" onClick={() => startCategory('discovery')} disabled={batchLoading}>
            🔭 Start All Discovery
          </button>
          <button className="army-batch-btn army-batch-btn--enrichment" onClick={() => startCategory('enrichment')} disabled={batchLoading}>
            ✦ Start All Enrichment
          </button>
          <button className="army-batch-btn army-batch-btn--quality" onClick={() => startCategory('quality')} disabled={batchLoading}>
            🤖 Start Quality AI
          </button>
          <button className="army-batch-btn army-batch-btn--stop" onClick={stopAll} disabled={batchLoading}>
            ⏹ Stop All
          </button>
        </div>
      </div>

      {/* ── Category sections ── */}
      {CATEGORIES.map(cat => {
        const running = cat.agents.filter(a => statuses[a.id]?.running).length;
        return (
          <section key={cat.id} className="army-section">
            <div className="army-section-head" style={{ '--cat-color': cat.color }}>
              <span className="army-section-icon">{cat.icon}</span>
              <div>
                <div className="army-section-title">{cat.label}</div>
                <div className="army-section-sub">{running}/{cat.agents.length} running</div>
              </div>
              <div className="army-section-ctrl">
                <button
                  className="army-section-btn"
                  style={{ borderColor: cat.color, color: cat.color }}
                  onClick={() => startCategory(cat.id)}
                  disabled={batchLoading}
                >
                  ▶ Start All
                </button>
              </div>
            </div>

            <div className="army-cards-grid">
              {cat.agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  status={statuses[agent.id] || {}}
                  catColor={cat.color}
                  onStart={startAgent}
                  onStop={stopAgent}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
