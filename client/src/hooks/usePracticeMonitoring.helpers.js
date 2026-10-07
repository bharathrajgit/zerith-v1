export const MONITORING_START_TIMEOUT_MS = 60000;

const DEFAULT_ANALYSIS_TIMINGS = {
  frameKickoffDelayMs: 1500,
  analysisResumeGraceMs: 500,
};

const ANALYSIS_TIMINGS_BY_SESSION_TYPE = {
  diagnostic: { frameKickoffDelayMs: 2500, analysisResumeGraceMs: 750 },
  assessment: DEFAULT_ANALYSIS_TIMINGS,
  coding: DEFAULT_ANALYSIS_TIMINGS,
};

export const getPracticeMonitoringAnalysisTimings = (sessionType) => ({
  ...DEFAULT_ANALYSIS_TIMINGS,
  ...(ANALYSIS_TIMINGS_BY_SESSION_TYPE[sessionType] || {}),
});

export const isMonitoringStageReadyToProceed = (stage) => stage === 'active';

export const withTimeout = (task, timeoutMs, message, { onTimeout } = {}) => {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message || 'The operation timed out.'));
    }, timeoutMs);
  });

  const taskPromise = Promise.resolve().then(() => (typeof task === 'function' ? task() : task));

  return Promise.race([taskPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
};

const isStreamLive = (mediaStream) => {
  if (!mediaStream) return false;
  if (mediaStream.active === false) return false;
  if (typeof mediaStream.getTracks !== 'function') return true;
  return mediaStream.getTracks().some((track) => track?.readyState !== 'ended');
};

export const waitForAttachedVideoPlayback = ({ getVideo, mediaStream, timeoutMs = 7000 }) => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  let playRequested = false;

  const check = () => {
    const video = typeof getVideo === 'function' ? getVideo() : null;

    if (!isStreamLive(mediaStream)) {
      reject(new Error('Camera stream ended before the preview started. Please try again.'));
      return;
    }

    if (video) {
      if (mediaStream && video.srcObject !== mediaStream) {
        video.srcObject = mediaStream;
      }

      if (!playRequested && video.paused && typeof video.play === 'function') {
        playRequested = true;
        const playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {
            playRequested = false;
          });
        }
      }

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve(video);
        return;
      }
    }

    if (Date.now() - startedAt > timeoutMs) {
      reject(new Error('Camera preview could not start in time. Please try again.'));
      return;
    }

    setTimeout(check, 50);
  };

  check();
});

export const scheduleWarmupActivation = ({
  attemptId,
  getCurrentAttemptId,
  mediaStream,
  onActivate,
  setMonitoringStage,
  warmupMs = 0,
  setTimeoutImpl = setTimeout,
}) => setTimeoutImpl(() => {
  if (typeof getCurrentAttemptId === 'function' && getCurrentAttemptId() !== attemptId) {
    return;
  }

  if (mediaStream && !isStreamLive(mediaStream)) {
    setMonitoringStage?.('error');
    return;
  }

  onActivate?.();
}, Math.max(0, Number(warmupMs) || 0));
