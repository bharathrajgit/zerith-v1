export const MONITORING_START_TIMEOUT_MS = 15000;
export const VIDEO_ELEMENT_READY_POLL_MS = 40;
const DEFAULT_ANALYSIS_RESUME_GRACE_MS = 500;
const DEFAULT_FRAME_KICKOFF_DELAY_MS = 1200;
const CODING_ANALYSIS_RESUME_GRACE_MS = 1000;
const CODING_FRAME_KICKOFF_DELAY_MS = 4000;

const READY_STAGES = new Set(['active']);
const STARTUP_BLOCKING_STAGES = new Set([
  'checking_readiness',
  'requesting_camera',
  'awaiting_video',
  'starting_session',
  'warming_up',
]);

export const isMonitoringStageReadyToProceed = (stage = '') => (
  READY_STAGES.has(String(stage || ''))
);

export const isStartupMonitoringStage = (stage = '') => (
  STARTUP_BLOCKING_STAGES.has(String(stage || ''))
);

export const getPracticeMonitoringAnalysisTimings = (sessionType = '') => {
  if (String(sessionType || '').trim().toLowerCase() === 'coding') {
    return {
      analysisResumeGraceMs: CODING_ANALYSIS_RESUME_GRACE_MS,
      frameKickoffDelayMs: CODING_FRAME_KICKOFF_DELAY_MS,
    };
  }

  return {
    analysisResumeGraceMs: DEFAULT_ANALYSIS_RESUME_GRACE_MS,
    frameKickoffDelayMs: DEFAULT_FRAME_KICKOFF_DELAY_MS,
  };
};

export const withTimeout = (promiseOrFactory, timeoutMs, message, options = {}) => {
  const { onTimeout } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);

    const resolveSafely = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    Promise.resolve(
      typeof promiseOrFactory === 'function'
        ? promiseOrFactory()
        : promiseOrFactory
    ).then(
      resolveSafely(resolve),
      resolveSafely(reject)
    );
  });
};

export const waitForAttachedVideoPlayback = ({
  getVideo,
  mediaStream,
  timeoutMs,
  errorMessage = 'Camera preview could not be initialized. Please try again.',
  pollIntervalMs = VIDEO_ELEMENT_READY_POLL_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) => new Promise((resolve, reject) => {
  let settled = false;
  let timeoutId = null;
  let intervalId = null;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeoutImpl(timeoutId);
      timeoutId = null;
    }
    if (intervalId) {
      clearIntervalImpl(intervalId);
      intervalId = null;
    }
  };

  const settle = (callback) => (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback(value);
  };

  const resolveSafely = settle(resolve);
  const rejectSafely = settle(reject);

  const tryActivate = () => {
    const video = getVideo?.();
    if (!video) return;

    if (mediaStream && video.srcObject !== mediaStream) {
      video.srcObject = mediaStream;
    }

    try {
      const playback = video.play?.();
      if (playback?.catch) {
        playback.catch(() => {});
      }
    } catch {
      // Ignore transient autoplay/playback issues while the stream warms up.
    }

    if ((video.srcObject === mediaStream || !mediaStream) && Number(video.readyState || 0) >= 2) {
      resolveSafely(video);
    }
  };

  timeoutId = setTimeoutImpl(() => {
    rejectSafely(new Error(errorMessage));
  }, timeoutMs);

  intervalId = setIntervalImpl(tryActivate, pollIntervalMs);
  tryActivate();
});

export const scheduleWarmupActivation = ({
  attemptId,
  getCurrentAttemptId,
  mediaStream,
  onActivate,
  setMonitoringStage,
  warmupMs,
  setTimeoutImpl = setTimeout,
}) => setTimeoutImpl(() => {
  if (attemptId !== getCurrentAttemptId()) return;
  const hasLiveTrack = typeof mediaStream?.getTracks === 'function'
    ? mediaStream.getTracks().some((track) => track?.readyState !== 'ended')
    : true;
  const streamUnavailable = mediaStream == null
    || (mediaStream.active === false && !hasLiveTrack);
  if (streamUnavailable) return;
  setMonitoringStage('active');
  onActivate?.();
}, warmupMs);
