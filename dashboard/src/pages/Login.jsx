import React, { useState } from 'react';

export default function Login({ onLogin, theme, onToggleTheme }) {
  const [email, setEmail] = useState('admin@governance.ai');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    setError('');

    // Simulate authenticating against gateway/DB
    setTimeout(() => {
      setLoading(false);
      onLogin({
        email,
        name: 'Viraj Pradhan',
        role: 'Administrator',
      });
    }, 400);
  };

  const handleQuickLogin = () => {
    onLogin({
      email: 'admin@governance.ai',
      name: 'Viraj Pradhan',
      role: 'Administrator',
    });
  };

  return (
    <div className="login-wrapper">
      <div className="login-bg-glow"></div>

      {/* Top right theme toggle on login screen */}
      <div style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 20 }}>
        <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle Theme">
          <span className="theme-toggle-icon">{theme === 'light' ? '🌙' : '☀️'}</span>
          <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
        </button>
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="login-brand-icon">G</div>
          <h1 className="login-title">Governance Gateway</h1>
          <p className="login-subtitle">Sign in to control autonomous agent permissions</p>
        </div>

        {error && (
          <div className="badge badge-deny" style={{ width: '100%', padding: '10px 14px', marginBottom: '16px', borderRadius: '10px', display: 'flex', justifyContent: 'center' }}>
            ⚠️ {error}
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Work Email</label>
            <input
              id="email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@company.com"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div style={{ margin: '16px 0 8px 0', textTransform: 'uppercase', fontSize: '0.7rem', textAlign: 'center', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          or
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleQuickLogin}
          style={{ width: '100%', fontSize: '0.9rem' }}
        >
          ⚡ Quick Demo Login
        </button>

        <div className="login-footer-hint">
          Connected to MongoDB Atlas • Financial Agent Fleet Controls
        </div>
      </div>
    </div>
  );
}
