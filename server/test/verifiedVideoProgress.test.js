const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const topicId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';
let progress;
let watchedVideos = [];
let markedCompleteCount = 0;
let loggedActivityCount = 0;
const topic = {
  _id: topicId,
  moduleId: '507f1f77bcf86cd799439013',
  videoDuration: 100 / 60,
  videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  learningAssets: [],
  title: 'Test video',
};

const Progress = {
  findOne: async () => progress,
  create: async (fields) => {
    progress = { ...fields, save: async () => {} };
    return progress;
  },
};
const Topic = {
  findById: () => ({ lean: async () => topic }),
};
const User = {
  findById: () => ({
    select: async () => ({ watchedVideos }),
  }),
};
const progressionService = {
  buildProgressionForUser: async () => ({}),
  getTopicProgressionState: () => ({ topic: { unlocked: true } }),
};
const roadmapGenerator = {
  markVideoCompleted: async () => {
    markedCompleteCount += 1;
  },
};
const streakService = {
  logActivity: async () => {
    loggedActivityCount += 1;
  },
};

const mockedModules = new Map([
  ['../models/CodingProblem', {}],
  ['../models/PerformanceLog', {}],
  ['../models/Progress', Progress],
  ['../models/Topic', Topic],
  ['../models/User', User],
  ['../services/roadmapGenerator', roadmapGenerator],
  ['../services/userReadinessService', {}],
  ['../services/scoreCalculator', {}],
  ['../services/progressionService', progressionService],
  ['../services/streakService', streakService],
]);

const originalLoad = Module._load;
Module._load = function loadWithControllerMocks(request, parent, isMain) {
  if (parent?.filename.endsWith('progress.controller.js') && mockedModules.has(request)) {
    return mockedModules.get(request);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  getTrustedVideoDurationSeconds,
  updateVideoProgress,
} = require('../controllers/progress.controller');
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

const saveProgress = async (body) => {
  const req = {
    params: { topicId },
    user: { _id: userId },
    body,
  };
  const res = makeResponse();
  await updateVideoProgress(req, res, (error) => {
    throw error;
  });
  return res;
};

test('trusted video duration honors the configured YouTube segment', () => {
  assert.equal(
    getTrustedVideoDurationSeconds({
      videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk&start=1m30s&end=4m30s',
      videoDuration: 100,
    }),
    180
  );
});

test('server bounds progress, preserves rewind history, and completes only at 90%', async () => {
  markedCompleteCount = 0;
  loggedActivityCount = 0;
  watchedVideos = [];

  progress = {
    videoPosition: 0,
    maxWatchedTime: 0,
    videoCompleted: false,
    lastProgressAt: null,
    status: 'InProgress',
    save: async () => {},
  };
  let res = await saveProgress({
    currentTime: 10000,
    maxWatchedTime: 10000,
    duration: 1,
    completed: true,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.duration, 100);
  assert.equal(res.body.data.maxWatchedTime, 10);
  assert.equal(res.body.data.completed, false);
  assert.equal(progress.videoCompleted, false);
  assert.equal(markedCompleteCount, 0);

  progress.videoPosition = 50;
  progress.maxWatchedTime = 50;
  progress.lastProgressAt = new Date(Date.now() - 1000);
  res = await saveProgress({ currentTime: 20, completed: true });
  assert.equal(res.body.data.currentTime, 20);
  assert.equal(res.body.data.maxWatchedTime, 50);
  assert.equal(res.body.data.completed, false);
  assert.equal(progress.videoCompleted, false);

  progress.videoPosition = 0;
  progress.maxWatchedTime = 0;
  progress.lastProgressAt = new Date(Date.now() - 60000);
  res = await saveProgress({ currentTime: 90, completed: false });
  assert.equal(res.body.data.maxWatchedTime, 90);
  assert.equal(res.body.data.completed, true);
  assert.equal(progress.videoCompleted, true);
  assert.equal(markedCompleteCount, 1);
  assert.equal(loggedActivityCount, 1);
});

test('legacy watched videos remain completed even without new progress fields', async () => {
  progress = {
    videoPosition: 12,
    save: async () => {},
  };
  watchedVideos = [topicId];

  const res = await saveProgress({ currentTime: 20, completed: false });

  assert.equal(res.body.data.completed, true);
  assert.equal(res.body.data.currentTime, 12);
  assert.equal(markedCompleteCount, 1);
  assert.equal(loggedActivityCount, 1);
});
