const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addWarning,
  consumeVisionAlertsForWarning,
  MONITORING_WARMUP_MS,
} = require('../services/monitoringService');

const makeSession = (overrides = {}) => ({
  startedAt: new Date(),
  visionAlertState: {},
  markModified() {},
  ...overrides,
});

test('warmup suppresses face-missing warnings', () => {
  const session = makeSession();

  const result = consumeVisionAlertsForWarning(session, [{
    code: 'FACE_MISSING',
    severity: 'MEDIUM',
    confidence: 0.82,
  }], new Date(session.startedAt).getTime() + 500);

  assert.equal(result.warningSuggested, false);
  assert.equal(result.primaryAlert, null);
});

test('single gaze-away frame does not trigger a warning but two confirmed frames do', () => {
  const baseTime = Date.now();
  const session = makeSession({
    startedAt: new Date(baseTime - MONITORING_WARMUP_MS - 2000),
  });

  const first = consumeVisionAlertsForWarning(session, [{
    code: 'GAZE_AWAY',
    severity: 'MEDIUM',
    confidence: 0.73,
  }], baseTime);
  assert.equal(first.warningSuggested, false);

  const second = consumeVisionAlertsForWarning(session, [{
    code: 'GAZE_AWAY',
    severity: 'MEDIUM',
    confidence: 0.76,
  }], baseTime + 4000);
  assert.equal(second.warningSuggested, true);
  assert.equal(second.primaryAlert?.code, 'GAZE_AWAY');
});

test('phone-visible alerts warn immediately once confidence is high enough', () => {
  const baseTime = Date.now();
  const session = makeSession({
    startedAt: new Date(baseTime - MONITORING_WARMUP_MS - 2000),
  });

  const result = consumeVisionAlertsForWarning(session, [{
    code: 'PHONE_VISIBLE',
    severity: 'HIGH',
    confidence: 0.93,
  }], baseTime);

  assert.equal(result.warningSuggested, true);
  assert.equal(result.primaryAlert?.code, 'PHONE_VISIBLE');
});

test('warning cooldown is applied per signal type instead of blocking every new warning', () => {
  const now = new Date();
  const session = makeSession({
    finalFlagged: false,
    warningCount: 0,
    warningLimit: 3,
    warnings: [],
  });

  assert.equal(addWarning(session, {
    source: 'browser',
    riskLevel: 'MEDIUM',
    message: 'Tab switching detected.',
    signals: ['TAB_SWITCH'],
  }), true);

  session.warnings[0].createdAt = now;

  assert.equal(addWarning(session, {
    source: 'browser',
    riskLevel: 'MEDIUM',
    message: 'Tab switching detected again immediately.',
    signals: ['TAB_SWITCH'],
  }), false);

  assert.equal(addWarning(session, {
    source: 'vision',
    riskLevel: 'MEDIUM',
    message: 'Face missing confirmed.',
    signals: ['FACE_MISSING'],
  }), true);

  assert.equal(session.warningCount, 2);
});
