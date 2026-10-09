import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPracticeMonitoringAnalysisTimings,
  isMonitoringStageReadyToProceed,
  scheduleWarmupActivation,
  waitForAttachedVideoPlayback,
} from './usePracticeMonitoring.helpers.js';

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

test('only the active stage is ready to proceed', () => {
  assert.equal(isMonitoringStageReadyToProceed('warming_up'), false);
  assert.equal(isMonitoringStageReadyToProceed('active'), true);
  assert.equal(isMonitoringStageReadyToProceed('starting_session'), false);
});

test('coding sessions use a slower initial analysis cadence', () => {
  const timings = getPracticeMonitoringAnalysisTimings('coding');

  assert.equal(timings.analysisResumeGraceMs, 1000);
  assert.equal(timings.frameKickoffDelayMs, 4000);
});

test('non-coding sessions keep the default monitoring cadence', () => {
  const timings = getPracticeMonitoringAnalysisTimings('assessment');

  assert.equal(timings.analysisResumeGraceMs, 500);
  assert.equal(timings.frameKickoffDelayMs, 1200);
});

test('warmup activation is scheduled in the background instead of blocking immediately', async () => {
  const stageChanges = [];
  const startedAt = Date.now();

  scheduleWarmupActivation({
    attemptId: 4,
    getCurrentAttemptId: () => 4,
    mediaStream: { active: true },
    warmupMs: 30,
    onActivate: () => {
      stageChanges.push({ stage: 'resolved', elapsedMs: Date.now() - startedAt });
    },
    setMonitoringStage: (stage) => {
      stageChanges.push({ stage, elapsedMs: Date.now() - startedAt });
    },
  });

  assert.deepEqual(stageChanges, []);

  await sleep(10);
  assert.deepEqual(stageChanges, []);

  await sleep(35);
  assert.equal(stageChanges.length, 2);
  assert.equal(stageChanges[0].stage, 'active');
  assert.ok(stageChanges[0].elapsedMs >= 25);
  assert.equal(stageChanges[1].stage, 'resolved');
});

test('warmup activation still promotes monitoring when stream.active is unavailable but tracks are live', async () => {
  const stageChanges = [];

  scheduleWarmupActivation({
    attemptId: 7,
    getCurrentAttemptId: () => 7,
    mediaStream: {
      getTracks: () => [{ readyState: 'live' }],
    },
    warmupMs: 20,
    onActivate: () => {
      stageChanges.push('resolved');
    },
    setMonitoringStage: (stage) => {
      stageChanges.push(stage);
    },
  });

  await sleep(35);
  assert.deepEqual(stageChanges, ['active', 'resolved']);
});

test('warmup activation does not promote monitoring when every track has ended', async () => {
  const stageChanges = [];

  scheduleWarmupActivation({
    attemptId: 8,
    getCurrentAttemptId: () => 8,
    mediaStream: {
      active: false,
      getTracks: () => [{ readyState: 'ended' }],
    },
    warmupMs: 20,
    onActivate: () => {
      stageChanges.push('resolved');
    },
    setMonitoringStage: (stage) => {
      stageChanges.push(stage);
    },
  });

  await sleep(35);
  assert.deepEqual(stageChanges, []);
});

test('attached capture video must become ready before monitoring startup resolves', async () => {
  const mediaStream = { id: 'stream-1' };
  let captureVideo = null;
  const startedAt = Date.now();
  const readyPromise = waitForAttachedVideoPlayback({
    getVideo: () => captureVideo,
    mediaStream,
    timeoutMs: 120,
    pollIntervalMs: 10,
  });

  setTimeout(() => {
    captureVideo = {
      srcObject: null,
      readyState: 0,
      play() {
        return Promise.resolve();
      },
    };
  }, 15);

  setTimeout(() => {
    captureVideo.readyState = 2;
  }, 45);

  const resolvedVideo = await readyPromise;
  assert.equal(resolvedVideo, captureVideo);
  assert.equal(captureVideo.srcObject, mediaStream);
  assert.ok(Date.now() - startedAt >= 35);
});

test('attached capture video timeout rejects instead of allowing startup to proceed', async () => {
  await assert.rejects(
    waitForAttachedVideoPlayback({
      getVideo: () => null,
      mediaStream: { id: 'stream-2' },
      timeoutMs: 30,
      pollIntervalMs: 10,
    }),
    /Camera preview could not be initialized/i
  );
});
