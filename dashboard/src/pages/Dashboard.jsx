import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchAgents, fetchLatencyMetrics, fetchFleetStatus, fetchSimulationStatus,
  startTrafficSimulation, stopTrafficSimulation, fetchRecentDecisions,
  connectLiveFeed, haltFleet, resumeFleet, simulateAction,
} from '../api';

export default function Dashboard() {
  const [agents, setAgents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [simRunning, setSimRunning] = useState(false);
  const [simProcessing, setSimProcessing] = useState(false);

  // Expand / detail state
  const [expandedTraceId, setExpandedTraceId] = useState(null);
  const [detailPanel, setDetailPanel] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);

  // Live SSE
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef(null);

  // Filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterVerdict, setFilterVerdict] = useState('');
  const [searchText, setSearchText] = useState('');

  // Global E-Stop confirmation
  const [estopConfirm, setEstopConfirm] = useState(null);
  const [estopProcessing, setEstopProcessing] = useState(false);

  // Dry-run simulation
  const [dryRun, setDryRun] = useState({ agent_id: '', action: '', amount: '' });
  const [dryRunResult, setDryRunResult] = useState(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, m, f, s, d] = await Promise.all([
        fetchAgents(),
        fetchLatencyMetrics().catch(() => null),
        fetchFleetStatus().catch(() => null),
        fetchSimulationStatus().catch(() => null),
        fetchRecentDecisions({
          limit: 20,
          ...(filterAgent ? { agent_id: filterAgent } : {}),
          ...(filterVerdict ? { verdict: filterVerdict } : {}),
          ...(searchText ? { search: searchText } : {}),
        }).catch(() => []),
      ]);
      setAgents(a);
      setMetrics(m);
      setFleet(f);
      if (s) setSimRunning(s.traffic_running);
      setDecisions(d);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, [filterAgent, filterVerdict, searchText]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  // SSE live connection
  useEffect(() => {
    const es = connectLiveFeed(
      (event) => {
        // Prepend new decisions from SSE as a lightweight grouped entry
        setDecisions((prev) => {
          const newEntry = {
            trace_id: event.trace_id,
            agent_id: event.agent_id,
            action: event.action,
            final_verdict: event.outcome,
            final_reason: event.reason_code,
            total_latency_ms: event.latency_ms,
            risk_score: event.risk_score,
            risk_factors: event.risk_factors || [],
            timestamp: new Date().toISOString(),
            stages: [],
            _live: true,
          };
          // Deduplicate by trace_id
          const filtered = prev.filter(d => d.trace_id !== event.trace_id);
          return [newEntry, ...filtered].slice(0, 50);
        });
      },
      () => setSseConnected(false),
    );
    es.onopen = () => setSseConnected(true);
    esRef.current = es;
    return () => { es.close(); esRef.current = null; };
  }, []);

  const handleToggleSimulation = async () => {
    setSimProcessing(true);
    try {
      if (simRunning) {
        await stopTrafficSimulation();
        setSimRunning(false);
      } else {
        await startTrafficSimulation();
        setSimRunning(true);
      }
      await load();
    } catch (e) {
      alert(`Simulation Error: ${e.message}`);
    } finally {
      setSimProcessing(false);
    }
  };

  const handleGlobalEstop = async () => {
    setEstopProcessing(true);
    try {
      if (fleet?.global_estop_active) {
        await resumeFleet();
      } else {
        await haltFleet();
      }
      setEstopConfirm(null);
      await load();
    } catch (e) {
      alert(`E-Stop Error: ${e.message}`);
    } finally {
      setEstopProcessing(false);
    }
  };

  const handleDryRun = async () => {
    if (!dryRun.agent_id || !dryRun.action) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const result = await simulateAction({
        agent_id: dryRun.agent_id,
        action: dryRun.action,
        amount: dryRun.amount ? Number(dryRun.amount) : undefined,
      });
      setDryRunResult(result);
    } catch (e) {
      setDryRunResult({ outcome: 'ERROR', reason_code: e.message, latency_ms: 0 });
    } finally {
      setDryRunLoading(false);
    }
  };

  const activeCount = agents.filter(a => a.status === 'active').length;
  const revokedCount = agents.filter(a => a.status === 'revoked').length;

  const latencyClass = (ms) => {
    if (ms == null) return '';
    if (ms <= 20) return 'latency-good';
    if (ms <= 50) return 'latency-warn';
    return 'latency-bad';
  };

  const verdictBadge = (verdict) => {
    if (!verdict) return 'badge-info';
    const v = verdict.toUpperCase();
    if (v === 'ALLOW') return 'badge-allow';
    if (v === 'HOLD' || v === 'ESCALATE') return 'badge-hold';
    return 'badge-deny';
  };

  const verdictIcon = (verdict) => {
    if (!verdict) return '';
    const v = verdict.toUpperCase();
    if (v === 'ALLOW') return '\u2713';
    if (v === 'HOLD' || v === 'ESCALATE') return '\u25CF';
    return '\u2717';
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      {/* Global E-Stop Banner */}
      {fleet?.global_estop_active && (
        <div className="estop-banner">
          <span className="estop-banner-icon">HALTED</span>
          <span>All agent operations are being denied fleet-wide</span>
          <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', marginLeft: 'auto' }}
            onClick={() => setEstopConfirm('resume')}>
            Clear E-Stop
          </button>
        </div>
      )}

      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Dashboard</h2>
          <p>Real-time overview of your governance gateway</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {/* Live indicator */}
          <div className={`live-indicator ${sseConnected ? 'live-connected' : ''}`}>
            <span className="live-dot"></span>
            {sseConnected ? 'LIVE' : 'OFFLINE'}
          </div>

          {/* Simulation toggle */}
          {simRunning && (
            <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}>
              <span className="status-dot"></span>
              TRAFFIC RUNNING
            </span>
          )}
          <button
            className={`btn ${simRunning ? 'btn-danger' : 'btn-primary'}`}
            style={{ padding: '10px 22px', fontSize: '0.95rem', fontWeight: 600 }}
            onClick={handleToggleSimulation}
            disabled={simProcessing}
          >
            {simProcessing && <span className="spinner" style={{ width: 14, height: 14, marginRight: 8 }}></span>}
            {simRunning ? 'Pause Simulation' : 'Start Simulation'}
          </button>

          {/* Global E-Stop Button */}
          <button
            className={`btn estop-btn ${fleet?.global_estop_active ? 'estop-active' : ''}`}
            onClick={() => setEstopConfirm(fleet?.global_estop_active ? 'resume' : 'halt')}
          >
            {fleet?.global_estop_active ? 'CLEAR E-STOP' : 'E-STOP'}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="glass-card stat-card card-blue">
          <div className="stat-label">Total Agents</div>
          <div className="stat-value text-blue">{agents.length}</div>
          <div className="stat-sub">{activeCount} active, {revokedCount} revoked</div>
        </div>

        <div className="glass-card stat-card card-emerald">
          <div className="stat-label">Allowed Requests</div>
          <div className="stat-value text-emerald">{metrics?.allow_count ?? '\u2014'}</div>
          <div className="stat-sub">Since gateway start</div>
        </div>

        <div className="glass-card stat-card card-crimson">
          <div className="stat-label">Denied Requests</div>
          <div className="stat-value text-crimson">{metrics?.deny_count ?? '\u2014'}</div>
          <div className="stat-sub">Policy violations caught</div>
        </div>

        <div className="glass-card stat-card card-amber">
          <div className="stat-label">P95 Latency</div>
          <div className="stat-value text-amber">
            {metrics?.p95_ms != null ? `${metrics.p95_ms.toFixed(1)}ms` : '\u2014'}
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
            {metrics ? `${metrics.p50_ms.toFixed(1)} / ${metrics.p99_ms.toFixed(1)}ms` : '\u2014'}
          </div>
          <div className="stat-sub">Median / 99th percentile</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="dashboard-filter-bar">
        <select className="form-select form-select-sm" value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}>
          <option value="">All Agents</option>
          {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.name || a.agent_id}</option>)}
        </select>
        <select className="form-select form-select-sm" value={filterVerdict}
          onChange={e => setFilterVerdict(e.target.value)}>
          <option value="">All Verdicts</option>
          <option value="ALLOW">ALLOW</option>
          <option value="DENY">DENY</option>
          <option value="HOLD">HOLD</option>
          <option value="BLOCKED">BLOCKED</option>
          <option value="ESCALATE">ESCALATE</option>
        </select>
        <input
          className="form-input form-input-sm"
          type="text"
          placeholder="Search agent, reason, action..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => { setFilterAgent(''); setFilterVerdict(''); setSearchText(''); }}>
          Clear
        </button>
      </div>

      {/* Recent Decisions (grouped by trace_id) */}
      <div className="glass-card" style={{ marginTop: 'var(--space-md)' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Decisions</h3>
          <span className="badge badge-info">{metrics?.total_requests ?? 0} total</span>
        </div>

        {decisions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <p>No activity yet. Click "Start Simulation" above to generate live traffic.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Decision</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Risk</th>
                <th>Reason</th>
                <th>Latency</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.trace_id} className="decision-row-group">
                  {/* Main row */}
                  <td>
                    <button className="expand-btn"
                      onClick={(e) => { e.stopPropagation(); setExpandedTraceId(expandedTraceId === d.trace_id ? null : d.trace_id); }}>
                      {expandedTraceId === d.trace_id ? '\u25B2' : '\u25BC'}
                    </button>
                  </td>
                  <td>
                    <span className={`badge ${verdictBadge(d.final_verdict)}`}>
                      {verdictIcon(d.final_verdict)} {d.final_verdict}
                    </span>
                  </td>
                  <td className="mono truncate">{d.agent_id?.slice(0, 12) ?? '\u2014'}</td>
                  <td style={{ fontWeight: 500 }}>{d.action}</td>
                  <td>
                    {d.risk_score != null ? (
                      <span className={`risk-pill ${d.risk_score > 70 ? 'risk-high' : d.risk_score >= 30 ? 'risk-med' : 'risk-low'}`}>
                        {d.risk_score}
                      </span>
                    ) : '\u2014'}
                  </td>
                  <td className="text-secondary truncate" style={{ maxWidth: 180 }}>{d.final_reason}</td>
                  <td>
                    {d.total_latency_ms != null ? (
                      <span className={`latency-gauge ${latencyClass(d.total_latency_ms)}`}>
                        <span className="gauge-dot"></span>
                        {d.total_latency_ms.toFixed(1)}ms
                      </span>
                    ) : '\u2014'}
                  </td>
                  <td className="text-muted" style={{ fontSize: '0.78rem' }}>
                    {new Date(d.timestamp || Date.now()).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Expanded trace detail (rendered after each row via CSS) */}
            {decisions.map((d) => expandedTraceId === d.trace_id && (
              <tbody key={`${d.trace_id}-detail`}>
                <tr className="stage-detail-row">
                  <td colSpan={8}>
                    <div className="stage-detail-container">
                      <div className="stage-detail-header">
                        <span style={{ fontWeight: 600 }}>Pipeline Trace: {d.trace_id?.slice(0, 18)}...</span>
                        <div className="stage-detail-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => { setDetailPanel(d); setShowRawJson(false); }}>
                            Full Detail
                          </button>
                        </div>
                      </div>

                      {/* Stage waterfall */}
                      {d.stages && d.stages.length > 0 ? (
                        <div className="stage-waterfall">
                          {d.stages.map((s, i) => {
                            const maxMs = d.total_latency_ms || 1;
                            const width = s.latency_ms != null ? Math.max(8, (s.latency_ms / maxMs) * 100) : 20;
                            const isPass = s.outcome === 'PASS' || s.outcome === 'SUCCESS' || s.outcome === 'ALLOW';
                            return (
                              <div key={i} className="stage-row">
                                <div className="stage-name">{s.stage}</div>
                                <div className="stage-bar-track">
                                  <div className={`stage-bar-fill ${isPass ? 'stage-pass' : 'stage-fail'}`}
                                    style={{ width: `${width}%` }}>
                                  </div>
                                </div>
                                <div className="stage-latency">
                                  {s.latency_ms != null ? `${s.latency_ms.toFixed(1)}ms` : '\u2014'}
                                </div>
                                <div className={`stage-outcome ${isPass ? 'text-emerald' : 'text-crimson'}`}>
                                  {isPass ? '\u2713' : '\u2717'} {s.reason_code}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-muted" style={{ fontSize: '0.82rem', padding: '8px 0' }}>
                          Stage details available after next data refresh
                        </div>
                      )}

                      {/* Risk factors */}
                      {d.risk_factors && d.risk_factors.length > 0 && (
                        <div style={{ marginTop: 'var(--space-sm)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {d.risk_factors.map((f, i) => (
                            <span key={i} className="badge badge-deny" style={{ fontSize: '0.7rem' }}>{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        )}
      </div>

      {/* Dry-Run Simulation Panel */}
      <div className="glass-card" style={{ marginTop: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
          Policy Dry-Run Simulator
        </h3>
        <div className="dry-run-form">
          <select className="form-select form-select-sm" value={dryRun.agent_id}
            onChange={e => setDryRun({ ...dryRun, agent_id: e.target.value })}>
            <option value="">Select Agent</option>
            {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.name || a.agent_id}</option>)}
          </select>
          <input className="form-input form-input-sm" placeholder="Action (e.g. transfer_funds)"
            value={dryRun.action} onChange={e => setDryRun({ ...dryRun, action: e.target.value })} />
          <input className="form-input form-input-sm" placeholder="Amount (optional)" type="number"
            value={dryRun.amount} onChange={e => setDryRun({ ...dryRun, amount: e.target.value })} />
          <button className="btn btn-primary btn-sm" onClick={handleDryRun} disabled={dryRunLoading}>
            {dryRunLoading ? 'Simulating...' : 'Simulate'}
          </button>
        </div>
        {dryRunResult && (
          <div className={`dry-run-result ${dryRunResult.outcome === 'ALLOW' ? 'dry-run-allow' : 'dry-run-deny'}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={`badge ${verdictBadge(dryRunResult.outcome)}`}>
                {verdictIcon(dryRunResult.outcome)} {dryRunResult.outcome}
              </span>
              <span className="badge badge-info">SIMULATION -- no action taken</span>
            </div>
            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
              <strong>Reason:</strong> {dryRunResult.reason_code}<br />
              {dryRunResult.explanation && <><strong>Explanation:</strong> {dryRunResult.explanation}<br /></>}
              <strong>Latency:</strong> {dryRunResult.latency_ms?.toFixed(1)}ms
              {dryRunResult.risk_score != null && <><br /><strong>Risk Score:</strong> {dryRunResult.risk_score}/100</>}
            </div>
          </div>
        )}
      </div>

      {/* Slide-over detail panel */}
      {detailPanel && (
        <div className="modal-overlay" onClick={() => setDetailPanel(null)}>
          <div className="slide-over-panel" onClick={e => e.stopPropagation()}>
            <div className="slide-over-header">
              <h3>Trace Detail</h3>
              <button className="modal-close" onClick={() => setDetailPanel(null)}>x</button>
            </div>
            <div className="slide-over-body">
              <div className="detail-grid">
                <div><span className="text-muted">Trace ID</span><br /><span className="mono">{detailPanel.trace_id}</span></div>
                <div><span className="text-muted">Agent</span><br />{detailPanel.agent_id}</div>
                <div><span className="text-muted">Action</span><br />{detailPanel.action}</div>
                <div><span className="text-muted">Verdict</span><br />
                  <span className={`badge ${verdictBadge(detailPanel.final_verdict)}`}>{detailPanel.final_verdict}</span>
                </div>
                <div><span className="text-muted">Risk Score</span><br />{detailPanel.risk_score ?? '\u2014'}/100</div>
                <div><span className="text-muted">Total Latency</span><br />{detailPanel.total_latency_ms?.toFixed(1) ?? '\u2014'}ms</div>
              </div>

              {/* Stage timeline */}
              <h4 style={{ margin: 'var(--space-lg) 0 var(--space-sm)' }}>Pipeline Stages</h4>
              {detailPanel.stages && detailPanel.stages.length > 0 ? (
                <div className="stage-waterfall">
                  {detailPanel.stages.map((s, i) => {
                    const maxMs = detailPanel.total_latency_ms || 1;
                    const width = s.latency_ms != null ? Math.max(8, (s.latency_ms / maxMs) * 100) : 20;
                    const isPass = s.outcome === 'PASS' || s.outcome === 'SUCCESS' || s.outcome === 'ALLOW';
                    return (
                      <div key={i} className="stage-row">
                        <div className="stage-name">{s.stage}</div>
                        <div className="stage-bar-track">
                          <div className={`stage-bar-fill ${isPass ? 'stage-pass' : 'stage-fail'}`}
                            style={{ width: `${width}%` }}></div>
                        </div>
                        <div className="stage-latency">{s.latency_ms != null ? `${s.latency_ms.toFixed(1)}ms` : '\u2014'}</div>
                        <div className={`stage-outcome ${isPass ? 'text-emerald' : 'text-crimson'}`}>
                          {isPass ? '\u2713' : '\u2717'} {s.reason_code}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted">Stage breakdown not available for live-streamed entries. Refresh to load full trace.</p>
              )}

              {/* Risk factors */}
              {detailPanel.risk_factors && detailPanel.risk_factors.length > 0 && (
                <div style={{ margin: 'var(--space-md) 0' }}>
                  <h4>Risk Factors</h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {detailPanel.risk_factors.map((f, i) => (
                      <span key={i} className="badge badge-deny">{f}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw JSON toggle */}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-md)' }}
                onClick={() => setShowRawJson(!showRawJson)}>
                {showRawJson ? 'Hide' : 'Show'} Raw JSON
              </button>
              {showRawJson && (
                <pre className="raw-json-block">{JSON.stringify(detailPanel, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* E-Stop Confirmation Modal */}
      {estopConfirm && (
        <div className="modal-overlay" onClick={() => setEstopConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon" style={{ color: estopConfirm === 'halt' ? 'var(--accent-crimson)' : 'var(--accent-emerald)' }}>
                {estopConfirm === 'halt' ? 'HALT' : 'OK'}
              </div>
              <h3 style={{ marginBottom: 'var(--space-md)', color: estopConfirm === 'halt' ? 'var(--accent-crimson)' : 'var(--accent-emerald)' }}>
                {estopConfirm === 'halt' ? 'Halt ALL Agents Immediately?' : 'Resume Fleet Operations?'}
              </h3>
              <p>
                {estopConfirm === 'halt'
                  ? 'This will immediately DENY ALL requests from ALL agents. No financial operations will be processed until the fleet is resumed. This action is logged.'
                  : 'This will restore normal operations for all agents. Previously revoked agents will remain revoked.'}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setEstopConfirm(null)} disabled={estopProcessing}>Cancel</button>
                <button className={`btn ${estopConfirm === 'halt' ? 'btn-danger' : 'btn-success'}`}
                  onClick={handleGlobalEstop} disabled={estopProcessing}>
                  {estopProcessing && <span className="spinner" style={{ width: 14, height: 14 }}></span>}
                  {estopConfirm === 'halt' ? 'Confirm Halt' : 'Confirm Resume'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
