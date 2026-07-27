/* API client for the Governance Gateway */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// -- Agents --

export const fetchAgents = () => request('/agents');

export const createAgent = (data) =>
  request('/agents', { method: 'POST', body: JSON.stringify(data) });

export const revokeAgent = (id) =>
  request(`/agents/${id}/revoke`, { method: 'POST' });

export const reinstateAgent = (id) =>
  request(`/agents/${id}/reinstate`, { method: 'POST' });

export const pauseAgent = (agentId) =>
  request(`/agents/${agentId}/estop`, { method: 'POST' });

export const resumeAgent = (agentId) =>
  request(`/agents/${agentId}/resume`, { method: 'POST' });

export const updateAgentBudget = (agentId, dailyLimit) =>
  request(`/agents/${agentId}/budget?daily_limit=${dailyLimit}`, { method: 'PATCH' });

// -- Policies --

export const fetchPolicies = (agentId) =>
  request(`/policies${agentId ? `?agent_id=${agentId}` : ''}`);

export const createPolicy = (data) =>
  request('/policies', { method: 'POST', body: JSON.stringify(data) });

// -- Fleet / E-Stop --

export const fetchFleetStatus = () => request('/admin/estop/status');

export const haltFleet = () =>
  request('/admin/estop/global', { method: 'POST' });

export const resumeFleet = () =>
  request('/admin/estop/global/clear', { method: 'POST' });

export const toggleAgentEstop = (agentId, active = true) =>
  request(`/admin/estop/agent/${agentId}?active=${active}`, { method: 'POST' });

// -- Audit Log (raw rows) --

export const fetchAuditLog = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.agent_id) qs.set('agent_id', params.agent_id);
  if (params.decision) qs.set('decision', params.decision);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.limit) qs.set('limit', params.limit);
  if (params.offset) qs.set('offset', params.offset);
  return request(`/audit-log?${qs.toString()}`);
};

// -- Grouped Decisions (one row per trace_id) --

export const fetchRecentDecisions = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.agent_id) qs.set('agent_id', params.agent_id);
  if (params.verdict) qs.set('verdict', params.verdict);
  if (params.search) qs.set('search', params.search);
  if (params.limit) qs.set('limit', params.limit);
  if (params.offset) qs.set('offset', params.offset);
  return request(`/decisions/recent?${qs.toString()}`);
};

// -- Metrics --

export const fetchLatencyMetrics = () => request('/metrics/latency');

// -- SSE Live Feed --

export function connectLiveFeed(onEvent, onError) {
  const es = new EventSource(`${API_BASE}/live`);

  es.addEventListener('decision', (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  });

  es.onerror = (err) => {
    console.warn('SSE connection error:', err);
    if (onError) onError(err);
  };

  return es;
}

// -- Simulation Toggles --

export const fetchSimulationStatus = () => request('/admin/simulate/status');

export const toggleOpaOutage = () =>
  request('/admin/simulate/opa-outage', { method: 'POST' });

export const toggleRedisOutage = () =>
  request('/admin/simulate/redis-outage', { method: 'POST' });

export const startTrafficSimulation = () =>
  request('/admin/simulate/traffic/start', { method: 'POST' });

export const stopTrafficSimulation = () =>
  request('/admin/simulate/traffic/stop', { method: 'POST' });

// -- Action / Authorize --

export const simulateAction = (data) =>
  request('/action/simulate', { method: 'POST', body: JSON.stringify(data) });

// -- Explanations --

export const fetchExplanations = () => request('/explanations');

// -- Graph --

export const fetchGraph = () => request('/graph');

// -- Review Queue --

export const fetchReviewQueue = () => request('/review/queue');

export const approveReview = (traceId) =>
  request(`/review/${traceId}/approve`, { method: 'POST' });

export const rejectReview = (traceId) =>
  request(`/review/${traceId}/reject`, { method: 'POST' });
