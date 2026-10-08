const test = require('node:test');
const assert = require('node:assert/strict');

const mlService = require('../services/mlService');
const monitoringService = require('../services/monitoringService');
const MonitoringSession = require('../models/MonitoringSession');

const controllerPath = require.resolve('../controllers/monitoring.controller');

const originalGetProctorHealth = mlService.getProctorHealth;
const originalCloseActiveSessionsForUser = monitoringService.closeActiveSessionsForUser;
const originalNormalizeWarningLimit = monitoringService.normalizeWarningLimit;
const originalSyncSessionLock = monitoringService.syncSessionLock;
const originalCreate = MonitoringSession.create;
const originalFindOne = MonitoringSession.findOne;

const loadController = () => {
  delete require.cache[controllerPath];
  return require(controllerPath);
};

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

test.afterEach(() => {
  mlService.getProctorHealth = originalGetProctorHealth;
  monitoringService.closeActiveSessionsForUser = originalCloseActiveSessionsForUser;
  monitoringService.normalizeWarningLimit = originalNormalizeWarningLimit;
  monitoringService.syncSessionLock = originalSyncSessionLock;
  MonitoringSession.create = originalCreate;
  MonitoringSession.findOne = originalFindOne;
  delete require.cache[controllerPath];
});

test('diagnostic monitoring session start allows heuristic fallback when the full ONNX model is unavailable', async () => {
  mlService.getProctorHealth = async () => ({
    fullModelReady: false,
    cameraMonitoringReady: true,
    modelLoaded: false,
    modelFilePresent: false,
    onnxRuntimeAvailable: false,
    imageStackAvailable: true,
    supportsCameraMonitoring: true,
    supportsFallbackHeuristics: true,
    message: 'The proctor ONNX model file is missing. Using heuristic camera monitoring with limited detection.',
  });
  monitoringService.closeActiveSessionsForUser = async () => {};
  monitoringService.normalizeWarningLimit = () => 3;
  MonitoringSession.create = async (payload) => ({
    _id: 'monitoring-session-diagnostic-1',
    warningCount: 0,
    warningLimit: 3,
    finalFlagged: false,
    riskLevel: 'NONE',
    riskScore: 0,
    signals: [],
    finalStatus: 'clean',
    ...payload,
  });

  const { startMonitoringSession } = loadController();
  const req = {
    body: {
      sessionType: 'diagnostic',
      previewEnabled: true,
    },
    user: {
      _id: 'user-1',
      institutionId: null,
    },
  };
  const res = makeRes();

  await startMonitoringSession(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.monitoringSessionId, 'monitoring-session-diagnostic-1');
});

test('assessment monitoring session start still allows heuristic fallback readiness', async () => {
  mlService.getProctorHealth = async () => ({
    fullModelReady: false,
    cameraMonitoringReady: true,
    modelLoaded: false,
    modelFilePresent: false,
    onnxRuntimeAvailable: false,
    imageStackAvailable: true,
    supportsCameraMonitoring: true,
    supportsFallbackHeuristics: true,
    message: 'The proctor ONNX model file is missing. Using heuristic camera monitoring with limited detection.',
  });
  monitoringService.closeActiveSessionsForUser = async () => {};
  monitoringService.normalizeWarningLimit = () => 3;
  MonitoringSession.create = async (payload) => ({
    _id: 'monitoring-session-1',
    warningCount: 0,
    warningLimit: 3,
    finalFlagged: false,
    riskLevel: 'NONE',
    riskScore: 0,
    signals: [],
    finalStatus: 'clean',
    ...payload,
  });

  const { startMonitoringSession } = loadController();
  const req = {
    body: {
      sessionType: 'assessment',
      topicId: 'topic-1',
      moduleId: 'module-1',
      previewEnabled: true,
    },
    user: {
      _id: 'user-2',
      institutionId: null,
    },
  };
  const res = makeRes();

  await startMonitoringSession(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.monitoringSessionId, 'monitoring-session-1');
});

const makeActiveSession = (sessionType) => ({
  _id: `monitoring-${sessionType}-browser`,
  userId: 'user-browser-1',
  sessionType,
  status: 'active',
  warningCount: 0,
  warningLimit: 3,
  finalFlagged: false,
  riskLevel: 'NONE',
  riskScore: 0,
  sourceFlags: [],
  signals: [],
  browserMetrics: {
    tabSwitches: 0,
    copyAttempts: 0,
    windowBlurCount: 0,
  },
  events: [],
  warnings: [],
  finalStatus: 'clean',
  async save() {
    return this;
  },
});

test('assessment browser metrics create warnings and lock at the warning limit', async () => {
  const session = makeActiveSession('assessment');
  MonitoringSession.findOne = async () => session;
  monitoringService.syncSessionLock = async (currentSession) => ({
    isLocked: !!currentSession.finalFlagged,
    lockedUntil: currentSession.finalFlagged ? new Date(Date.now() + 1000).toISOString() : null,
    lockReason: currentSession.finalFlagged ? 'tab_switch' : '',
    lockCount: currentSession.finalFlagged ? 1 : 0,
    sessionType: currentSession.sessionType,
  });

  const { recordMonitoringEvents } = loadController();
  const req = {
    params: { id: session._id },
    body: {
      browserMetrics: {
        tabSwitches: 3,
        copyAttempts: 0,
        windowBlurCount: 0,
      },
      events: [],
    },
    user: { _id: session.userId },
  };
  const res = makeRes();

  await recordMonitoringEvents(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.warningCount, 3);
  assert.equal(res.body.data.finalFlagged, true);
  assert.equal(res.body.data.isLocked, true);
  assert.equal(session.warnings.filter((warning) => warning.signals.includes('TAB_SWITCH')).length, 3);
});

test('coding browser metrics create copy warnings and lock at the warning limit', async () => {
  const session = makeActiveSession('coding');
  MonitoringSession.findOne = async () => session;
  monitoringService.syncSessionLock = async (currentSession) => ({
    isLocked: !!currentSession.finalFlagged,
    lockedUntil: currentSession.finalFlagged ? new Date(Date.now() + 1000).toISOString() : null,
    lockReason: currentSession.finalFlagged ? 'copy_attempt' : '',
    lockCount: currentSession.finalFlagged ? 1 : 0,
    sessionType: currentSession.sessionType,
  });

  const { recordMonitoringEvents } = loadController();
  const req = {
    params: { id: session._id },
    body: {
      browserMetrics: {
        tabSwitches: 0,
        copyAttempts: 3,
        windowBlurCount: 0,
      },
      events: [],
    },
    user: { _id: session.userId },
  };
  const res = makeRes();

  await recordMonitoringEvents(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.warningCount, 3);
  assert.equal(res.body.data.finalFlagged, true);
  assert.equal(res.body.data.isLocked, true);
  assert.equal(session.warnings.filter((warning) => warning.signals.includes('COPY_ATTEMPT')).length, 3);
});
