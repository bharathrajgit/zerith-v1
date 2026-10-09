import api from './api';

export const getChat = (problemId, type = 'practice') =>
  api.get(`/chat/${problemId}?type=${type}`);

export const sendMessage = (problemId, message, currentCode = '', problemType = 'practice') =>
  api.post(`/chat/${problemId}`, {
    message,
    currentCode,
    problemType,
  }, { timeout: 180000 });

export const sendAssistantMessage = (message, context = {}, history = []) =>
  api.post('/chat/assistant', {
    message,
    context,
    history,
  }, { timeout: 180000 });

export default {
  getChat,
  sendMessage,
  sendAssistantMessage,
};
