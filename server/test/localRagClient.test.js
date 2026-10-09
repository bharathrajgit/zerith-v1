const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const {
  chatWithLocalRag,
  getLocalRagHealth,
  retrieveWithLocalRag,
} = require('../utils/localRagClient');

const originalPost = axios.post;
const originalGet = axios.get;
const originalServiceUrl = process.env.CHATBOT_SERVICE_URL;
const originalTimeout = process.env.CHATBOT_TIMEOUT_MS;
const originalRetrievalTimeout = process.env.CHATBOT_RETRIEVAL_TIMEOUT_MS;
const originalToken = process.env.CHATBOT_API_TOKEN;

test.afterEach(() => {
  axios.post = originalPost;
  axios.get = originalGet;
  if (originalServiceUrl === undefined) delete process.env.CHATBOT_SERVICE_URL;
  else process.env.CHATBOT_SERVICE_URL = originalServiceUrl;
  if (originalTimeout === undefined) delete process.env.CHATBOT_TIMEOUT_MS;
  else process.env.CHATBOT_TIMEOUT_MS = originalTimeout;
  if (originalRetrievalTimeout === undefined) delete process.env.CHATBOT_RETRIEVAL_TIMEOUT_MS;
  else process.env.CHATBOT_RETRIEVAL_TIMEOUT_MS = originalRetrievalTimeout;
  if (originalToken === undefined) delete process.env.CHATBOT_API_TOKEN;
  else process.env.CHATBOT_API_TOKEN = originalToken;
});

test('chatWithLocalRag sends the system prompt and conversation to the standalone service', async () => {
  process.env.CHATBOT_SERVICE_URL = 'http://127.0.0.1:8100/';
  process.env.CHATBOT_TIMEOUT_MS = '45000';
  process.env.CHATBOT_API_TOKEN = 'test-token';
  axios.post = async (url, payload, options) => {
    assert.equal(url, 'http://127.0.0.1:8100/chat');
    assert.equal(payload.systemPrompt, 'Socratic system rules');
    assert.deepEqual(payload.messages, [
      { role: 'user', content: 'Help me reason.' },
    ]);
    assert.equal(options.timeout, 45000);
    assert.equal(options.headers['X-Chatbot-Api-Token'], 'test-token');
    return {
      data: {
        data: {
          reply: 'What does your invariant say?',
          sources: [{ source: 'arrays.md', chunkIndex: 2, score: 0.87 }],
        },
      },
    };
  };

  const result = await chatWithLocalRag([
      { role: 'system', content: 'Socratic system rules' },
      { role: 'user', content: 'Help me reason.' },
    ]);
  assert.equal(result.reply, 'What does your invariant say?');
  assert.deepEqual(result.sources, [{ source: 'arrays.md', chunkIndex: 2, score: 0.87 }]);
});

test('chatWithLocalRag rejects an invalid conversation before making a request', async () => {
  axios.post = async () => {
    throw new Error('request should not be made');
  };

  await assert.rejects(
    chatWithLocalRag([{ role: 'user', content: 'Missing system prompt' }]),
    /system prompt and conversation are required/
  );
});

test('getLocalRagHealth queries the service readiness endpoint', async () => {
  process.env.CHATBOT_SERVICE_URL = 'http://localhost:8100/';
  axios.get = async (url, options) => {
    assert.equal(url, 'http://localhost:8100/ready');
    assert.equal(options.timeout, 5000);
    return { data: { success: true } };
  };

  const result = await getLocalRagHealth();
  assert.equal(result.data.success, true);
});

test('retrieveWithLocalRag sends the query to the standalone retrieval endpoint', async () => {
  process.env.CHATBOT_SERVICE_URL = 'http://127.0.0.1:8100/';
  process.env.CHATBOT_RETRIEVAL_TIMEOUT_MS = '45000';
  process.env.CHATBOT_API_TOKEN = 'test-token';
  axios.post = async (url, payload, options) => {
    assert.equal(url, 'http://127.0.0.1:8100/debug/retrieve');
    assert.deepEqual(payload, { query: 'Binary search', topK: 3 });
    assert.equal(options.timeout, 45000);
    assert.equal(options.headers['X-Chatbot-Api-Token'], 'test-token');
    return {
      data: {
        data: {
          results: [{ source: 'algorithms.md', chunk_index: 1, text: 'Sorted input.' }],
        },
      },
    };
  };

  const results = await retrieveWithLocalRag('  Binary search  ', 3);
  assert.deepEqual(results, [
    { source: 'algorithms.md', chunk_index: 1, text: 'Sorted input.' },
  ]);
});

test('retrieveWithLocalRag rejects empty queries before making a request', async () => {
  axios.post = async () => {
    throw new Error('request should not be made');
  };

  await assert.rejects(retrieveWithLocalRag('  '), /query is required/);
});
