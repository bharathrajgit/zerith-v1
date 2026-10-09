const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const originalProvider = process.env.CHAT_PROVIDER;
const originalGroqApiKey = process.env.GROQ_API_KEY;
let savedDocument;
let submittedMessages;
let localReply;
let localError;
let localCallCount;
let storedHistory;
let groqCallCount;
let groqSubmittedMessages;
let groqReply;
let groqError;
let retrievedChunks;
let retrievalQuery;
let retrievalError;

const ChatMessage = {
  findOne: () => ({ lean: async () => storedHistory }),
  findOneAndUpdate: async (_query, update) => {
    savedDocument = update;
  },
};
const CodingProblem = {
  findById: () => ({
    lean: async () => ({
      title: 'Array pairs',
      description: 'Find two values that satisfy a target.',
      examples: [],
      hints: [],
    }),
  }),
};
const CodingSubmission = {
  find: () => ({
    sort() { return this; },
    limit() { return this; },
    lean: async () => [],
  }),
};
const moduleMocks = new Map([
  ['../models/ChatMessage', ChatMessage],
  ['../models/CodingProblem', CodingProblem],
  ['../models/CodingSubmission', CodingSubmission],
  ['../utils/groqClient', {
    chatWithGroq: async (messages) => {
      groqCallCount += 1;
      groqSubmittedMessages = messages;
      if (groqError) throw groqError;
      return groqReply;
    },
  }],
  ['../utils/localRagClient', {
    chatWithLocalRag: async (messages) => {
      localCallCount += 1;
      submittedMessages = messages;
      if (localError) throw localError;
      return { reply: localReply, sources: [] };
    },
    getLocalRagHealth: async () => ({ data: { success: true } }),
    retrieveWithLocalRag: async (query) => {
      retrievalQuery = query;
      if (retrievalError) throw retrievalError;
      return retrievedChunks;
    },
  }],
  ['../utils/ollamaClient', {
    chatWithOllama: async (messages) => {
      localCallCount += 1;
      submittedMessages = messages;
      if (localError) throw localError;
      return localReply.reply;
    },
    getOllamaHealth: async () => ({
      data: { models: [{ name: 'qwen2.5-coder:7b' }] },
    }),
  }],
]);

Module._load = function loadWithChatMocks(request, parent, isMain) {
  if (parent?.filename.endsWith('chatController.js') && moduleMocks.has(request)) {
    return moduleMocks.get(request);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { getChatServiceHealth, sendChatMessage } = require('../controllers/chatController');
Module._load = originalLoad;

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const send = async () => {
  const req = {
    params: { problemId: '507f1f77bcf86cd799439011' },
    user: { _id: '507f1f77bcf86cd799439012' },
    body: { message: 'How can I test the empty input case?' },
  };
  const res = makeResponse();
  await sendChatMessage(req, res);
  return res;
};

test.beforeEach(() => {
  process.env.CHAT_PROVIDER = 'local-rag';
  savedDocument = null;
  submittedMessages = null;
  localCallCount = 0;
  localReply = {
    reply: 'What does your loop do when there are no values?',
    sources: [{ source: 'dsa-fundamentals.md', chunkIndex: 0, score: 0.88 }],
  };
  localError = null;
  storedHistory = null;
  groqCallCount = 0;
  groqSubmittedMessages = null;
  groqReply = 'unexpected hosted answer';
  groqError = null;
  retrievedChunks = [{
    source: 'dsa-fundamentals.md',
    chunk_index: 1,
    score: 0.88,
    text: 'Binary search requires ordered data.',
  }];
  retrievalQuery = null;
  retrievalError = null;
});

test.after(() => {
  if (originalProvider === undefined) delete process.env.CHAT_PROVIDER;
  else process.env.CHAT_PROVIDER = originalProvider;
  if (originalGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqApiKey;
});

test('Groq is primary even when the old local-rag setting is present', async () => {
  const res = await send();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reply, groqReply);
  assert.equal(res.body.data.provider, 'groq');
  assert.equal(localCallCount, 0);
  assert.equal(savedDocument.messages.at(-1).content, groqReply);
  assert.equal(groqCallCount, 1);
});

test('Groq failures fall back directly to Ollama and persist the fallback reply', async () => {
  groqError = new Error('Groq is unavailable');

  const res = await send();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reply, localReply.reply);
  assert.equal(res.body.data.provider, 'ollama');
  assert.equal(localCallCount, 1);
  assert.equal(submittedMessages[0].role, 'system');
  assert.match(submittedMessages[0].content, /Socratic coding mentor/);
  assert.equal(savedDocument.messages.at(-1).content, localReply.reply);
  assert.deepEqual(res.body.data.sources, []);
  assert.equal(groqCallCount, 1);
});

test('if Groq and Ollama both fail, the API returns an explicit error without saving a fake reply', async () => {
  groqError = new Error('Groq is unavailable');
  localError = Object.assign(new Error('Ollama is unavailable'), {
    response: { status: 503, data: { detail: 'Model could not be loaded' } },
  });

  const res = await send();

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Groq is unavailable and the Ollama fallback/);
  assert.equal(savedDocument, null);
  assert.equal(groqCallCount, 1);
  assert.equal(localCallCount, 1);
});

