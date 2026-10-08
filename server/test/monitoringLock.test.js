const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const { finalizeSession, syncSessionLock } = require('../services/monitoringService');

const originalFindById = User.findById;

test.afterEach(() => {
  User.findById = originalFindById;
});

test('syncSessionLock applies the 3-hour assessment lock once monitoring is final-flagged', async () => {
  const user = {
    assessmentLock: {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: 1,
    },
    async save() {
      return this;
    },
  };

  User.findById = () => ({
    select: async () => user,
  });

  const before = Date.now();
  const lockState = await syncSessionLock({
    userId: 'user-1',
    sessionType: 'assessment',
    finalFlagged: true,
    warnings: [{ signals: ['TAB_SWITCH'] }],
    browserMetrics: { tabSwitches: 3 },
    visionFindings: {},
  });

  assert.equal(lockState.isLocked, true);
  assert.equal(lockState.lockReason, 'tab_switch');
  assert.equal(lockState.lockCount, 2);
  assert.ok(new Date(lockState.lockedUntil).getTime() >= before + ((3 * 60 * 60 * 1000) - 2000));
  assert.equal(user.assessmentLock.isLocked, true);
});

test('syncSessionLock applies the 3-hour coding lock once monitoring is final-flagged', async () => {
  const user = {
    codingLock: {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: 0,
    },
    async save() {
      return this;
    },
  };

  User.findById = () => ({
    select: async () => user,
  });

  const lockState = await syncSessionLock({
    userId: 'user-2',
    sessionType: 'coding',
    finalFlagged: true,
    warnings: [{ signals: ['COPY_ATTEMPT'] }],
    browserMetrics: { copyAttempts: 5 },
    visionFindings: {},
  });

  assert.equal(lockState.isLocked, true);
  assert.equal(lockState.lockReason, 'copy_attempt');
  assert.equal(lockState.lockCount, 1);
  assert.equal(user.codingLock.isLocked, true);
});

test('syncSessionLock leaves unknown session types unlocked', async () => {
  let saveCalls = 0;
  const user = {
    async save() {
      saveCalls += 1;
      return this;
    },
  };

  User.findById = () => ({
    select: async () => user,
  });

  const lockState = await syncSessionLock({
    userId: 'user-2b',
    sessionType: 'revision',
    finalFlagged: true,
    warnings: [{ signals: ['COPY_ATTEMPT'] }],
    browserMetrics: { copyAttempts: 5 },
    visionFindings: {},
  });

  assert.deepEqual(lockState, {
    isLocked: false,
    lockedUntil: null,
    lockReason: '',
    lockCount: 0,
    sessionType: 'revision',
  });
  assert.equal(saveCalls, 0);
});

test('syncSessionLock keeps an already-active diagnostic lock unchanged', async () => {
  let saveCalls = 0;
  const lockedUntil = new Date(Date.now() + (15 * 60 * 1000));
  const user = {
    diagnosticLock: {
      isLocked: true,
      lockedUntil,
      lockReason: 'gaze_away',
      lockCount: 4,
    },
    async save() {
      saveCalls += 1;
      return this;
    },
  };

  User.findById = () => ({
    select: async () => user,
  });

  const lockState = await syncSessionLock({
    userId: 'user-3',
    sessionType: 'diagnostic',
    finalFlagged: true,
    warnings: [{ signals: ['MULTIPLE_FACES'] }],
    browserMetrics: {},
    visionFindings: { multipleFaces: true },
  });

  assert.equal(lockState.isLocked, true);
  assert.equal(lockState.lockReason, 'gaze_away');
  assert.equal(lockState.lockCount, 4);
  assert.equal(new Date(lockState.lockedUntil).getTime(), lockedUntil.getTime());
  assert.equal(saveCalls, 0);
});

test('finalizeSession marks camera monitoring as limited when no frame was analyzed', async () => {
  const user = {
    assessmentLock: {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: 0,
    },
    async save() {
      return this;
    },
  };
  const session = {
    _id: 'session-limited-1',
    userId: 'user-limited-1',
    sessionType: 'assessment',
    status: 'active',
    previewEnabled: true,
    lastAnalyzedAt: null,
    warningCount: 0,
    warningLimit: 3,
    finalFlagged: false,
    finalStatus: 'clean',
    riskLevel: 'NONE',
    riskScore: 0,
    sourceFlags: [],
    signals: [],
    events: [],
    warnings: [],
    browserMetrics: {
      tabSwitches: 0,
      copyAttempts: 0,
      windowBlurCount: 0,
    },
    visionFindings: {},
    async save() {
      return this;
    },
  };

  User.findById = () => ({
    select: async () => user,
  });

  await finalizeSession(session);

  assert.equal(session.status, 'finished');
  assert.equal(session.finalStatus, 'limited');
  assert.equal(session.riskLevel, 'LOW');
  assert.ok(session.signals.includes('CAMERA_ANALYSIS_MISSING'));
  assert.equal(session.warningCount, 0);
});
