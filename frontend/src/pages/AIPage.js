/**
 * AI Assistant Page — powered by local Llama 3.2 1B
 *
 * Features:
 *  - Chat with Llama (freeform Q&A)
 *  - Natural language process control ("start cleaner", "stop enrichment", etc.)
 *  - Start / Stop LLM Cleaner
 *  - Trigger enrichment pass
 *  - Run validation batch
 *  - Live DB stats (companies, contacts, enriched)
 *  - System health panel
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// Use relative URLs so the React dev proxy handles CORS automatically.
// Falls back to absolute only when REACT_APP_API_URL is explicitly set (production).
const API = process.env.REACT_APP_API_URL || '';

async function apiFetch(path, options) {
  const r = await fetch(`${API}${path}`, options);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Server responded ${r.status}: ${body.slice(0, 120)}`);
  }
  return r.json();
}

// ─── Command parser ─────────────────────────────────────────────
function parseCommand(text) {
  const t = text.toLowerCase().trim();
  if (/start.*(clean|llm|fake|validat)/.test(t)) return 'cleaner:start';
  if (/stop.*(clean|llm|fake|validat)/.test(t)) return 'cleaner:stop';
  if (/(status|health|system|overview|how is|is it|running)/.test(t) && /(system|server|backend|clean|agent|process)/.test(t)) return 'system:status';
  if (/how many.*(compan|account|record)/.test(t) || /count.*(compan|account)/.test(t)) return 'db:companies';
  if (/how many.*(contact|person|people)/.test(t)) return 'db:contacts';
  if (/db stats|database stats|show stats|data stats/.test(t)) return 'db:stats';
  if (/(trigger|start|run|do).*(enrich)/.test(t)) return 'enrich:trigger';
  if (/(run|start|do).*(validat|clean|batch)/.test(t)) return 'validate:batch';
  if (/(validate|check|is this).*(email)/.test(t)) return 'validate:email';
  if (/(validate|check|is this).*(company|name)/.test(t)) return 'validate:company';
  if (/(cleaner|cleaning) stats/.test(t)) return 'cleaner:stats';
  return null;
}

// ─── System call executor ────────────────────────────────────────
async function executeCommand(cmd, rawText) {
  switch (cmd) {
    case 'cleaner:start': {
      const d = await apiFetch('/api/llm/cleaner/start', { method: 'POST' });
      return { type: 'system', text: d.message, ok: d.success };
    }
    case 'cleaner:stop': {
      const d = await apiFetch('/api/llm/cleaner/stop', { method: 'POST' });
      return { type: 'system', text: d.message, ok: d.success };
    }
    case 'system:status': {
      const d = await apiFetch('/api/llm/system/status');
      return { type: 'system-status', data: d };
    }
    case 'db:stats':
    case 'db:companies':
    case 'db:contacts': {
      const d = await apiFetch('/api/llm/db/stats');
      if (d.dbOnline === false) {
        return { type: 'system', text: `Database is waking up (Neon cold start). Try again in ~10 seconds.\n${d.dbError || ''}`, ok: false };
      }
      return { type: 'db-stats', data: d };
    }
    case 'enrich:trigger': {
      const d = await apiFetch('/api/llm/enrich/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      });
      return { type: 'system', text: d.message, ok: d.success !== false };
    }
    case 'validate:batch': {
      const d = await apiFetch('/api/llm/validate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'companies', limit: 5 }),
      });
      return { type: 'system', text: `Validated ${d.processed ?? 0} records.`, ok: d.success !== false };
    }
    case 'validate:email': {
      // eslint-disable-next-line no-useless-escape
      const match = rawText.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
      if (!match) return { type: 'system', text: 'No email address detected in your message.', ok: false };
      const d = await apiFetch('/api/llm/validate/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: match[0] }),
      });
      return { type: 'validate-result', label: match[0], data: d };
    }
    case 'validate:company': {
      const match = rawText.match(/["']([^"']+)["']/) || rawText.match(/company[:\s]+([A-Z][^\n?]+)/i);
      const name = match ? match[1] : rawText.replace(/validate|company|check|is this/gi, '').trim();
      const d = await apiFetch('/api/llm/validate/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return { type: 'validate-result', label: name, data: d };
    }
    case 'cleaner:stats': {
      const d = await apiFetch('/api/llm/cleaner/stats');
      return { type: 'cleaner-stats', data: d };
    }
    default:
      return null;
  }
}

// ─── Message renderer helpers ────────────────────────────────────
function SystemStatusCard({ data }) {
  const s = data?.server ?? {};
  const db = data?.db ?? {};
  const llm = data?.llm ?? {};
  const cl = data?.cleaner ?? {};
  return (
    <div className="ai-result-card">
      <div className="ai-result-title">System Status</div>
      <div className="ai-result-row"><span className="ai-result-label">LLM</span><span className={`ai-badge ${llm.available ? 'ok' : 'err'}`}>{llm.available ? `● Online — ${llm.model}` : '● Offline'}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">Uptime</span><span className="ai-result-value">{s.uptime ? `${Math.floor(s.uptime / 60)}m ${s.uptime % 60}s` : 'N/A'}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">Memory</span><span className="ai-result-value">{s.memory ?? 'N/A'}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">Accounts</span><span className="ai-result-value">{Number(db.accounts ?? 0).toLocaleString()}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">Contacts</span><span className="ai-result-value">{Number(db.contacts ?? 0).toLocaleString()}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">LLM Cleaner</span><span className={`ai-badge ${cl.running ? 'ok' : 'warn'}`}>{cl.running ? '● Running' : '● Stopped'}</span></div>
      <div className="ai-result-row"><span className="ai-result-label">Fake flagged</span><span className="ai-result-value">{Number(cl.companiesFlagged ?? 0).toLocaleString()}</span></div>
    </div>
  );
}

function DbStatsCard({ data }) {
  return (
    <div className="ai-result-card">
      <div className="ai-result-title">Database Stats</div>
      {[
        ['Companies (CH)', data?.companies],
        ['Accounts',       data?.accounts],
        ['Contacts',       data?.contacts],
        ['With website',   data?.accountsEnriched],
        ['With email',     data?.contactsWithEmail],
        ['Fake flagged',   data?.fakeFlagged],
      ].map(([label, val]) => (
        <div className="ai-result-row" key={label}>
          <span className="ai-result-label">{label}</span>
          <span className="ai-result-value">{typeof val === 'number' ? val.toLocaleString() : (val ?? 'N/A')}</span>
        </div>
      ))}
    </div>
  );
}

function CleanerStatsCard({ data }) {
  return (
    <div className="ai-result-card">
      <div className="ai-result-title">LLM Cleaner Stats</div>
      <div className="ai-result-row"><span className="ai-result-label">Status</span><span className={`ai-badge ${data?.running ? 'ok' : 'warn'}`}>{data?.running ? '● Running' : '● Stopped'}</span></div>
      {data?.startedAt && <div className="ai-result-row"><span className="ai-result-label">Started</span><span className="ai-result-value">{new Date(data.startedAt).toLocaleTimeString()}</span></div>}
      {[
        ['Companies scanned', data?.companiesScanned],
        ['Fake flagged',      data?.companiesFlagged],
        ['Companies fixed',   data?.companiesFixed],
        ['Contacts scanned',  data?.contactsScanned],
        ['Contacts removed',  data?.contactsRemoved],
        ['Fields nullified',  data?.fieldsNullified],
      ].map(([label, val]) => (
        <div className="ai-result-row" key={label}>
          <span className="ai-result-label">{label}</span>
          <span className="ai-result-value">{(val ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function ValidateCard({ label, data }) {
  const valid = data?.nameValid !== false && !data?.fieldsToNullify?.length && data?.valid !== false;
  return (
    <div className="ai-result-card">
      <div className="ai-result-title">Validation: <em>{label}</em></div>
      <div className="ai-result-row">
        <span className="ai-result-label">Result</span>
        <span className={`ai-badge ${valid ? 'ok' : 'err'}`}>{valid ? '✓ Valid' : '✗ Invalid / Suspicious'}</span>
      </div>
      {data?.reason && <div className="ai-result-row"><span className="ai-result-label">Reason</span><span className="ai-result-value">{data.reason}</span></div>}
      {data?.reasons?.length > 0 && <div className="ai-result-row"><span className="ai-result-label">Reasons</span><span className="ai-result-value">{data.reasons.join(', ')}</span></div>}
      {data?.fieldsToNullify?.length > 0 && <div className="ai-result-row"><span className="ai-result-label">Bad fields</span><span className="ai-result-value ai-err">{data.fieldsToNullify.join(', ')}</span></div>}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  if (isUser) {
    return (
      <div className="ai-bubble ai-bubble-user">
        <div className="ai-bubble-text">{msg.text}</div>
        <div className="ai-bubble-time">{msg.time}</div>
      </div>
    );
  }

  return (
    <div className="ai-bubble ai-bubble-ai">
      <div className="ai-bubble-avatar">🤖</div>
      <div className="ai-bubble-body">
        {msg.text && <div className="ai-bubble-text">{msg.text}</div>}
        {msg.resultType === 'system-status' && <SystemStatusCard data={msg.data} />}
        {msg.resultType === 'db-stats' && <DbStatsCard data={msg.data} />}
        {msg.resultType === 'cleaner-stats' && <CleanerStatsCard data={msg.data} />}
        {msg.resultType === 'validate-result' && <ValidateCard label={msg.label} data={msg.data} />}
        {msg.suggestions?.length > 0 && (
          <div className="ai-suggestions">
            {msg.suggestions.map(s => (
              <button key={s} className="ai-suggestion-chip" onClick={() => msg.onSuggest?.(s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="ai-bubble-time">{msg.time}</div>
      </div>
    </div>
  );
}

// ─── Sidebar status panel ────────────────────────────────────────
function StatusPanel({ status, dbStats, onAction }) {
  const cl = status?.cleaner ?? {};
  const llm = status?.llm ?? {};
  const db = dbStats ?? {};

  return (
    <div className="ai-panel">
      {/* LLM Status */}
      <div className="ai-panel-section">
        <div className="ai-panel-title">Model</div>
        <div className="ai-panel-row">
          <span className={`ai-dot ${llm.available ? 'green' : 'red'}`} />
          <span>{llm.available ? `llama3.2:1b — Online` : 'Offline'}</span>
        </div>
      </div>

      {/* DB quick stats */}
      <div className="ai-panel-section">
        <div className="ai-panel-title">
          Database
          {db.dbOnline === false && (
            <span style={{ color: 'var(--gold)', marginLeft: 6, fontSize: 10 }}>● waking…</span>
          )}
        </div>
        {db.dbOnline === false ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', paddingTop: 2 }}>
            {db.dbError || 'Connecting…'}
          </div>
        ) : (
          <>
            <div className="ai-panel-stat"><span>Accounts</span><strong>{Number(db.accounts || 0).toLocaleString()}</strong></div>
            <div className="ai-panel-stat"><span>Contacts</span><strong>{Number(db.contacts || 0).toLocaleString()}</strong></div>
            <div className="ai-panel-stat"><span>Enriched</span><strong>{Number(db.accountsEnriched || 0).toLocaleString()}</strong></div>
            <div className="ai-panel-stat"><span>Fake flagged</span><strong>{Number(db.fakeFlagged || 0).toLocaleString()}</strong></div>
          </>
        )}
      </div>

      {/* Process Controls */}
      <div className="ai-panel-section">
        <div className="ai-panel-title">Processes</div>
        <div className="ai-process-row">
          <div>
            <div className="ai-process-name">LLM Cleaner</div>
            <div className={`ai-process-status ${cl.running ? 'running' : 'stopped'}`}>{cl.running ? '● Running' : '● Stopped'}</div>
          </div>
          <div className="ai-process-btns">
            <button className={`ai-ctrl-btn start ${cl.running ? 'dim' : ''}`} onClick={() => onAction('cleaner:start')} disabled={cl.running}>Start</button>
            <button className={`ai-ctrl-btn stop ${!cl.running ? 'dim' : ''}`} onClick={() => onAction('cleaner:stop')} disabled={!cl.running}>Stop</button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="ai-panel-section">
        <div className="ai-panel-title">Quick Actions</div>
        <button className="ai-action-btn" onClick={() => onAction('enrich:trigger')}>⚡ Trigger Enrichment (10)</button>
        <button className="ai-action-btn" onClick={() => onAction('validate:batch')}>🛡 Validate Batch</button>
        <button className="ai-action-btn" onClick={() => onAction('system:status')}>📊 System Status</button>
        <button className="ai-action-btn" onClick={() => onAction('db:stats')}>🗄 DB Stats</button>
        <button className="ai-action-btn" onClick={() => onAction('cleaner:stats')}>📈 Cleaner Stats</button>
      </div>
    </div>
  );
}

