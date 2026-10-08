const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');

const controllerPath = require.resolve('../controllers/malpracticeController');

const originalUserFind = User.find;
const originalUserFindById = User.findById;
const originalMalpracticeCountDocuments = MalpracticeLog.countDocuments;
const originalMalpracticeFind = MalpracticeLog.find;
const originalMalpracticeUpdateMany = MalpracticeLog.updateMany;
const originalMonitoringAggregate = MonitoringEvidence.aggregate;

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
  User.find = originalUserFind;
  User.findById = originalUserFindById;
  MalpracticeLog.countDocuments = originalMalpracticeCountDocuments;
  MalpracticeLog.find = originalMalpracticeFind;
  MalpracticeLog.updateMany = originalMalpracticeUpdateMany;
  MonitoringEvidence.aggregate = originalMonitoringAggregate;
  delete require.cache[controllerPath];
});

test('institution logs only show unlock actions for the active unresolved lock row', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const now = Date.now();
  const activeLockUntil = new Date(now + (60 * 60 * 1000));
  const logs = [
    {
      _id: 'log-1',
      userId: {
        _id: userId,
        name: 'McaTest1',
        username: 'mcatest1',
        email: 'mcatest1@gmail.com',
      },
      sessionType: 'diagnostic',
      violationType: 'tab_switch',
      confidence: 0.92,
      detectedObject: '',
      riskLevel: 'HIGH',
      resultedInLock: true,
      resolvedAt: null,
      warningNumber: 3,
      createdAt: new Date(now - 1000),
      sessionData: {},
      hasEvidence: false,
      evidenceCount: 0,
      latestEvidenceAt: null,
      latestEvidenceTrigger: '',
    },
    {
      _id: 'log-2',
      userId: {
        _id: userId,
        name: 'McaTest1',
        username: 'mcatest1',
        email: 'mcatest1@gmail.com',
      },
      sessionType: 'diagnostic',
      violationType: 'tab_switch',
      confidence: 0.74,
      detectedObject: '',
      riskLevel: 'MEDIUM',
      resultedInLock: false,
      resolvedAt: null,
      warningNumber: 2,
      createdAt: new Date(now - 500),
      sessionData: {},
      hasEvidence: false,
      evidenceCount: 0,
      latestEvidenceAt: null,
      latestEvidenceTrigger: '',
    },
    {
      _id: 'log-3',
      userId: {
        _id: userId,
        name: 'McaTest1',
        username: 'mcatest1',
        email: 'mcatest1@gmail.com',
      },
      sessionType: 'diagnostic',
      violationType: 'tab_switch',
      confidence: 0.88,
      detectedObject: '',
      riskLevel: 'HIGH',
      resultedInLock: true,
      resolvedAt: new Date(now - 250),
      warningNumber: 4,
      createdAt: new Date(now - 1500),
      sessionData: {},
      hasEvidence: false,
      evidenceCount: 0,
      latestEvidenceAt: null,
      latestEvidenceTrigger: '',
    },
  ];

  User.find = () => ({
    select: () => ({
      lean: async () => ([{
        _id: userId,
        diagnosticLock: {
          isLocked: true,
          lockedUntil: activeLockUntil,
          lockReason: 'tab_switch',
          lockCount: 2,
        },
        codingLock: {
          isLocked: false,
          lockedUntil: null,
          lockReason: '',
          lockCount: 0,
        },
        assessmentLock: {
          isLocked: false,
          lockedUntil: null,
          lockReason: '',
          lockCount: 0,
        },
      }]),
    }),
  });

  MalpracticeLog.countDocuments = async () => logs.length;
  MalpracticeLog.find = () => ({
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => logs,
  });
  MonitoringEvidence.aggregate = async () => [];

  const { getInstitutionMalpracticeLogs } = loadController();
  const req = {
    query: {},
    institution: { _id: 'institution-1' },
  };
  const res = makeRes();

  await getInstitutionMalpracticeLogs(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.logs.length, 3);
  assert.equal(res.body.logs[0].isCurrentlyLocked, true);
  assert.equal(res.body.logs[1].isCurrentlyLocked, false);
  assert.equal(res.body.logs[2].isCurrentlyLocked, false);
  assert.equal(res.body.logs[0].lockReason, 'tab_switch');
});

test('unlockStudent resolves only the requested session type logs', async () => {
  const studentId = '507f1f77bcf86cd799439012';
  const institutionId = 'institution-1';
  let saveCalls = 0;
  const updateCalls = [];
  const student = {
    _id: studentId,
    institutionId,
    assessmentLock: {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: 0,
    },
    codingLock: {
      isLocked: true,
      lockedUntil: new Date(Date.now() + (30 * 60 * 1000)),
      lockReason: 'copy_attempt',
      lockCount: 1,
    },
    diagnosticLock: {
      isLocked: true,
      lockedUntil: new Date(Date.now() + (30 * 60 * 1000)),
      lockReason: 'tab_switch',
      lockCount: 4,
    },
    async save() {
      saveCalls += 1;
      return this;
    },
  };

  User.findById = async () => student;
  MalpracticeLog.updateMany = async (query, update) => {
    updateCalls.push({ query, update });
    return { acknowledged: true };
  };

  const { unlockStudent } = loadController();
  const req = {
    body: {
      studentId,
      sessionType: 'diagnostic',
    },
    institution: { _id: institutionId },
  };
  const res = makeRes();

  await unlockStudent(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(student.diagnosticLock.isLocked, false);
  assert.equal(student.codingLock.isLocked, true);
  assert.equal(saveCalls, 1);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].query, {
    userId: studentId,
    sessionType: 'diagnostic',
  });
  assert.equal(updateCalls[0].update.$set.resolvedAt instanceof Date, true);
});
