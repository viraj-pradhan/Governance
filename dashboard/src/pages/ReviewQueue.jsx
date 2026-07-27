import React, { useState, useEffect } from 'react';
import { fetchReviewQueue, approveReview, rejectReview } from '../api';

export default function ReviewQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadQueue = async () => {
    try {
      const data = await fetchReviewQueue();
      setQueue(data);
    } catch (err) {
      console.error("Failed to fetch review queue:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (traceId) => {
    try {
      await approveReview(traceId);
      loadQueue();
    } catch (err) {
      alert("Error approving transaction: " + err.message);
    }
  };

  const handleReject = async (traceId) => {
    try {
      await rejectReview(traceId);
      loadQueue();
    } catch (err) {
      alert("Error rejecting transaction: " + err.message);
    }
  };

  const getRiskColor = (score) => {
    if (score >= 60) return 'var(--accent-crimson)';
    if (score >= 40) return 'var(--accent-amber)';
    return '#f59e0b';
  };

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <h2>Human Review Queue</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-lg)' }}>
        Transactions held in the 30–70 risk score band requiring step-up operator approval.
      </p>

      {loading ? (
        <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>
      ) : queue.length === 0 ? (
        <div className="glass-card empty-state" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
          <p>No held transactions in review queue.</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Transactions with risk scores between 30–70 will appear here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          {queue.map((tx) => (
            <div
              key={tx.trace_id}
              className="glass-card"
              style={{
                padding: 'var(--space-lg)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 'var(--space-lg)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>
                  Action: {tx.action} {tx.amount ? `($${Number(tx.amount).toLocaleString()})` : ''}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Trace ID: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{tx.trace_id}</code>
                  &nbsp;| Agent: {tx.agent_id} (v{tx.version})
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Beneficiary: {tx.beneficiary || 'N/A'}
                  &nbsp;| Risk Score: <strong style={{ color: getRiskColor(tx.risk_score) }}>{tx.risk_score}</strong>
                </div>

                {/* Risk factors display */}
                {tx.risk_factors && tx.risk_factors.length > 0 && (
                  <div style={{
                    marginTop: 8,
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}>
                    {tx.risk_factors.map((factor, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: '0.7rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--accent-amber-glow)',
                          color: 'var(--accent-amber)',
                          border: '1px solid rgba(255, 149, 0, 0.2)',
                        }}
                      >
                        {factor}
                      </span>
                    ))}
                  </div>
                )}

                {/* Explanation */}
                {tx.explanation && (
                  <div style={{
                    marginTop: 6,
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                  }}>
                    {tx.explanation}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-sm)', flexShrink: 0, alignSelf: 'center' }}>
                <button
                  onClick={() => handleApprove(tx.trace_id)}
                  className="btn btn-success btn-sm"
                >
                  Approve (ALLOW)
                </button>
                <button
                  onClick={() => handleReject(tx.trace_id)}
                  className="btn btn-danger btn-sm"
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
