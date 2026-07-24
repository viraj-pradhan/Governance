import { useState, useEffect } from 'react';
import { fetchFleetStatus, haltFleet, resumeFleet } from '../api';

export default function EmergencyStop() {
  const [fleet, setFleet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null); // 'halt' | 'resume' | null
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    try {
      const data = await fetchFleetStatus();
      setFleet(data);
    } catch (e) {
      console.error('Fleet status error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleHalt = async () => {
    setProcessing(true);
    try {
      await haltFleet('operator');
      setConfirming(null);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleResume = async () => {
    setProcessing(true);
    try {
      await resumeFleet();
      setConfirming(null);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '60px auto' }}></div></div>;
  }

  const isHalted = fleet?.halted;

  return (
    <div>
      <div className="page-header" style={{ textAlign: 'center' }}>
        <h2>Emergency Stop</h2>
        <p>Fleet-wide kill switch for all agent operations</p>
      </div>

      <div className="emergency-container">
        {/* Status indicator */}
        <div className={`fleet-status-indicator ${isHalted ? 'status-halted' : 'status-active'}`}>
          <span className="status-dot"></span>
          {isHalted ? 'FLEET HALTED' : 'FLEET OPERATIONAL'}
        </div>

        {/* Big button */}
        {isHalted ? (
          <button
            className="resume-button"
            onClick={() => setConfirming('resume')}
            disabled={processing}
          >
            {processing ? 'Processing...' : 'Resume Fleet'}
          </button>
        ) : (
          <button
            className="halt-button"
            onClick={() => setConfirming('halt')}
            disabled={processing}
          >
            {processing ? 'Processing...' : 'HALT ALL AGENTS'}
          </button>
        )}

        {/* Info */}
        <div className="glass-card" style={{ maxWidth: 500, textAlign: 'center' }}>
          {isHalted ? (
            <>
              <div style={{ color: 'var(--accent-crimson)', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>
                🚨 All agent requests are being denied
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
                <strong>Halted by:</strong> {fleet.halted_by || 'unknown'}<br />
                <strong>Halted at:</strong> {fleet.halted_at ? new Date(fleet.halted_at).toLocaleString() : 'unknown'}<br /><br />
                Click <strong>Resume Fleet</strong> to restore normal operations.
                All active agents will immediately begin processing again.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--accent-emerald)', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>
                ✅ All systems operational
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
                The emergency stop will <strong>immediately deny all agent requests</strong> across
                the entire fleet. This is a safety measure for situations requiring instant containment.<br /><br />
                Individual agents can be revoked from the <strong>Agents</strong> page.
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Confirm Modal ────────────────────────────────── */}
      {confirming && (
        <div className="modal-overlay" onClick={() => setConfirming(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon">
                {confirming === 'halt' ? '🚨' : '✅'}
              </div>
              <h3 style={{ marginBottom: 'var(--space-md)', color: confirming === 'halt' ? 'var(--accent-crimson)' : 'var(--accent-emerald)' }}>
                {confirming === 'halt' ? 'Halt Entire Fleet?' : 'Resume Fleet Operations?'}
              </h3>
              <p>
                {confirming === 'halt'
                  ? 'This will immediately deny ALL requests from ALL agents. No financial operations will be processed until the fleet is resumed. This action is logged.'
                  : 'This will restore normal operations for all agents. Previously revoked agents will remain revoked.'
                }
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setConfirming(null)} disabled={processing}>
                  Cancel
                </button>
                <button
                  className={`btn ${confirming === 'halt' ? 'btn-danger' : 'btn-success'}`}
                  onClick={confirming === 'halt' ? handleHalt : handleResume}
                  disabled={processing}
                >
                  {processing && <span className="spinner" style={{ width: 14, height: 14 }}></span>}
                  {confirming === 'halt' ? 'Confirm Halt' : 'Confirm Resume'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
