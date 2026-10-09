import api from './api';

export const startSession = async (mode) => {
  const { data } = await api.post('/coach/session/start', { mode });
  return data.data;
};

export const uploadResume = async (sessionId, file) => {
  const form = new FormData();
  form.append('resume', file);
  form.append('sessionId', sessionId);

  const { data } = await api.post('/coach/resume/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
};

export const submitAnswer = async (sessionId, answer, questionIndex) => {
  const { data } = await api.post(`/coach/session/${sessionId}/answer`, {
    answer,
    questionIndex,
  });
  return data.data;
};

export const groupTurn = async (sessionId, turn, studentMessage) => {
  const { data } = await api.post(`/coach/session/${sessionId}/group-discussion`, {
    turn,
    studentMessage,
  });
  return data.data;
};

export const getSessions = async () => {
  const { data } = await api.get('/coach/sessions');
  return data.data;
};

export const getSession = async (sessionId) => {
  const { data } = await api.get(`/coach/session/${sessionId}`);
  return data.data;
};

export const completeSession = async (sessionId) => {
  const { data } = await api.post(`/coach/session/${sessionId}/complete`);
  return data.data;
};

export default {
  startSession,
  uploadResume,
  submitAnswer,
  groupTurn,
  getSessions,
  getSession,
  completeSession,
};
