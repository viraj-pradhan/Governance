import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function ReasonCodes() {
  const [explanations, setExplanations] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/explanations`)
      .then(r => r.json())
      .then(data => {
        setExplanations(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch explanations:', err);
        setLoading(false);
      });
  }, []);

  const categories = {
    'Emergency Stop': ['ESTOP_ACTIVE', 'AGENT_ESTOP_ACTIVE'],
    'Authentication': ['AUTH_FAIL', 'AGENT_REVOKED'],
    'Policy & Budget': ['PERMISSION_DENIED', 'POLICY_VIOLATION', 'POLICY_ENGINE_UNAVAILABLE', 'NEEDS_MANAGER_APPROVAL', 'BUDGET_EXCEEDED', 'BUDGET_CHECK_UNAVAILABLE'],
    'Risk & Compliance': ['SANCTIONS_MATCH', 'RISK_SCORE_HIGH', 'GRAPH_PROXIMITY_1HOP', 'VELOCITY_SPIKE', 'BEHAVIORAL_ANOMALY'],
    'Human Review': ['NEEDS_HUMAN_REVIEW', 'CONFIRMED_FRAUD', 'HUMAN_APPROVED', 'MULE_SET_UPDATED'],
    'Execution': ['ALL_CHECKS_PASS', 'EXECUTION_FAILED', 'LEDGER_UPDATED'],
    'System': ['IDEMPOTENT_REPLAY', 'DRY_RUN_COMPLETE'],
  };

  const getCodeColor = (code) => {
    if (['ALL_CHECKS_PASS', 'HUMAN_APPROVED', 'LEDGER_UPDATED'].includes(code)) return 'var(--accent-emerald)';
    if (['ESTOP_ACTIVE', 'SANCTIONS_MATCH', 'RISK_SCORE_HIGH', 'CONFIRMED_FRAUD', 'BUDGET_EXCEEDED', 'EXECUTION_FAILED', 'AGENT_ESTOP_ACTIVE', 'AUTH_FAIL', 'AGENT_REVOKED', 'PERMISSION_DENIED', 'POLICY_VIOLATION', 'POLICY_ENGINE_UNAVAILABLE', 'BUDGET_CHECK_UNAVAILABLE'].includes(code)) return 'var(--accent-crimson)';
    if (['NEEDS_HUMAN_REVIEW', 'NEEDS_MANAGER_APPROVAL', 'VELOCITY_SPIKE', 'BEHAVIORAL_ANOMALY', 'GRAPH_PROXIMITY_1HOP'].includes(code)) return 'var(--accent-amber)';
    return 'var(--accent-blue)';
  };

  const getCategoryIcon = (cat) => {
    return '';
  };

  const filteredCategories = Object.entries(categories).map(([cat, codes]) => {
    const filtered = codes.filter(code => {
      if (!search) return true;
      const q = search.toLowerCase();
      return code.toLowerCase().includes(q) || (explanations[code] || '').toLowerCase().includes(q);
    });
    return [cat, filtered];
  }).filter(([, codes]) => codes.length > 0);

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Reason Code Reference</h2>
          <p>Complete mapping of all governance reason codes to human-readable explanations</p>
        </div>
      </div>

      <div className="filter-bar">
        <div className="form-group" style={{ maxWidth: 400 }}>
          <label className="form-label">Search Codes & Descriptions</label>
          <input
            className="form-input"
            type="text"
            placeholder="Search reason codes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', alignSelf: 'flex-end', paddingBottom: 8 }}>
          {Object.keys(explanations).length} reason codes registered
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        {filteredCategories.map(([category, codes]) => (
          <div key={category}>
            <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{getCategoryIcon(category)}</span>
              {category}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {codes.map(code => (
                <div
                  key={code}
                  className="glass-card"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-lg)',
                    padding: 'var(--space-md) var(--space-lg)',
                  }}
                >
                  <code style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: getCodeColor(code),
                    background: 'rgba(0,0,0,0.1)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    whiteSpace: 'nowrap',
                    minWidth: 220,
                    flexShrink: 0,
                  }}>
                    {code}
                  </code>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    {explanations[code] || 'No explanation available'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
