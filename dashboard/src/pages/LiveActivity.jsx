import { useState, useEffect, useRef } from 'react';
import { connectLiveFeed } from '../api';

export default function LiveActivity() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const feedRef = useRef(null);
  const esRef = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const es = connectLiveFeed(
      (event) => {
        setEvents((prev) => {
          const next = [{ ...event, _ts: Date.now(), _id: Math.random() }, ...prev];
          return next.slice(0, 200); // keep max 200 events
        });
      },
      () => setConnected(false),
    );

    es.onopen = () => setConnected(true);
    esRef.current = es;

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!pausedRef.current && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events]);

  const allowCount = events.filter(e => e.decision === 'ALLOW').length;
  const denyCount = events.filter(e => e.decision === 'DENY').length;

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Live Activity</h2>
          <p>Real-time authorization decisions streaming via SSE</p>
        </div>
        <div className="flex items-center gap-md">
          <div className={`badge ${connected ? 'badge-active' : 'badge-revoked'}`}>
            {connected ? '● Connected' : '● Disconnected'}
          </div>
          <button
            className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPaused(!paused)}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setEvents([])}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex gap-lg" style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="glass-card flex items-center gap-md" style={{ padding: 'var(--space-sm) var(--space-lg)' }}>
          <span style={{ color: 'var(--accent-emerald)', fontWeight: 700, fontSize: '1.3rem' }}>{allowCount}</span>
          <span className="text-secondary" style={{ fontSize: '0.82rem' }}>Allowed</span>
        </div>
        <div className="glass-card flex items-center gap-md" style={{ padding: 'var(--space-sm) var(--space-lg)' }}>
          <span style={{ color: 'var(--accent-crimson)', fontWeight: 700, fontSize: '1.3rem' }}>{denyCount}</span>
          <span className="text-secondary" style={{ fontSize: '0.82rem' }}>Denied</span>
        </div>
        <div className="glass-card flex items-center gap-md" style={{ padding: 'var(--space-sm) var(--space-lg)' }}>
          <span style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: '1.3rem' }}>{events.length}</span>
          <span className="text-secondary" style={{ fontSize: '0.82rem' }}>In buffer</span>
        </div>
      </div>

      {/* Live feed */}
      <div
        className="live-feed"
        ref={feedRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {events.length === 0 ? (
          <div className="glass-card empty-state">
            <div className="empty-icon">⚡</div>
            <p>Waiting for authorization events...</p>
            <p className="text-muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
              Start mock agents to generate traffic
            </p>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event._id}
              className={`live-event ${event.decision === 'ALLOW' ? 'event-allow' : 'event-deny'}`}
            >
              <div className="event-dot"></div>
              <div className="event-content">
                <div className="event-action">
                  <span className={`badge ${event.decision === 'ALLOW' ? 'badge-allow' : 'badge-deny'}`} style={{ marginRight: 8 }}>
                    {event.decision}
                  </span>
                  {event.action}
                  {event.amount && <span className="font-mono" style={{ marginLeft: 8 }}>${Number(event.amount).toLocaleString()}</span>}
                </div>
                <div className="event-detail">{event.reason}</div>
                <div className="event-meta">
                  Agent: {event.agent_id?.slice(0, 8)}…
                  &nbsp;•&nbsp;{event.latency_ms}ms
                  &nbsp;•&nbsp;{new Date(event._ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
