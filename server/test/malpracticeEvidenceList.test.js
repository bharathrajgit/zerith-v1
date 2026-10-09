const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');
const { getInstitutionMalpracticeLogs } = require('../controllers/malpracticeController');

const originalUserFind = User.find;
const originalMalpracticeCountDocuments = MalpracticeLog.countDocuments;
const originalMalpracticeFind = MalpracticeLog.find;
const originalMonitoringAggregate = MonitoringEvidence.aggregate;

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
  MalpracticeLog.countDocuments = originalMalpracticeCountDocuments;
  MalpracticeLog.find = originalMalpracticeFind;
  MonitoringEvidence.aggregate = originalMonitoringAggregate;
});

test('institution logs return images linked directly to a malpractice log', async () => {
  const userId = '507f1f77bcf86cd799439013';
  const logId = '507f1f77bcf86cd799439014';
  const evidenceId = '507f1f77bcf86cd799439015';
  const capturedAt = new Date();
  const logs = [{
    _id: logId,
    userId: {
      _id: userId,
      name: 'McaTest1',
      username: 'mcatest1',
      email: 'mcatest1@gmail.com',
    },
    sessionType: 'coding',
    violationType: 'mobile_detected',
    confidence: 0.88,
    detectedObject: 'cell phone',
    riskLevel: 'HIGH',
    resultedInLock: false,
    resolvedAt: null,
    warningNumber: 1,
    createdAt: capturedAt,
    sessionData: {},
    hasEvidence: true,
    evidenceCount: 1,
    latestEvidenceAt: capturedAt,
    latestEvidenceTrigger: 'PHONE_VISIBLE',
    monitoringSessionId: null,
  }];

  User.find = () => ({
    select: () => ({
      lean: async () => ([{
        _id: userId,
        codingLock: { isLocked: false, lockedUntil: null, lockReason: '', lockCount: 0 },
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
  MonitoringEvidence.aggregate = async (pipeline) => {
    const linkedLogIds = pipeline[0]?.$match?.malpracticeLogId?.$in || [];
    if (linkedLogIds.some((id) => String(id) === logId)) {
      return [{ _id: logId, evidenceId, capturedAt }];
    }
    return [];
  };

  const req = {
    query: {},
    institution: { _id: 'institution-1' },
  };
  const res = makeRes();

  await getInstitutionMalpracticeLogs(req, res, (error) => {
    throw error;
  });

  assert.equal(res.body.success, true);
  assert.equal(res.body.logs[0].hasEvidence, true);
  assert.equal(res.body.logs[0].latestEvidenceId, evidenceId);
});
