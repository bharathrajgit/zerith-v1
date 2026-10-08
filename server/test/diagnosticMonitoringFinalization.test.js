const test = require('node:test');
const assert = require('node:assert/strict');

const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');
const MonitoringSession = require('../models/MonitoringSession');
const User = require('../models/User');
const { __test__ } = require('../controllers/diagnosticController');

const originalMonitoringFindOne = MonitoringSession.findOne;
const originalUserFindById = User.findById;
const originalEvidenceAggregate = MonitoringEvidence.aggregate;
const originalEvidenceUpdateMany = MonitoringEvidence.updateMany;
const originalLogFindOneAndUpdate = MalpracticeLog.findOneAndUpdate;
const originalLogFindByIdAndUpdate = MalpracticeLog.findByIdAndUpdate;

test.afterEach(() => {
  MonitoringSession.findOne = originalMonitoringFindOne;
  User.findById = originalUserFindById;
  MonitoringEvidence.aggregate = originalEvidenceAggregate;
  MonitoringEvidence.updateMany = originalEvidenceUpdateMany;
  MalpracticeLog.findOneAndUpdate = originalLogFindOneAndUpdate;
  MalpracticeLog.findByIdAndUpdate = originalLogFindByIdAndUpdate;
});

test('diagnostic monitoring finalization persists flagged browser malpractice summary', async () => {
  const savedUpdates = [];
  const monitoringSession = {
    _id: 'monitoring-diagnostic-1',
    userId: 'user-1',
    institutionId: 'institution-1',
    sessionType: 'diagnostic',
    status: 'active',
    previewEnabled: false,
    warningCount: 3,
    warningLimit: 3,
    finalFlagged: true,
    finalStatus: 'clean',
    riskLevel: 'HIGH',
    riskScore: 0.82,
    sourceFlags: ['browser'],
    signals: ['TAB_SWITCH'],
    browserMetrics: {
      tabSwitches: 3,
      copyAttempts: 0,
      windowBlurCount: 0,
    },
    visionFindings: {},
    warnings: [{
      message: 'Tab switching was detected during the monitored session.',
      signals: ['TAB_SWITCH'],
    }],
    events: [],
    async save() {
      return this;
    },
  };
  const user = {
    diagnosticLock: {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: 0,
    },
    async save() {
      return this;
    },
  };

  MonitoringSession.findOne = async () => monitoringSession;
  User.findById = () => ({
    select: async () => user,
  });
  MonitoringEvidence.aggregate = async () => [];
  MonitoringEvidence.updateMany = async () => ({ acknowledged: true });
  MalpracticeLog.findByIdAndUpdate = async () => ({ acknowledged: true });
  MalpracticeLog.findOneAndUpdate = async (_query, update) => {
    savedUpdates.push(update.$set);
    return { _id: 'malpractice-log-1' };
  };

  const summary = await __test__.finalizeMonitoringIfNeeded({
    req: {
      user: { _id: 'user-1' },
      ip: '127.0.0.1',
    },
    session: {
      monitoringSessionId: monitoringSession._id,
    },
    sessionData: {
      tabSwitches: 3,
      copyAttempts: 0,
      windowBlurCount: 0,
    },
    monitoringSessionId: monitoringSession._id,
    user: {
      _id: 'user-1',
      institutionId: 'institution-1',
    },
    combinedScorePercent: 60,
    answers: [],
  });

  assert.equal(summary.warningCount, 3);
  assert.equal(summary.warningLimit, 3);
  assert.equal(summary.finalFlagged, true);
  assert.equal(summary.riskLevel, 'HIGH');
  assert.equal(monitoringSession.status, 'finished');
  assert.equal(monitoringSession.finalStatus, 'flagged');
  assert.equal(savedUpdates.length, 1);
  assert.equal(savedUpdates[0].sessionType, 'diagnostic');
  assert.equal(savedUpdates[0].monitoringSessionId, monitoringSession._id);
  assert.equal(savedUpdates[0].warningCount, 3);
  assert.equal(savedUpdates[0].finalFlagged, true);
  assert.equal(user.diagnosticLock.isLocked, true);
});
