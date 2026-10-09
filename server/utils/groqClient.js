const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

class GroqEmptyResponseError extends Error {
  constructor(model, finishReason, usage) {
    const details = [
      `model=${model}`,
      `finish_reason=${finishReason || 'unknown'}`,
      usage?.completion_tokens !== undefined
        ? `completion_tokens=${usage.completion_tokens}`
        : null,
    ].filter(Boolean).join(', ');
    super(`Groq returned an empty or invalid chat response (${details})`);
    this.name = 'GroqEmptyResponseError';
  }
}

async function chatWithGroq(messages, { maxTokens = 400 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  if (!apiKey || !apiKey.trim() || apiKey.trim() === 'your_groq_api_key_here') {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const response = await axios.post(
    GROQ_URL,
    {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const choice = response.data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new GroqEmptyResponseError(model, choice?.finish_reason, response.data?.usage);
  }

  return content;
}

module.exports = { chatWithGroq, GroqEmptyResponseError };
