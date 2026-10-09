const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { chatWithOllama, getOllamaHealth } = require('../utils/ollamaClient');

const originalPost = axios.post;
const originalGet = axios.get;
const originalUrl = process.env.OLLAMA_URL;
const originalModel = process.env.OLLAMA_CHAT_MODEL;
const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

test.afterEach(() => {
  axios.post = originalPost;
  axios.get = originalGet;
  if (originalUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalUrl;
  if (originalModel === undefined) delete process.env.OLLAMA_CHAT_MODEL;
  else process.env.OLLAMA_CHAT_MODEL = originalModel;
  if (originalTimeout === undefined) delete process.env.OLLAMA_TIMEOUT_MS;
  else process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
});

test('chatWithOllama sends the conversation directly to the configured local model', async () => {
  process.env.OLLAMA_URL = 'http://localhost:11434/';
  process.env.OLLAMA_CHAT_MODEL = 'qwen2.5-coder:7b';
  process.env.OLLAMA_TIMEOUT_MS = '60000';
  const messages = [
    { role: 'system', content: 'Be a DSA tutor.' },
    { role: 'user', content: 'What is a heap?' },
  ];
  axios.post = async (url, payload, options) => {
    assert.equal(url, 'http://localhost:11434/api/chat');
    assert.equal(payload.model, 'qwen2.5-coder:7b');
    assert.deepEqual(payload.messages, messages);
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.options, { temperature: 0.7, num_predict: 400 });
    assert.equal(options.timeout, 60000);
    return { data: { message: { content: 'A heap is a tree-based structure.' } } };
  };

  assert.equal(await chatWithOllama(messages), 'A heap is a tree-based structure.');
});

test('chatWithOllama rejects empty responses', async () => {
  axios.post = async () => ({ data: { message: { content: '  ' } } });
  await assert.rejects(
    chatWithOllama([{ role: 'user', content: 'Hello' }]),
    /empty or invalid chat response/
  );
});

test('getOllamaHealth queries the local Ollama tags endpoint', async () => {
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434/';
  axios.get = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    assert.equal(options.timeout, 5000);
    return { data: { models: [] } };
  };

  const result = await getOllamaHealth();
  assert.deepEqual(result.data.models, []);
});
