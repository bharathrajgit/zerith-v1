const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { chatWithGroq } = require('../utils/groqClient');

const originalApiKey = process.env.GROQ_API_KEY;
const originalModel = process.env.GROQ_MODEL;
const originalPost = axios.post;

test.afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalModel;
  axios.post = originalPost;
});

test('chatWithGroq uses the supported default model and returns its response', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  delete process.env.GROQ_MODEL;
  axios.post = async (url, payload, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(payload.model, 'openai/gpt-oss-120b');
    assert.equal(options.timeout, 30000);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return { data: { choices: [{ message: { content: 'What does this edge case return?' } }] } };
  };

  assert.equal(
    await chatWithGroq([{ role: 'user', content: 'Help me reason about this.' }]),
    'What does this edge case return?'
  );
});

test('chatWithGroq uses an explicitly configured model', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.GROQ_MODEL = 'custom/model';
  axios.post = async (_url, payload) => {
    assert.equal(payload.model, 'custom/model');
    return { data: { choices: [{ message: { content: 'A focused question.' } }] } };
  };

  assert.equal(await chatWithGroq([]), 'A focused question.');
});

test('chatWithGroq rejects an empty provider response', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  axios.post = async () => ({ data: { choices: [] } });

  await assert.rejects(chatWithGroq([]), /empty or invalid chat response/);
});
