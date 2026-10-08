const test = require('node:test');
const assert = require('node:assert/strict');

const mlService = require('../services/mlService');
const User = require('../models/User');
const DiagnosticSession = require('../models/DiagnosticSession');
const MonitoringSession = require('../models/MonitoringSession');
const { service: adaptiveDiagnosticService } = require('../services/adaptiveDiagnosticService');
const { startDiagnostic } = require('../controllers/diagnosticController');

const originalGetProctorHealth = mlService.getProctorHealth;
const originalFindUserById = User.findById;
const originalDiagnosticFind = DiagnosticSession.find;
const originalDiagnosticUpdateMany = DiagnosticSession.updateMany;
const originalDiagnosticCreate = DiagnosticSession.create;
const originalMonitoringFindOne = MonitoringSession.findOne;
const originalCreateSession = adaptiveDiagnosticService.createSession;
const originalActiveSessions = adaptiveDiagnosticService.activeSessions;

const makeRes = () => ({
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

const makeQueryResult = (value) => ({
  ...value,
  select: async () => value,
  then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  catch: (reject) => Promise.resolve(value).catch(reject),
});

const makeMonitoringQueryResult = (value) => ({
  sort: () => ({
    select: async () => value,
  }),
  select: async () => value,
});

const makeUser = (overrides = {}) => ({
  _id: 'user-1',
  institutionId: null,
  currentStreak: 0,
  diagnosticCompleted: false,
  diagnosticLock: {
    isLocked: false,
    lockedUntil: null,
    lockReason: '',
    lockCount: 0,
  },
  async save() {
    return this;
  },
  ...overrides,
});

const fullReadyHealth = {
  fullModelReady: true,
  cameraMonitoringReady: true,
  modelLoaded: true,
  modelFilePresent: true,
  onnxRuntimeAvailable: true,
  imageStackAvailable: true,
  supportsCameraMonitoring: true,
  supportsPhoneDetection: true,
  supportsExtraScreenDetection: true,
  supportsFallbackHeuristics: true,
  message: 'Live proctor model is ready.',
};

test.afterEach(() => {
  mlService.getProctorHealth = originalGetProctorHealth;
  User.findById = originalFindUserById;
  DiagnosticSession.find = originalDiagnosticFind;
  DiagnosticSession.updateMany = originalDiagnosticUpdateMany;
  DiagnosticSession.create = originalDiagnosticCreate;
  MonitoringSession.findOne = originalMonitoringFindOne;
  adaptiveDiagnosticService.createSession = originalCreateSession;
  adaptiveDiagnosticService.activeSessions = originalActiveSessions;
});

test('diagnostic start accepts heuristic camera monitoring when full ONNX readiness is unavailable', async () => {
  const user = makeUser();
  const createdSessions = [];

  mlService.getProctorHealth = async () => ({
    ...fullReadyHealth,
    fullModelReady: false,
    modelLoaded: false,
    modelFilePresent: false,
    supportsPhoneDetection: false,
    message: 'The proctor ONNX model file is missing. Using heuristic camera monitoring with limited detection.',
  });
  User.findById = () => makeQueryResult(user);
  MonitoringSession.findOne = () => ({
    select: async () => ({
      _id: 'monitoring-1',
      finalFlagged: false,
      status: 'active',
      sessionType: 'diagnostic',
    }),
  });
  DiagnosticSession.find = () => ({
    select: async () => [],
  });
  DiagnosticSession.updateMany = async () => ({ acknowledged: true, modifiedCount: 0 });
  DiagnosticSession.create = async (payload) => {
    createdSessions.push(payload);
    return payload;
  };
  adaptiveDiagnosticService.createSession = async () => ({
    token: 'diag-fallback-token',
    minQuestions: 30,
    maxQuestions: 50,
    totalQuestions: 30,
    timePerQuestion: 45,
    expiresIn: 3600,
  });
  adaptiveDiagnosticService.activeSessions = new Map([
    ['diag-fallback-token', {
      plan: [
        {
          topic: 'arrays',
          difficulty: 'Basic',
          sourceId: 'mcq-1',
          variantIndex: 0,
        },
      ],
    }],
  ]);

  const req = {
    body: {
      monitoringSessionId: 'monitoring-1',
    },
    user: {
      _id: user._id,
    },
  };
  const res = makeRes();

  await startDiagnostic(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.token, 'diag-fallback-token');
  assert.equal(createdSessions.length, 1);
  assert.equal(String(createdSessions[0].monitoringSessionId), 'monitoring-1');
});

test('diagnostic start rejects when the monitoring session is absent or inactive', async () => {
  const user = makeUser();

  mlService.getProctorHealth = async () => fullReadyHealth;
  User.findById = () => makeQueryResult(user);
  MonitoringSession.findOne = () => ({
    select: async () => null,
  });

  const req = {
    body: {
      monitoringSessionId: 'monitoring-2',
    },
    user: {
      _id: user._id,
    },
  };
  const res = makeRes();

  await startDiagnostic(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /live diagnostic monitoring session is required/i);
});

test('diagnostic start falls back to the latest active diagnostic monitoring session when the client session id has not propagated yet', async () => {
  const user = makeUser();
  const createdSessions = [];

  mlService.getProctorHealth = async () => fullReadyHealth;
  User.findById = () => makeQueryResult(user);
  MonitoringSession.findOne = (query) => {
    assert.equal(query.userId, user._id);
    assert.equal(query.sessionType, 'diagnostic');
    assert.equal(query.status, 'active');
    assert.equal(Object.hasOwn(query, '_id'), false);

    return makeMonitoringQueryResult({
      _id: 'monitoring-implicit-1',
      finalFlagged: false,
      status: 'active',
      sessionType: 'diagnostic',
    });
  };
  DiagnosticSession.find = () => ({
    select: async () => [],
  });
  DiagnosticSession.updateMany = async () => ({ acknowledged: true, modifiedCount: 0 });
  DiagnosticSession.create = async (payload) => {
    createdSessions.push(payload);
    return payload;
  };
  adaptiveDiagnosticService.createSession = async () => ({
    token: 'diag-implicit-token',
    minQuestions: 30,
    maxQuestions: 50,
    totalQuestions: 30,
    timePerQuestion: 45,
    expiresIn: 3600,
  });
  adaptiveDiagnosticService.activeSessions = new Map([
    ['diag-implicit-token', {
      plan: [
        {
          topic: 'strings',
          difficulty: 'Basic',
          sourceId: 'mcq-2',
          variantIndex: 0,
        },
      ],
    }],
  ]);

  const req = {
    body: {},
    user: {
      _id: user._id,
    },
  };
  const res = makeRes();

  await startDiagnostic(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.token, 'diag-implicit-token');
  assert.equal(createdSessions.length, 1);
  assert.equal(String(createdSessions[0].monitoringSessionId), 'monitoring-implicit-1');
});

test('diagnostic start rejects when the monitoring session is already flagged', async () => {
  const user = makeUser();

  mlService.getProctorHealth = async () => fullReadyHealth;
  User.findById = () => makeQueryResult(user);
  MonitoringSession.findOne = () => ({
    select: async () => ({
      _id: 'monitoring-3',
      finalFlagged: true,
      status: 'active',
      sessionType: 'diagnostic',
    }),
  });

  const req = {
    body: {
      monitoringSessionId: 'monitoring-3',
    },
    user: {
      _id: user._id,
    },
  };
  const res = makeRes();

  await startDiagnostic(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /already flagged and cannot be reused/i);
});

test('diagnostic start succeeds only when the lock is clear and full ONNX readiness is true', async () => {
  const user = makeUser();
  const createdSessions = [];

  mlService.getProctorHealth = async () => fullReadyHealth;
  User.findById = () => makeQueryResult(user);
  MonitoringSession.findOne = () => ({
    select: async () => ({
      _id: 'monitoring-4',
      finalFlagged: false,
      status: 'active',
      sessionType: 'diagnostic',
    }),
  });
  DiagnosticSession.find = () => ({
    select: async () => [],
  });
  DiagnosticSession.updateMany = async () => ({ acknowledged: true, modifiedCount: 0 });
  DiagnosticSession.create = async (payload) => {
    createdSessions.push(payload);
    return payload;
  };
  adaptiveDiagnosticService.createSession = async () => ({
    token: 'diag-token',
    minQuestions: 30,
    maxQuestions: 50,
    totalQuestions: 30,
    timePerQuestion: 45,
    expiresIn: 3600,
  });
  adaptiveDiagnosticService.activeSessions = new Map([
    ['diag-token', {
      plan: [
        {
          topic: 'arrays',
          difficulty: 'Basic',
          sourceId: 'mcq-1',
          variantIndex: 0,
        },
      ],
    }],
  ]);

  const req = {
    body: {
      monitoringSessionId: 'monitoring-4',
    },
    user: {
      _id: user._id,
    },
  };
  const res = makeRes();

  await startDiagnostic(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.token, 'diag-token');
  assert.equal(createdSessions.length, 1);
  assert.equal(String(createdSessions[0].monitoringSessionId), 'monitoring-4');
});
