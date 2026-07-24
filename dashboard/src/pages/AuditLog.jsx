import { useState, useEffect } from 'react';
import { fetchAuditLog, fetchAgents } from '../api';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [filters, setFilters] = useState({
    agent_id: '',
    decision: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset: page * LIMIT };
      if (filters.agent_id) params.agent_id = filters.agent_id;
      if (filters.decision) params.decision = filters.decision;
      if (filters.from) params.from = new Date(filters.from).toISOString();
      if (filters.to) params.to = new Date(filters.to).toISOString();

      const [data, agentsData] = await Promise.all([
        fetchAuditLog(params),
        fetchAgents(),
      ]);
      setLogs(data);
      setAgents(agentsData);
    } catch (e) {
      console.error('Audit log error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page]);

  const handleFilter = () => { setPage(0); load(); };
  const clearFilters = () => {
    setFilters({ agent_id: '', decision: '', from: '', to: '' });
    setPage(0);
    setTimeout(load, 50);
  };

  const agentName = (id) => {
    const agent = agents.find(a => a.id === id);
    return agent ? agent.name : id?.slice(0, 8) || '—';
  };

  const exportCsv = () => {
    const headers = ['ID', 'Agent', 'Action', 'Resource', 'Amount', 'Decision', 'Reason', 'Policy Version', 'Latency (ms)', 'Time'];
    const rows = logs.map(l => [
      l.id,
      agentName(l.agent_id),
      l.action,
      l.resource || '',
      l.amount || '',
      l.decision,
      l.reason || '',
      l.policy_version || '',
      l.latency_ms || '',
      new Date(l.created_at).toISOString(),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Audit Log</h2>
          <p>Full reconstruction of every governance decision</p>
        </div>
        <button className="btn btn-ghost" onClick={exportCsv}>
          📥 Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="form-group">
          <label className="form-label">Agent</label>
          <select
            className="form-select"
            value={filters.agent_id}
            onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}
          >
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Decision</label>
          <select
            className="form-select"
            value={filters.decision}
            onChange={(e) => setFilters({ ...filters, decision: e.target.value })}
          >
            <option value="">All</option>
            <option value="ALLOW">ALLOW</option>
            <option value="DENY">DENY</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">From</label>
          <input
            className="form-input"
            type="datetime-local"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input
            className="form-input"
            type="datetime-local"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ justifyContent: 'flex-end' }}>
          <div className="flex gap-sm">
            <button className="btn btn-primary btn-sm" onClick={handleFilter}>Apply</button>
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="empty-state"><div className="spinner" style={{ margin: '40px auto' }}></div></div>
      ) : logs.length === 0 ? (
        <div className="glass-card empty-state">
          <div className="empty-icon">📜</div>
          <p>No audit log entries found.</p>
        </div>
      ) : (
        <>
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Agent</th>
                  <th>Action</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Policy v.</th>
                  <th>Latency</th>
                  <th>Time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <>
                    <tr key={log.id} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span className={`badge ${log.decision === 'ALLOW' ? 'badge-allow' : 'badge-deny'}`}>
                          {log.decision === 'ALLOW' ? '✓' : '✗'} {log.decision}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{agentName(log.agent_id)}</td>
                      <td className="font-mono">{log.action}</td>
                      <td className="mono">{log.amount ? `$${Number(log.amount).toLocaleString()}` : '—'}</td>
                      <td className="text-secondary truncate">{log.reason || '—'}</td>
                      <td className="mono">{log.policy_version ?? '—'}</td>
                      <td className="mono">{log.latency_ms?.toFixed(1)}ms</td>
                      <td className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {expandedId === log.id ? '▲' : '▼'}
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={9} style={{ background: 'rgba(0,0,0,0.2)', padding: 'var(--space-md) var(--space-lg)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)', fontSize: '0.82rem' }}>
                            <div>
                              <span className="text-muted">Full Agent ID:</span><br />
                              <span className="font-mono">{log.agent_id || '—'}</span>
                            </div>
                            <div>
                              <span className="text-muted">Resource:</span><br />
                              <span className="font-mono">{log.resource || '—'}</span>
                            </div>
                            <div>
                              <span className="text-muted">Log Entry ID:</span><br />
                              <span className="font-mono">#{log.id}</span>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                              <span className="text-muted">Full Reason:</span><br />
                              {log.reason || '—'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-lg">
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              Showing {page * LIMIT + 1}–{page * LIMIT + logs.length}
            </span>
            <div className="flex gap-sm">
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                ← Previous
              </button>
              <button className="btn btn-ghost btn-sm" disabled={logs.length < LIMIT} onClick={() => setPage(p => p + 1)}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
