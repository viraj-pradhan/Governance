import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Policies from './pages/Policies';
import LiveActivity from './pages/LiveActivity';
import AuditLog from './pages/AuditLog';
import EmergencyStop from './pages/EmergencyStop';
import ReviewQueue from './pages/ReviewQueue';
import Login from './pages/Login';
import './App.css';

function Header({ user, onLogout, theme, onToggleTheme }) {
  const location = useLocation();

  const getPageTitle = (pathname) => {
    switch (pathname) {
      case '/': return 'Overview Dashboard';
      case '/live': return 'Live Stream Activity';
      case '/agents': return 'Registered Financial Agents';
      case '/policies': return 'Governance & Rego Policies';
      case '/review': return 'Human-in-the-Loop Review Queue';
      case '/audit': return 'Unified Audit Log';
      case '/emergency': return 'Global Emergency Stop';
      default: return 'Governance Gateway';
    }
  };

  return (
    <header className="top-header">
      <div className="header-title-group">
        <h2>{getPageTitle(location.pathname)}</h2>
        <div className="header-subtitle">Autonomous AI Financial Agent Fleet Control</div>
      </div>

      <div className="header-actions">
        {/* Light / Dark Theme Toggle Switch */}
        <button
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          <span className="theme-toggle-icon">{theme === 'light' ? '🌙' : '☀️'}</span>
          <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
        </button>

        {/* Logged in User Profile */}
        <div className="user-profile-pill">
          <div className="user-avatar">{user?.name ? user.name.charAt(0) : 'A'}</div>
          <span>{user?.name || 'Administrator'}</span>
          <button onClick={onLogout} className="logout-btn" title="Sign Out">
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

function MainLayout({ user, onLogout, theme, onToggleTheme }) {
  return (
    <div className="app-layout">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">G</div>
          <div>
            <h1>Governance</h1>
            <div className="brand-subtitle">Agent Gateway</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-section-label">Overview</span>
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📊</span> Dashboard
          </NavLink>
          <NavLink to="/live" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">⚡</span> Live Activity
          </NavLink>

          <span className="nav-section-label">Management</span>
          <NavLink to="/agents" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🤖</span> Agents
          </NavLink>
          <NavLink to="/policies" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📋</span> Policies
          </NavLink>

          <span className="nav-section-label">Operations</span>
          <NavLink to="/review" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">⚖️</span> Review Queue
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📜</span> Audit Log
          </NavLink>
          <NavLink to="/emergency" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🚨</span> Emergency Stop
          </NavLink>
        </nav>

        <div style={{ padding: '0 var(--space-lg)', marginTop: 'auto' }}>
          <div style={{
            padding: 'var(--space-md)',
            background: 'var(--bg-glass)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Gateway v1.0 • MongoDB
            </div>
            Financial Agent Governance
          </div>
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────── */}
      <main className="main-content">
        <Header user={user} onLogout={onLogout} theme={theme} onToggleTheme={onToggleTheme} />

        <div className="page-body">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/live" element={<LiveActivity />} />
            <Route path="/review" element={<ReviewQueue />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/emergency" element={<EmergencyStop />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  // Theme state: default 'light' as requested
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('gov_theme') || 'light';
  });

  // User auth state
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('gov_user');
    return saved ? JSON.parse(saved) : { name: 'Viraj Pradhan', email: 'admin@governance.ai' };
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gov_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('gov_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('gov_user');
  };

  return (
    <BrowserRouter>
      {!user ? (
        <Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />
      ) : (
        <MainLayout user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />
      )}
    </BrowserRouter>
  );
}

export default App;
