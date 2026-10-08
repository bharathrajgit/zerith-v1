import api from './api';

export const getChat = (problemId, type = 'practice') =>
  api.get(`/chat/${problemId}?type=${type}`);

export const sendMessage = (problemId, message, currentCode = '', problemType = 'practice') =>
  api.post(`/chat/${problemId}`, {
    message,
    currentCode,
    problemType,
  });

export default {
  getChat,
  sendMessage,
};
