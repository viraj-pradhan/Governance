import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function ReviewQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = async () => {
    try {
      const res = await axios.get(`${API_BASE}/review/queue`);
      setQueue(res.data);
    } catch (err) {
      console.error("Failed to fetch review queue:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (traceId) => {
    try {
      await axios.post(`${API_BASE}/review/${traceId}/approve`);
      fetchQueue();
    } catch (err) {
      alert("Error approving transaction: " + err.message);
    }
  };

  const handleReject = async (traceId) => {
    try {
      await axios.post(`${API_BASE}/review/${traceId}/reject`);
      fetchQueue();
    } catch (err) {
      alert("Error rejecting transaction: " + err.message);
    }
  };

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h2>Human Review Queue</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-lg)' }}>
        Transactions held in the 30–70 risk score band requiring step-up operator approval.
      </p>

      {loading ? (
        <div>Loading review queue...</div>
      ) : queue.length === 0 ? (
        <div style={{ padding: 'var(--space-xl)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)' }}>
          ✅ No held transactions in review queue.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          {queue.map((tx) => (
            <div
              key={tx.trace_id}
              style={{
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-lg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  Action: {tx.action} (${tx.amount || 0})
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Trace ID: {tx.trace_id} | Agent: {tx.agent_id} (v{tx.version})
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Beneficiary: {tx.beneficiary || 'N/A'} | Risk Score: <strong style={{ color: '#f59e0b' }}>{tx.risk_score}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                <button
                  onClick={() => handleApprove(tx.trace_id)}
                  style={{
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Approve (ALLOW)
                </button>
                <button
                  onClick={() => handleReject(tx.trace_id)}
                  style={{
                    background: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Confirm Fraud (DENY)
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
