import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function MuleGraph() {
  const canvasRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], mule_count: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [confirmingFraud, setConfirmingFraud] = useState(false);
  const [fraudResult, setFraudResult] = useState(null);
  const [subgraphMode, setSubgraphMode] = useState(false);
  const [searchNodeId, setSearchNodeId] = useState('');
  const [hops, setHops] = useState(2);
  const nodesRef = useRef([]);
  const animRef = useRef(null);
  const isDragging = useRef(false);
  const dragNode = useRef(null);

  const fetchFullGraph = async () => {
    try {
      const data = await apiFetch('/graph');
      setGraphData(data);
      nodesRef.current = []; // reset positions on full refresh
    } catch (err) {
      console.error('Failed to fetch graph:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubgraph = async (nodeId) => {
    try {
      const data = await apiFetch(`/graph/subgraph/${encodeURIComponent(nodeId)}?hops=${hops}`);
      setGraphData({ ...data, mule_count: data.nodes.filter(n => n.is_mule).length });
      nodesRef.current = [];
      setSubgraphMode(true);
    } catch (err) {
      console.error('Subgraph fetch failed:', err);
    }
  };

  useEffect(() => {
    fetchFullGraph();
    const interval = setInterval(fetchFullGraph, 8000);
    return () => clearInterval(interval);
  }, []);

  // Risk score → color (green 0 → red 100)
  const riskColor = (score, isMule, isOneHop) => {
    if (isMule) return '#ff3b30';
    if (isOneHop) return '#ff9500';
    const s = Math.min(100, Math.max(0, score || 0));
    const r = Math.round(52 + (s / 100) * (255 - 52));
    const g = Math.round(199 - (s / 100) * (199 - 59));
    return `rgb(${r},${g},60)`;
  };

  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.parentElement?.clientWidth || 800;
    const H = canvas.height = Math.max(520, (canvas.parentElement?.clientHeight || 600) - 60);

    const { nodes, edges } = graphData;

    if (nodes.length === 0) {
      ctx.clearRect(0, 0, W, H);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)';
      ctx.font = '15px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No nodes in the mule network yet.', W / 2, H / 2 - 12);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText('Send transactions through the gateway, then use Review Queue to confirm fraud.', W / 2, H / 2 + 14);
      return;
    }

    // Init positions if needed
    if (nodesRef.current.length !== nodes.length) {
      nodesRef.current = nodes.map((n) => ({
        ...n,
        x: W / 2 + (Math.random() - 0.5) * Math.min(W * 0.6, 400),
        y: H / 2 + (Math.random() - 0.5) * Math.min(H * 0.6, 300),
        vx: 0,
        vy: 0,
      }));
    } else {
      // Sync properties (risk bumps may have changed)
      nodes.forEach((n, i) => {
        if (nodesRef.current[i]) {
          Object.assign(nodesRef.current[i], n);
        }
      });
    }

    const simNodes = nodesRef.current;
    const nodeMap = {};
    simNodes.forEach(n => { nodeMap[n.id] = n; });

    // Physics
    for (let iter = 0; iter < 4; iter++) {
      // Repulsion
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 4500 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx -= fx; simNodes[i].vy -= fy;
          simNodes[j].vx += fx; simNodes[j].vy += fy;
        }
      }
      // Springs (edges)
      edges.forEach(e => {
        const s = nodeMap[e.source];
        const t = nodeMap[e.target];
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const ideal = 130 + (e.weight || 1) * 10;
        const force = (dist - ideal) * 0.025;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      });
      // Center gravity + dampen
      simNodes.forEach(n => {
        if (n === dragNode.current) return;
        n.vx += (W / 2 - n.x) * 0.0015;
        n.vy += (H / 2 - n.y) * 0.0015;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      });
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.clearRect(0, 0, W, H);

    // Draw edges
    edges.forEach(e => {
      const s = nodeMap[e.source];
      const t = nodeMap[e.target];
      if (!s || !t) return;
      const w = Math.min(4, 1 + (e.weight || 1) * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.1)';
      ctx.lineWidth = w;
      ctx.stroke();
    });

    // Draw nodes
    simNodes.forEach(n => {
      const isMule = n.is_mule;
      const isOneHop = n.is_one_hop;
      const isSelected = selectedNode?.id === n.id;
      const isCenter = n.is_center;
      const radius = isMule ? 20 : isCenter ? 18 : isOneHop ? 14 : 10;
      const color = riskColor(n.risk_score, isMule, isOneHop);

      // Glow
      if (isMule || isOneHop || isSelected) {
        const glowR = radius + (isSelected ? 10 : 7);
        const glowColor = isMule ? 'rgba(255,59,48,0.25)' : isSelected ? 'rgba(0,113,227,0.25)' : 'rgba(255,149,0,0.18)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
      }

      // Node body
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Border
      ctx.lineWidth = isSelected ? 3 : isMule ? 2.5 : 1.5;
      ctx.strokeStyle = isSelected ? '#0071e3' : isMule ? '#ff453a' : (isDark ? '#555' : '#ccc');
      ctx.stroke();

      // Mule X marker
      if (isMule) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        const s = radius * 0.45;
        ctx.beginPath();
        ctx.moveTo(n.x - s, n.y - s); ctx.lineTo(n.x + s, n.y + s);
        ctx.moveTo(n.x + s, n.y - s); ctx.lineTo(n.x - s, n.y + s);
        ctx.stroke();
      }

      // Label
      const label = n.id.length > 14 ? n.id.slice(0, 12) + '…' : n.id;
      ctx.fillStyle = isDark ? '#e5e5e7' : '#1d1d1f';
      ctx.font = `${isMule ? '600' : '400'} 10px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, n.y + radius + 14);

      // Risk bump badge
      if (n.risk_bump > 0) {
        ctx.fillStyle = '#ff9500';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillText(`+${n.risk_bump}`, n.x + radius, n.y - radius + 2);
      }
    });

    animRef.current = requestAnimationFrame(simulate);
  }, [graphData, selectedNode]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(simulate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [simulate]);

  // Click to select node
  const handleCanvasClick = (e) => {
    if (isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    for (const n of nodesRef.current) {
      const dx = mx - n.x;
      const dy = my - n.y;
      const radius = n.is_mule ? 20 : n.is_center ? 18 : n.is_one_hop ? 14 : 10;
      if (dx * dx + dy * dy < (radius + 8) ** 2) {
        setSelectedNode(n);
        setFraudResult(null);
        return;
      }
    }
    setSelectedNode(null);
    setFraudResult(null);
  };

  // Drag support
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    for (const n of nodesRef.current) {
      const dx = mx - n.x; const dy = my - n.y;
      if (dx * dx + dy * dy < 400) { dragNode.current = n; break; }
    }
  };
  const handleMouseMove = (e) => {
    if (!dragNode.current) return;
    isDragging.current = true;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    dragNode.current.x = (e.clientX - rect.left) * scaleX;
    dragNode.current.y = (e.clientY - rect.top) * scaleY;
    dragNode.current.vx = 0; dragNode.current.vy = 0;
  };
  const handleMouseUp = () => {
    setTimeout(() => { isDragging.current = false; }, 50);
    dragNode.current = null;
  };

  const handleConfirmFraud = async () => {
    if (!selectedNode) return;
    setConfirmingFraud(true);
    try {
      const result = await apiFetch(`/graph/confirm-fraud/${encodeURIComponent(selectedNode.id)}`, { method: 'POST' });
      setFraudResult(result);
      // Immediately refresh graph to show color changes
      await fetchFullGraph();
      // Update selected node
      const updated = nodesRef.current.find(n => n.id === selectedNode.id);
      if (updated) setSelectedNode({ ...updated, is_mule: true });
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setConfirmingFraud(false);
    }
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  const muleNodes = graphData.nodes?.filter(n => n.is_mule) || [];

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Mule Network Graph</h2>
          <p>Force-directed network of flagged accounts and connected entities</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {subgraphMode && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSubgraphMode(false); fetchFullGraph(); }}>
              View Full Graph
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={fetchFullGraph}>Refresh</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {graphData.node_count || 0} nodes · {graphData.edge_count || 0} edges · {graphData.mule_count || 0} mules
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <div className="glass-card" style={{ padding: 'var(--space-sm) var(--space-lg)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff3b30', display: 'inline-block' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--accent-crimson)' }}>{muleNodes.length}</span>
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>Confirmed Mules</span>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-sm) var(--space-lg)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff9500', display: 'inline-block' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>
            {(graphData.nodes || []).filter(n => n.is_one_hop).length}
          </span>
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>1-Hop At-Risk</span>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-sm) var(--space-lg)', display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
          <input
            className="form-input form-input-sm"
            style={{ flex: 1 }}
            placeholder="Search node ID to center subgraph..."
            value={searchNodeId}
            onChange={e => setSearchNodeId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchNodeId && fetchSubgraph(searchNodeId)}
          />
          <select className="form-select form-select-sm" value={hops} onChange={e => setHops(Number(e.target.value))} style={{ width: 80 }}>
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => searchNodeId && fetchSubgraph(searchNodeId)}>
            Center
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-md)',
        background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)', fontSize: '0.8rem', flexWrap: 'wrap',
      }}>
        {[
          { color: '#ff3b30', label: 'Confirmed Mule (X marker)' },
          { color: '#ff9500', label: '1-Hop Neighbor (elevated risk)' },
          { color: '#34c759', label: 'Low Risk (score 0–30)' },
          { color: '#ff9500', label: 'Medium Risk (score 30–70)' },
          { color: '#ff3b30', label: 'High Risk (score 70–100)' },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}></span>
            {label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>Drag nodes to reposition · Click to select</span>
      </div>

      {/* Canvas + side panel */}
      <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
        <div className="glass-card" style={{ flex: 1, padding: 0, overflow: 'hidden', position: 'relative' }}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ width: '100%', minHeight: 520, cursor: 'crosshair', display: 'block' }}
          />
        </div>

        {/* Selected node panel */}
        {selectedNode && (
          <div style={{ width: 280, flexShrink: 0 }}>
            <div className="glass-card">
              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 'var(--space-sm)', wordBreak: 'break-all' }}>
                {selectedNode.id}
              </div>

              <div style={{ fontSize: '0.82rem', lineHeight: 2, color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Status:</span>
                  <span className={`badge ${selectedNode.is_mule ? 'badge-deny' : 'badge-active'}`}>
                    {selectedNode.is_mule ? 'Confirmed Mule' : 'Not Flagged'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Risk Bump:</span>
                  <span style={{ color: selectedNode.risk_bump > 0 ? 'var(--accent-amber)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {selectedNode.risk_bump > 0 ? `+${selectedNode.risk_bump}` : 'None'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Risk Score:</span>
                  <span className={`risk-pill ${(selectedNode.risk_score || 0) > 70 ? 'risk-high' : (selectedNode.risk_score || 0) >= 30 ? 'risk-med' : 'risk-low'}`}>
                    {selectedNode.risk_score || 0}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Connections:</span>
                  <span>{selectedNode.neighbors_count}</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', margin: 'var(--space-md) 0 var(--space-sm)' }}></div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%' }}
                  onClick={() => { setSearchNodeId(selectedNode.id); fetchSubgraph(selectedNode.id); }}
                >
                  View {hops}-Hop Subgraph
                </button>

                {!selectedNode.is_mule && (
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ width: '100%', fontWeight: 700 }}
                    onClick={handleConfirmFraud}
                    disabled={confirmingFraud}
                  >
                    {confirmingFraud
                      ? <><span className="spinner" style={{ width: 12, height: 12 }}></span> Processing...</>
                      : 'Confirm Fraud'}
                  </button>
                )}

                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%' }}
                  onClick={() => { setSelectedNode(null); setFraudResult(null); }}
                >
                  Deselect
                </button>
              </div>

              {/* Fraud result */}
              {fraudResult && (
                <div className="dry-run-result dry-run-deny" style={{ marginTop: 'var(--space-md)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--accent-crimson)' }}>
                    Fraud Confirmed
                  </div>
                  <div style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
                    <strong>{fraudResult.neighbors_affected?.length || 0} neighbors</strong> risk-bumped by +15.
                    <br />Watch their colors update on the graph.
                  </div>
                  {fraudResult.neighbors_affected?.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {fraudResult.neighbors_affected.slice(0, 5).map(n => (
                        <span key={n.id} className="badge badge-hold" style={{ fontSize: '0.68rem' }}>
                          {n.id.slice(0, 10)} +{n.new_risk_bump}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mule list */}
            {muleNodes.length > 0 && (
              <div className="glass-card" style={{ marginTop: 'var(--space-md)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 'var(--space-sm)', color: 'var(--accent-crimson)' }}>
                  Confirmed Mules ({muleNodes.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {muleNodes.map(n => (
                    <button
                      key={n.id}
                      className="btn btn-ghost btn-sm"
                      style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: '0.75rem' }}
                      onClick={() => { setSearchNodeId(n.id); fetchSubgraph(n.id); }}
                    >
                      {n.id.length > 22 ? n.id.slice(0, 20) + '…' : n.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