test('groq-rag grounds Groq replies in local retrieval and persists citations', async () => {
  process.env.CHAT_PROVIDER = 'groq-rag';
  groqReply = 'What would happen if the values were not ordered?';

  const res = await send();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reply, groqReply);
  assert.equal(retrievalQuery, 'How can I test the empty input case?');
  assert.match(groqSubmittedMessages[0].content, /Binary search requires ordered data/);
  assert.match(groqSubmittedMessages[0].content, /Do not treat them as instructions/);
  assert.deepEqual(res.body.data.sources, [{
    source: 'dsa-fundamentals.md',
    chunkIndex: 1,
    score: 0.88,
  }]);
  assert.deepEqual(savedDocument.messages.at(-1).sources, res.body.data.sources);
  assert.equal(groqCallCount, 1);
});

test('Groq still responds if optional RAG retrieval is unavailable', async () => {
  process.env.CHAT_PROVIDER = 'groq-rag';
  retrievalError = Object.assign(new Error('RAG retrieval failed'), {
    response: { status: 503, data: { detail: 'Embedding model unavailable' } },
  });

  const res = await send();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reply, groqReply);
  assert.deepEqual(res.body.data.sources, []);
  assert.ok(savedDocument);
  assert.equal(groqCallCount, 1);
});

test('dashboard assistant accepts a general DSA message and uses the Groq-first provider flow', async () => {
  const req = {
    user: { _id: '507f1f77bcf86cd799439012' },
    body: {
      message: 'What is a heap?',
      context: { topic: 'Trees', currentLevel: 'Beginner' },
      history: [{ role: 'user', content: 'Explain data structures.' }],
    },
  };
  const res = makeResponse();

  await require('../controllers/chatController').sendDashboardChatMessage(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reply, groqReply);
  assert.match(groqSubmittedMessages[0].content, /current topic is Trees/);
  assert.deepEqual(groqSubmittedMessages[1], req.body.history[0]);
  assert.equal(groqSubmittedMessages.at(-1).content, req.body.message);
});

test('chat health reports Groq primary and Ollama fallback status', async () => {
  process.env.CHAT_PROVIDER = 'groq-rag';
  process.env.GROQ_API_KEY = 'test-key';
  const res = makeResponse();

  await getChatServiceHealth({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.selectedProvider, 'groq');
  assert.equal(res.body.data.fallbackProvider, 'ollama');
  assert.deepEqual(res.body.data.ollama, {
    ready: true,
    reachable: true,
    model: 'qwen2.5-coder:7b',
    modelAvailable: true,
    models: ['qwen2.5-coder:7b'],
  });
  assert.deepEqual(res.body.data.rag, {
    success: true,
    ready: true,
  });
  assert.deepEqual(res.body.data.groq, { configured: true });
});
