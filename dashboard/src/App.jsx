import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Policies from './pages/Policies';
import LiveActivity from './pages/LiveActivity';
import AuditLog from './pages/AuditLog';
import EmergencyStop from './pages/EmergencyStop';
import ReviewQueue from './pages/ReviewQueue';
import './App.css';

function App() {
  return (
    <BrowserRouter>
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
                Gateway v1.0
              </div>
              Financial Agent Governance
            </div>
          </div>
        </aside>

        {/* ── Main Content ─────────────────────────────────── */}
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/live" element={<LiveActivity />} />
            <Route path="/review" element={<ReviewQueue />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/emergency" element={<EmergencyStop />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;

