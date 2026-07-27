import { useState, useEffect } from 'react';
import { fetchAgents, fetchFleetStatus, createAgent, revokeAgent, reinstateAgent, pauseAgent, resumeAgent, updateAgentBudget } from '../api';

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [agentEstops, setAgentEstops] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [form, setForm] = useState({ agent_id: '', name: '', agent_type: '', version: '1.0.0' });
  const [editBudget, setEditBudget] = useState({}); // { agent_id: value }
  const [budgetEditing, setBudgetEditing] = useState(null);

  const load = async () => {
    try {
      const [data, fleetData] = await Promise.all([
        fetchAgents(),
        fetchFleetStatus().catch(() => ({ agent_estops: {} })),
      ]);
      setAgents(data);
      setAgentEstops(fleetData?.agent_estops || {});
    } catch (e) {
      console.error('Failed to load agents:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.agent_type) return;
    try {
      await createAgent(form);
      setForm({ agent_id: '', name: '', agent_type: '', version: '1.0.0' });
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
    } catch (e) { alert(`Error: ${e.message}`); }
  };

  const handleReinstate = async (id) => {
    try {
      await reinstateAgent(id);
      setConfirmAction(null);
      await load();
    } catch (e) { alert(`Error: ${e.message}`); }
  };

  const handlePause = async (agentId) => {
    try {
      await pauseAgent(agentId);
      await load();
    } catch (e) { alert(`Error: ${e.message}`); }
  };

  const handleResume = async (agentId) => {
    try {
      await resumeAgent(agentId);
      await load();
    } catch (e) { alert(`Error: ${e.message}`); }
  };

  const handleBudgetSave = async (agentId) => {
    const val = parseFloat(editBudget[agentId]);
    if (isNaN(val) || val < 0) return;
    try {
      await updateAgentBudget(agentId, val);
      setBudgetEditing(null);
      await load();
    } catch (e) { alert(`Error: ${e.message}`); }
  };

  const spendPercent = (agent) => {
    if (!agent.daily_limit || agent.daily_limit == 0) return 0;
    return Math.min(100, (Number(agent.current_spend || 0) / Number(agent.daily_limit)) * 100);
  };

  const getAgentStatus = (agent) => {
    if (agent.status === 'revoked') return 'revoked';
    if (agentEstops[agent.agent_id]) return 'paused';
    return 'active';
  };

  const statusBadge = (status) => {
    if (status === 'active') return 'badge-active';
    if (status === 'paused') return 'badge-hold';
    return 'badge-revoked';
  };

  const statusLabel = (status) => {
    if (status === 'active') return '● Active';
    if (status === 'paused') return '⏸ Paused';
    return '● Revoked';
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Agents</h2>
          <p>Manage autonomous financial agents and their individual controls</p>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-lg)' }}>
          {agents.map((agent) => {
            const status = getAgentStatus(agent);
            const isPaused = status === 'paused';
            const isRevoked = status === 'revoked';

            return (
              <div key={agent.agent_id}
                className={`glass-card ${isRevoked ? 'card-crimson' : isPaused ? 'card-amber' : 'card-emerald'}`}>

                {/* Header */}
                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{agent.name}</div>
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{agent.agent_type}</div>
                  </div>
                  <span className={`badge ${statusBadge(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>

                {/* Agent ID */}
                <div className="font-mono text-muted" style={{ fontSize: '0.72rem', marginBottom: 'var(--space-md)' }}>
                  ID: {agent.agent_id}
                </div>

                {/* Budget / Spend */}
                <div className="flex justify-between" style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                  <span className="text-secondary">Daily Spend</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {budgetEditing === agent.agent_id ? (
                      <>
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: 90, padding: '2px 6px', fontSize: '0.8rem' }}
                          value={editBudget[agent.agent_id] ?? Number(agent.daily_limit || 50000)}
                          onChange={e => setEditBudget({ ...editBudget, [agent.agent_id]: e.target.value })}
                        />
                        <button className="btn btn-success btn-sm" style={{ padding: '2px 8px' }}
                          onClick={() => handleBudgetSave(agent.agent_id)}>Save</button>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }}
                          onClick={() => setBudgetEditing(null)}>x</button>
                      </>
                    ) : (
                      <>
                        <span className="font-mono">
                          ${Number(agent.current_spend || 0).toLocaleString()} / ${Number(agent.daily_limit || 0).toLocaleString()}
                        </span>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '1px 6px', fontSize: '0.7rem' }}
                          onClick={() => {
                            setBudgetEditing(agent.agent_id);
                            setEditBudget({ ...editBudget, [agent.agent_id]: Number(agent.daily_limit || 50000) });
                          }}
                          title="Edit daily limit"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="progress-bar" style={{ marginBottom: 'var(--space-md)' }}>
                  <div
                    className={`progress-fill ${spendPercent(agent) > 80 ? 'danger' : ''}`}
                    style={{ width: `${spendPercent(agent)}%` }}
                  ></div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  {!isRevoked && (
                    <>
                      {isPaused ? (
                        <button className="btn btn-success btn-sm" onClick={() => handleResume(agent.agent_id)}>
                          Resume
                        </button>
                      ) : (
                        <button className="btn btn-warning btn-sm" onClick={() => handlePause(agent.agent_id)}>
                          Pause
                        </button>
                      )}
                    </>
                  )}

                  {isRevoked ? (
                    <button className="btn btn-success btn-sm"
                      onClick={() => setConfirmAction({ type: 'reinstate', agent })}>
                      Reinstate
                    </button>
                  ) : (
                    <button className="btn btn-danger btn-sm"
                      onClick={() => setConfirmAction({ type: 'revoke', agent })}>
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Register New Agent</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>x</button>
            </div>
            <div className="form-group">
              <label className="form-label">Agent ID (optional)</label>
              <input className="form-input" placeholder="e.g. gamma-agent-003 (auto-generated if blank)"
                value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input className="form-input" placeholder="e.g. Agent Gamma"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Agent Type</label>
              <input className="form-input" placeholder="e.g. retail-transfer-bot"
                value={form.agent_type} onChange={(e) => setForm({ ...form, agent_type: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Version</label>
              <input className="form-input" placeholder="1.0.0"
                value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create Agent</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon">
                {confirmAction.type === 'revoke' ? '!' : 'OK'}
              </div>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>
                {confirmAction.type === 'revoke' ? 'Revoke Agent?' : 'Reinstate Agent?'}
              </h3>
              <p>
                {confirmAction.type === 'revoke'
                  ? `This will immediately deny all requests from "${confirmAction.agent.name}". The agent can be reinstated later.`
                  : `This will restore "${confirmAction.agent.name}" to active status.`}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button
                  className={`btn ${confirmAction.type === 'revoke' ? 'btn-danger' : 'btn-success'}`}
                  onClick={() =>
                    confirmAction.type === 'revoke'
                      ? handleRevoke(confirmAction.agent.agent_id)
                      : handleReinstate(confirmAction.agent.agent_id)
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
