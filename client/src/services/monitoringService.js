import api from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('dsa_token');
  return token
    ? {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    : { 'Content-Type': 'application/json' };
};

const buildMonitoringUrl = (path) => {
  const base = api.defaults.baseURL || 'http://localhost:5000/api';
  return `${base}${path}`;
};

export const startMonitoringSession = async (payload) => {
  const { data } = await api.post('/monitoring/sessions/start', payload);
  return data.data;
};

export const getMonitoringReadiness = async (sessionType) => {
  const { data } = await api.get('/monitoring/readiness', {
    params: sessionType ? { sessionType } : undefined,
  });
  return data.data;
};

export const recordMonitoringEvents = async (sessionId, payload) => {
  const { data } = await api.post(`/monitoring/sessions/${sessionId}/events`, payload);
  return data.data;
};

export const analyzeMonitoringFrame = async (sessionId, payload) => {
  const { data } = await api.post(`/monitoring/sessions/${sessionId}/analyze-frame`, payload);
  return data.data;
};

export const reportMonitoringFallbackViolation = async (payload) => {
  const { data } = await api.post('/malpractice/report-violation', payload);
  return data;
};

export const finishMonitoringSession = async (sessionId, payload, options = {}) => {
  if (!sessionId) return null;

  if (options.keepalive && typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const response = await window.fetch(
      buildMonitoringUrl(`/monitoring/sessions/${sessionId}/finish`),
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload || {}),
        keepalive: true,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to finish monitoring session');
    }

    const data = await response.json();
    return data.data;
  }

  const { data } = await api.post(`/monitoring/sessions/${sessionId}/finish`, payload);
  return data.data;
};
