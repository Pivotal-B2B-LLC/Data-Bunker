import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import Dashboard from './pages/Dashboard';
import DiscoveryPage from './pages/DiscoveryPage';
import AccountsPage from './pages/AccountsPage';
import ContactsPage from './pages/ContactsPage';
import EnrichmentPage from './pages/EnrichmentPage';
import AIPage from './pages/AIPage';
import ExtensionPage from './pages/ExtensionPage';
import ArmyPage from './pages/ArmyPage';
import './App.css';

const NAV_ITEMS = [
  { to: '/',           icon: '▦',  label: 'Home',         end: true },
  { to: '/ai',         icon: '🤖',  label: 'AI Assistant' },
  { to: '/accounts',   icon: '🏢',  label: 'Accounts' },
  { to: '/contacts',   icon: '👤',  label: 'Contacts' },
  { to: '/discovery',  icon: '🔭',  label: 'Discovery' },
  { to: '/enrichment', icon: '✦',   label: 'AI Enrichment' },
  { to: '/extension', icon: '🧩',  label: 'Extension' },
  { to: '/army',      icon: '⚔️',  label: 'Army' },
];

function Sidebar() {
  return (
    <aside className="db-sidebar">
      <div className="db-sidebar-logo">
        <div className="db-logo-icon">🌍</div>
        <div className="db-logo-text">
          <span className="db-logo-name">Data Bunker</span>
          <span className="db-logo-tag">Pro</span>
        </div>
      </div>

      <nav className="db-nav">
        <span className="db-nav-section">Navigation</span>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `db-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="db-nav-icon">{item.icon}</span>
            <span className="db-nav-label">{item.label}</span>
          </NavLink>
        ))}

        <span className="db-nav-section" style={{ marginTop: '20px' }}>System</span>
        <div className="db-nav-item db-nav-static">
          <span className="db-nav-icon">⚡</span>
          <span className="db-nav-label">LLM Cleaner</span>
          <span className="db-status-dot green" />
        </div>
        <div className="db-nav-item db-nav-static">
          <span className="db-nav-icon">🛡</span>
          <span className="db-nav-label">Validation</span>
          <span className="db-status-dot teal" />
        </div>
      </nav>

      <div className="db-sidebar-footer">
        <div className="db-avatar">DB</div>
        <div className="db-footer-info">
          <span className="db-footer-name">Data Bunker</span>
          <span className="db-footer-role">Administrator</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ theme, toggleTheme }) {
  const location = useLocation();
  const titles = {
    '/': 'Home', '/ai': 'AI Assistant', '/accounts': 'Accounts',
    '/contacts': 'Contacts', '/discovery': 'Discovery', '/enrichment': 'AI Enrichment',
    '/extension': 'Extension Download',
    '/army': 'Army — Agent Control',
  };
  const title = titles[location.pathname] || 'Data Bunker';

  return (
    <header className="db-topbar">
      <h1 className="db-topbar-title">{title}</h1>
      <label className="db-search-box">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="7"/><line x1="15" y1="15" x2="19" y2="19"/>
        </svg>
        <input placeholder="Search companies, contacts…" />
      </label>
      <div className="db-topbar-right">
        <button className="db-icon-btn" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </button>
        <button className="db-theme-toggle" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          }
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

      </div>
    </header>
  );
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : 'light-mode';
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <Router>
      <div className="db-shell" data-theme={theme}>
        <Sidebar />
        <div className="db-main">
          <Topbar theme={theme} toggleTheme={toggleTheme} />
          <main className="db-page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/ai" element={<AIPage />} />
              <Route path="/discovery" element={<DiscoveryPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/enrichment" element={<EnrichmentPage />} />
              <Route path="/extension" element={<ExtensionPage />} />
              <Route path="/army" element={<ArmyPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}

export default App;
