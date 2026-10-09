const axios = require('axios');

const getOllamaUrl = () => String(
  process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/+$/, '');

const chatWithOllama = async (messages) => {
  const model = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5-coder:7b';
  const timeout = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);
  const response = await axios.post(
    `${getOllamaUrl()}/api/chat`,
    {
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 400,
      },
    },
    { timeout }
  );
  const reply = response.data?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('Ollama returned an empty or invalid chat response');
  }
  return reply.trim();
};

const getOllamaHealth = async () => axios.get(`${getOllamaUrl()}/api/tags`, {
  timeout: 5000,
});

module.exports = { chatWithOllama, getOllamaHealth };
