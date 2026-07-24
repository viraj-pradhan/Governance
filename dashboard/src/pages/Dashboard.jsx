import { useState, useEffect } from 'react';
import { fetchAgents, fetchLatencyMetrics, fetchFleetStatus, fetchAuditLog } from '../api';

export default function Dashboard() {
  const [agents, setAgents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [a, m, f, l] = await Promise.all([
        fetchAgents(),
        fetchLatencyMetrics().catch(() => null),
        fetchFleetStatus().catch(() => null),
        fetchAuditLog({ limit: 10 }).catch(() => []),
      ]);
      setAgents(a);
      setMetrics(m);
      setFleet(f);
      setRecentLogs(l);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const activeCount = agents.filter(a => a.status === 'active').length;
  const revokedCount = agents.filter(a => a.status === 'revoked').length;

  const latencyClass = (ms) => {
    if (ms <= 20) return 'latency-good';
    if (ms <= 50) return 'latency-warn';
    return 'latency-bad';
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{ margin: '60px auto' }}></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Real-time overview of your governance gateway</p>
      </div>

      {/* ── Fleet status banner ──────────────────────────── */}
      {fleet && fleet.halted && (
        <div className="glass-card card-crimson" style={{ marginBottom: 'var(--space-lg)', textAlign: 'center' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-crimson)' }}>
            🚨 FLEET HALTED — All agent actions are being denied
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Halted by: {fleet.halted_by || 'unknown'} • {fleet.halted_at ? new Date(fleet.halted_at).toLocaleString() : ''}
          </div>
        </div>
      )}

      {/* ── Stat cards ───────────────────────────────────── */}
      <div className="stats-grid">
        <div className="glass-card stat-card card-blue">
          <div className="stat-label">Total Agents</div>
          <div className="stat-value text-blue">{agents.length}</div>
          <div className="stat-sub">{activeCount} active, {revokedCount} revoked</div>
        </div>

        <div className="glass-card stat-card card-emerald">
          <div className="stat-label">Allowed Requests</div>
          <div className="stat-value text-emerald">{metrics?.allow_count ?? '—'}</div>
          <div className="stat-sub">Since gateway start</div>
        </div>

        <div className="glass-card stat-card card-crimson">
          <div className="stat-label">Denied Requests</div>
          <div className="stat-value text-crimson">{metrics?.deny_count ?? '—'}</div>
          <div className="stat-sub">Policy violations caught</div>
        </div>

        <div className="glass-card stat-card card-amber">
          <div className="stat-label">P95 Latency</div>
          <div className="stat-value text-amber">
            {metrics?.p95_ms != null ? `${metrics.p95_ms.toFixed(1)}ms` : '—'}
          </div>
          <div className="stat-sub">
            {metrics && (
              <span className={`latency-gauge ${latencyClass(metrics.p95_ms)}`}>
                <span className="gauge-dot"></span>
                Target: &lt;50ms
              </span>
            )}
          </div>
        </div>

        <div className="glass-card stat-card card-violet">
          <div className="stat-label">P50 / P99 Latency</div>
          <div className="stat-value text-violet" style={{ fontSize: '1.5rem' }}>
            {metrics ? `${metrics.p50_ms.toFixed(1)} / ${metrics.p99_ms.toFixed(1)}ms` : '—'}
          </div>
          <div className="stat-sub">Median / 99th percentile</div>
        </div>
      </div>

      {/* ── Recent activity ──────────────────────────────── */}
      <div className="glass-card" style={{ marginTop: 'var(--space-md)' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Decisions</h3>
          <span className="badge badge-info">{metrics?.total_requests ?? 0} total</span>
        </div>

        {recentLogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <p>No activity yet. Start mock agents to generate traffic.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Latency</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span className={`badge ${log.decision === 'ALLOW' ? 'badge-allow' : 'badge-deny'}`}>
                      {log.decision === 'ALLOW' ? '✓' : '✗'} {log.decision}
                    </span>
                  </td>
                  <td className="mono truncate">{log.agent_id?.slice(0, 8) ?? '—'}</td>
                  <td style={{ fontWeight: 500 }}>{log.action}</td>
                  <td className="mono">{log.amount ? `$${Number(log.amount).toLocaleString()}` : '—'}</td>
                  <td className="text-secondary" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.reason}
                  </td>
                  <td>
                    <span className={`latency-gauge ${latencyClass(log.latency_ms)}`}>
                      <span className="gauge-dot"></span>
                      {log.latency_ms?.toFixed(1)}ms
                    </span>
                  </td>
                  <td className="text-muted" style={{ fontSize: '0.78rem' }}>
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
