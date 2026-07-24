import { useState, useEffect } from 'react';
import { fetchAgents, createAgent, revokeAgent, reinstateAgent } from '../api';

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [form, setForm] = useState({ name: '', agent_type: '' });

  const load = async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch (e) {
      console.error('Failed to load agents:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.agent_type) return;
    try {
      await createAgent(form);
      setForm({ name: '', agent_type: '' });
      setShowCreate(false);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await revokeAgent(id);
      setConfirmAction(null);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleReinstate = async (id) => {
    try {
      await reinstateAgent(id);
      setConfirmAction(null);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const spendPercent = (agent) => {
    if (!agent.daily_limit || agent.daily_limit == 0) return 0;
    return Math.min(100, (Number(agent.current_spend || 0) / Number(agent.daily_limit)) * 100);
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Agents</h2>
          <p>Manage autonomous financial agents</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="glass-card empty-state">
          <div className="empty-icon">🤖</div>
          <p>No agents registered yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-lg)' }}>
          {agents.map((agent) => (
            <div key={agent.id} className={`glass-card ${agent.status === 'revoked' ? 'card-crimson' : 'card-emerald'}`}>
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{agent.name}</div>
                  <div className="text-muted" style={{ fontSize: '0.78rem' }}>{agent.agent_type}</div>
                </div>
                <span className={`badge ${agent.status === 'active' ? 'badge-active' : 'badge-revoked'}`}>
                  {agent.status === 'active' ? '● Active' : '● Revoked'}
                </span>
              </div>

              <div className="font-mono text-muted" style={{ fontSize: '0.72rem', marginBottom: 'var(--space-md)' }}>
                ID: {agent.id}
              </div>

              {/* Spend progress */}
              <div className="flex justify-between" style={{ fontSize: '0.82rem' }}>
                <span className="text-secondary">Daily Spend</span>
                <span className="font-mono">
                  ${Number(agent.current_spend || 0).toLocaleString()} / ${Number(agent.daily_limit || 0).toLocaleString()}
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className={`progress-fill ${spendPercent(agent) > 80 ? 'danger' : ''}`}
                  style={{ width: `${spendPercent(agent)}%` }}
                ></div>
              </div>

              <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
                {agent.status === 'active' ? (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirmAction({ type: 'revoke', agent })}
                  >
                    Revoke Agent
                  </button>
                ) : (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => setConfirmAction({ type: 'reinstate', agent })}
                  >
                    Reinstate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Modal ─────────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Register New Agent</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="form-group">
              <label className="form-label">Agent Name</label>
              <input
                className="form-input"
                placeholder="e.g. Agent Delta"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Agent Type</label>
              <input
                className="form-input"
                placeholder="e.g. retail-transfer-bot"
                value={form.agent_type}
                onChange={(e) => setForm({ ...form, agent_type: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create Agent</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Modal ────────────────────────────────── */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon">
                {confirmAction.type === 'revoke' ? '⚠️' : '✅'}
              </div>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>
                {confirmAction.type === 'revoke' ? 'Revoke Agent?' : 'Reinstate Agent?'}
              </h3>
              <p>
                {confirmAction.type === 'revoke'
                  ? `This will immediately deny all requests from "${confirmAction.agent.name}". The agent can be reinstated later.`
                  : `This will restore "${confirmAction.agent.name}" to active status and allow requests to be processed again.`
                }
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button
                  className={`btn ${confirmAction.type === 'revoke' ? 'btn-danger' : 'btn-success'}`}
                  onClick={() =>
                    confirmAction.type === 'revoke'
                      ? handleRevoke(confirmAction.agent.id)
                      : handleReinstate(confirmAction.agent.id)
                  }
                >
                  {confirmAction.type === 'revoke' ? 'Revoke' : 'Reinstate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
