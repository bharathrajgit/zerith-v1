const test = require('node:test');
const assert = require('node:assert/strict');

const MalpracticeLog = require('../models/MalpracticeLog');
const originalCreate = MalpracticeLog.create;

test.afterEach(() => {
  MalpracticeLog.create = originalCreate;
});

test('regression: antiMalpractice.saveIfSuspicious ignores client monitoringSessionId', async () => {
  let capturedPayload = null;
  MalpracticeLog.create = async (payload) => {
    capturedPayload = payload;
    return { _id: 'mock-log-id', ...payload };
  };

  const service = require('../services/antiMalpractice');
  const result = await service.saveIfSuspicious(
    { riskLevel: 'HIGH', riskScore: 0.9, flags: ['tab_switch'], reasons: ['test'] },
    '507f1f77bcf86cd799439011',
    '507f1f77bcf86cd799439012',
    '507f1f77bcf86cd799439013',
    { sessionType: 'coding', monitoringSessionId: '507f1f77bcf86cd799439014', answers: [{ timeToAnswer: 1 }] },
    { cheating_probability: 0.6, predicted_label: 1 }
  );

  assert.strictEqual(result.saved, true);
  assert.strictEqual(capturedPayload.monitoringSessionId, null);
  assert.strictEqual(capturedPayload.sessionType, 'coding');
});
