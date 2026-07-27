import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function MuleGraph() {
  const canvasRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const nodesRef = useRef([]);
  const animRef = useRef(null);

  const fetchGraph = async () => {
    try {
      const res = await fetch(`${API_BASE}/graph`);
      const data = await res.json();
      setGraphData(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch graph:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
    const interval = setInterval(fetchGraph, 5000);
    return () => clearInterval(interval);
  }, []);

  // Force-directed layout simulation
  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.parentElement.clientWidth;
    const H = canvas.height = Math.max(500, canvas.parentElement.clientHeight - 60);

    const { nodes, edges } = graphData;
    if (nodes.length === 0) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No nodes in the mule network graph yet.', W / 2, H / 2 - 10);
      ctx.fillText('Confirm fraud from the Review Queue to populate the graph.', W / 2, H / 2 + 15);
      return;
    }

    // Initialize positions if needed
    if (nodesRef.current.length !== nodes.length) {
      nodesRef.current = nodes.map((n, i) => ({
        ...n,
        x: W / 2 + (Math.random() - 0.5) * 300,
        y: H / 2 + (Math.random() - 0.5) * 300,
        vx: 0,
        vy: 0,
      }));
    }

    const simNodes = nodesRef.current;
    const nodeMap = {};
    simNodes.forEach(n => nodeMap[n.id] = n);

    // Run physics steps
    for (let iter = 0; iter < 5; iter++) {
      // Repulsion (Coulomb)
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 3000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx -= fx;
          simNodes[i].vy -= fy;
          simNodes[j].vx += fx;
          simNodes[j].vy += fy;
        }
      }

      // Attraction (springs)
      edges.forEach(e => {
        const s = nodeMap[e.source];
        const t = nodeMap[e.target];
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 120) * 0.03;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      });

      // Center gravity
      simNodes.forEach(n => {
        n.vx += (W / 2 - n.x) * 0.002;
        n.vy += (H / 2 - n.y) * 0.002;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      });
    }

    // Determine which nodes are 1-hop from a mule
    const muleIds = new Set(simNodes.filter(n => n.is_mule).map(n => n.id));
    const oneHopIds = new Set();
    edges.forEach(e => {
      if (muleIds.has(e.source)) oneHopIds.add(e.target);
      if (muleIds.has(e.target)) oneHopIds.add(e.source);
    });

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Dark background
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // Edges
    edges.forEach(e => {
      const s = nodeMap[e.source];
      const t = nodeMap[e.target];
      if (!s || !t) return;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Nodes
    simNodes.forEach(n => {
      const isMule = n.is_mule;
      const isOneHop = !isMule && oneHopIds.has(n.id);
      const radius = isMule ? 18 : isOneHop ? 14 : 10;

      // Glow
      if (isMule) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 59, 48, 0.2)';
        ctx.fill();
      } else if (isOneHop) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 149, 0, 0.15)';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isMule ? '#ff453a' : isOneHop ? '#ff9500' : (isDark ? '#555' : '#aaa');
      ctx.fill();
      ctx.strokeStyle = isMule ? '#ff453a' : isOneHop ? '#ff9500' : (isDark ? '#666' : '#ccc');
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = isDark ? '#e0e0e0' : '#333';
      ctx.font = `${isMule ? '600' : '400'} 10px Inter, sans-serif`;
      ctx.textAlign = 'center';
      const label = n.id.length > 16 ? n.id.slice(0, 14) + '…' : n.id;
      ctx.fillText(label, n.x, n.y + radius + 14);

      // Risk bump badge
      if (n.risk_bump > 0) {
        ctx.fillStyle = '#ff9500';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.fillText(`+${n.risk_bump}`, n.x, n.y - radius - 6);
      }
    });

    animRef.current = requestAnimationFrame(simulate);
  }, [graphData]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(simulate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [simulate]);

  // Click handler
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const simNodes = nodesRef.current;
    for (const n of simNodes) {
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < 400) {
        setSelectedNode(n);
        return;
      }
    }
    setSelectedNode(null);
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Mule Network Graph</h2>
          <p>Force-directed visualization of the flagged mule network and connected entities</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchGraph}>Refresh</button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {graphData.node_count} nodes · {graphData.edge_count} edges
          </span>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-md)',
        background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)', fontSize: '0.8rem',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff453a', display: 'inline-block' }}></span>
          Confirmed Mule
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff9500', display: 'inline-block' }}></span>
          1-Hop Neighbor (elevated risk)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#888', display: 'inline-block' }}></span>
          Other Entity
        </span>
      </div>

      {/* Canvas */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ width: '100%', minHeight: 500, cursor: 'crosshair', display: 'block' }}
        />

        {/* Selected node info panel */}
        {selectedNode && (
          <div style={{
            position: 'absolute', top: 16, right: 16,
            background: 'var(--bg-card)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--space-md)',
            minWidth: 220, boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.95rem' }}>
              {selectedNode.id}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <div><strong>Mule:</strong> {selectedNode.is_mule ? 'Yes' : 'No'}</div>
              <div><strong>Risk Bump:</strong> {selectedNode.risk_bump > 0 ? `+${selectedNode.risk_bump}` : 'None'}</div>
              <div><strong>Connections:</strong> {selectedNode.neighbors_count}</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8, width: '100%' }}
              onClick={() => setSelectedNode(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
