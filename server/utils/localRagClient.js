const axios = require('axios');

const getServiceUrl = () => String(
  process.env.CHATBOT_SERVICE_URL || 'http://127.0.0.1:8100'
).replace(/\/+$/, '');

const getHeaders = () => {
  const token = process.env.CHATBOT_API_TOKEN;
  return token ? { 'X-Chatbot-Api-Token': token } : {};
};

const chatWithLocalRag = async (messages) => {
  const systemPrompt = messages.find((message) => message.role === 'system')?.content;
  const conversation = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(({ role, content }) => ({ role, content }));
  if (!systemPrompt || conversation.length === 0) {
    throw new Error('A system prompt and conversation are required for local RAG chat');
  }

  const timeout = Number(process.env.CHATBOT_TIMEOUT_MS || 120000);
  const response = await axios.post(
    `${getServiceUrl()}/chat`,
    { systemPrompt, messages: conversation },
    { headers: getHeaders(), timeout }
  );
  const reply = response.data?.data?.reply;
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('Local RAG service returned an empty or invalid chat response');
  }
  return {
    reply: reply.trim(),
    sources: Array.isArray(response.data?.data?.sources)
      ? response.data.data.sources
      : [],
  };
};

const retrieveWithLocalRag = async (query, topK = 4) => {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    throw new Error('A query is required for local RAG retrieval');
  }

  const timeout = Number(process.env.CHATBOT_RETRIEVAL_TIMEOUT_MS || 10000);
  const response = await axios.post(
    `${getServiceUrl()}/debug/retrieve`,
    { query: normalizedQuery, topK },
    { headers: getHeaders(), timeout }
  );
  const results = response.data?.data?.results;
  if (!Array.isArray(results)) {
    throw new Error('Local RAG service returned invalid retrieval results');
  }
  return results;
};

const getLocalRagHealth = async () => axios.get(`${getServiceUrl()}/ready`, {
  headers: getHeaders(),
  timeout: 5000,
});

module.exports = { chatWithLocalRag, getLocalRagHealth, retrieveWithLocalRag };
