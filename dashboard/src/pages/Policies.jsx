import { useState, useEffect } from 'react';
import { fetchPolicies, fetchAgents, createPolicy } from '../api';

export default function Policies() {
  const [policies, setPolicies] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({
    agent_id: '',
    rego_body: `package governance

import rego.v1

default allow := false
default reason := "action not permitted by policy"

allow if {
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}

reason := "transfer allowed" if {
    input.action == "transfer_funds"
    input.amount <= 10000
    input.context.counterparty in data.allowlists[input.agent_id]
}

allow if {
    input.action == "read_balance"
}

reason := "read_balance is always permitted" if {
    input.action == "read_balance"
}`,
    daily_spend_limit: 50000,
  });

  const load = async () => {
    try {
      const [p, a] = await Promise.all([
        fetchPolicies(selectedAgent || undefined),
        fetchAgents(),
      ]);
      setPolicies(p);
      setAgents(a);
    } catch (e) {
      console.error('Failed to load policies:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedAgent]);

  const handleCreate = async () => {
    if (!form.agent_id || !form.rego_body) return;
    try {
      await createPolicy({
        agent_id: form.agent_id,
        rego_body: form.rego_body,
        daily_spend_limit: Number(form.daily_spend_limit),
      });
      setShowCreate(false);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const agentName = (id) => {
    const agent = agents.find(a => a.id === id);
    return agent ? agent.name : id?.slice(0, 8);
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Policies</h2>
          <p>Rego policies governing agent permissions and spend limits</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Policy
        </button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="form-group">
          <label className="form-label">Filter by Agent</label>
          <select
            className="form-select"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
          >
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {policies.length === 0 ? (
        <div className="glass-card empty-state">
          <div className="empty-icon">📋</div>
          <p>No policies found. Create one to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {policies.map((policy) => (
            <div key={policy.id} className={`glass-card ${policy.active ? 'card-violet' : ''}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-md">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {agentName(policy.agent_id)}
                      <span className="badge badge-info" style={{ marginLeft: 8 }}>v{policy.version}</span>
                      {policy.active && <span className="badge badge-active" style={{ marginLeft: 6 }}>Active</span>}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                      Limit: ${Number(policy.daily_spend_limit || 0).toLocaleString()}/day
                      &nbsp;•&nbsp;Created: {new Date(policy.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpandedId(expandedId === policy.id ? null : policy.id)}
                >
                  {expandedId === policy.id ? '▲ Hide Rego' : '▼ Show Rego'}
                </button>
              </div>

              {expandedId === policy.id && (
                <div style={{
                  marginTop: 'var(--space-md)',
                  padding: 'var(--space-md)',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <pre style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    lineHeight: 1.6,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}>
                    {policy.rego_body}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Create Policy Modal ──────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ minWidth: 560 }}>
            <div className="modal-header">
              <h3>Create Policy</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="form-group">
              <label className="form-label">Agent</label>
              <select
                className="form-select"
                value={form.agent_id}
                onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
              >
                <option value="">Select agent...</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.agent_type})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Daily Spend Limit ($)</label>
              <input
                className="form-input"
                type="number"
                value={form.daily_spend_limit}
                onChange={(e) => setForm({ ...form, daily_spend_limit: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Rego Policy Body</label>
              <textarea
                className="form-textarea"
                rows={14}
                value={form.rego_body}
                onChange={(e) => setForm({ ...form, rego_body: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create Policy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