// ─── Suggested prompts ───────────────────────────────────────────
const SUGGESTIONS = [
  'What is the system status?',
  'How many companies are in the database?',
  'Start the LLM cleaner',
  'Show database stats',
  'Trigger enrichment',
  'What is llama3.2?',
  'How does the LLM cleaner work?',
  'Validate email: test@example.com',
];

const WELCOME_MSG = {
  role: 'ai',
  text: `👋 I'm your AI assistant powered by Llama 3.2 1B running locally on your machine.\n\nI can:\n• Answer questions about your data and platform\n• Start or stop background processes\n• Show live database stats\n• Trigger enrichment and validation\n• Validate emails, company names, and contacts\n• Explain what every feature does\n\nJust ask me anything or use the controls on the right →`,
  suggestions: ['System status', 'How many accounts?', 'Start cleaner', 'DB stats'],
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

// ─── Main Page ───────────────────────────────────────────────────
export default function AIPage() {
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Poll status every 15 seconds
  const refreshStatus = useCallback(async () => {
    try {
      const [s, d] = await Promise.allSettled([
        apiFetch('/api/llm/system/status'),
        apiFetch('/api/llm/db/stats'),
      ]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (d.status === 'fulfilled') setDbStats(d.value);
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 15000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const pushMsg = (msg) => setMessages(prev => [...prev, msg]);

  const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Execute a system command and push result message
  const runSystemAction = useCallback(async (cmd, rawText = '') => {
    setLoading(true);
    try {
      const result = await executeCommand(cmd, rawText);
      if (!result) return;

      const msg = {
        role: 'ai',
        time: time(),
      };

      if (result.type === 'system') {
        msg.text = result.ok ? `✅ ${result.text}` : `⚠️ ${result.text}`;
      } else if (result.type === 'system-status') {
        msg.text = 'Here\'s the current system overview:';
        msg.resultType = 'system-status';
        msg.data = result.data;
      } else if (result.type === 'db-stats') {
        msg.text = 'Here are the current database statistics:';
        msg.resultType = 'db-stats';
        msg.data = result.data;
      } else if (result.type === 'cleaner-stats') {
        msg.text = 'Current LLM cleaner statistics:';
        msg.resultType = 'cleaner-stats';
        msg.data = result.data;
      } else if (result.type === 'validate-result') {
        msg.text = 'Validation result:';
        msg.resultType = 'validate-result';
        msg.label = result.label;
        msg.data = result.data;
      }

      pushMsg(msg);
      refreshStatus();
    } catch (err) {
      pushMsg({ role: 'ai', text: `❌ Error: ${err.message}`, time: time() });
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  const sendMessage = async (text) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput('');

    pushMsg({ role: 'user', text: userText, time: time() });
    setLoading(true);

    // Try to parse as a system command first
    const cmd = parseCommand(userText);
    if (cmd) {
      setLoading(false);
      await runSystemAction(cmd, userText);
      return;
    }

    // Otherwise — send to Llama
    try {
      const d = await apiFetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          context: 'You are an AI assistant for Data Bunker, a business intelligence platform. You help users manage company data, contacts, enrichment processes, and data quality. Be helpful and concise.',
        }),
      });
      pushMsg({
        role: 'ai',
        text: d.answer || d.response || 'I received your message but could not form a response.',
        time: time(),
      });
    } catch (err) {
      const isNetwork = err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed');
      pushMsg({
        role: 'ai',
        text: isNetwork
          ? `⚠️ Cannot reach the backend server. Make sure it is running:\n\n  cd backend && npm run dev\n\nError: ${err.message}`
          : `⚠️ Llama is not responding. Start Ollama:\n\n  ollama serve\n\nError: ${err.message}`,
        time: time(),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSuggest = (s) => {
    setInput(s);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="ai-page">
      {/* ── Chat column ─────────────────────────────────────── */}
      <div className="ai-chat-col">
        {/* Header */}
        <div className="ai-chat-header">
          <div className="ai-chat-header-left">
            <div className="ai-model-badge">
              <span className={`ai-dot ${status?.llm?.available ? 'green' : 'red'}`} />
              <span>llama3.2:1b</span>
            </div>
            <span className="ai-chat-subtitle">Local AI — full data control</span>
          </div>
          <button className="ai-clear-btn" onClick={() => setMessages([WELCOME_MSG])}>Clear</button>
        </div>

        {/* Messages */}
        <div className="ai-messages">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={{ ...msg, onSuggest: handleSuggest }}
            />
          ))}
          {loading && (
            <div className="ai-bubble ai-bubble-ai">
              <div className="ai-bubble-avatar">🤖</div>
              <div className="ai-bubble-body">
                <div className="ai-thinking">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestion chips */}
        <div className="ai-suggestion-strip">
          {SUGGESTIONS.slice(0, 5).map(s => (
            <button key={s} className="ai-suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
          ))}
        </div>

        {/* Input */}
        <div className="ai-input-row">
          <textarea
            ref={inputRef}
            className="ai-input"
            placeholder="Ask Llama anything, or type a command: 'start cleaner', 'how many companies', 'validate email: x@y.com'…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <button
            className="ai-send-btn"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
          >
            {loading ? '…' : '↑'}
          </button>
        </div>
      </div>

      {/* ── Right control panel ─────────────────────────────── */}
      <StatusPanel
        status={status}
        dbStats={dbStats}
        onAction={(cmd) => runSystemAction(cmd)}
      />
    </div>
  );
}
