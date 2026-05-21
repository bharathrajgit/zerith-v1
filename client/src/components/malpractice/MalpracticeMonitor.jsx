import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import api from '../../services/api';
import { useMalpractice } from '../../context/MalpracticeContext';
import styles from './MalpracticeMonitor.module.css';

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 120;
const FACE_SAMPLE_WIDTH = 96;
const FACE_SAMPLE_HEIGHT = 96;
const DEVICE_SAMPLE_WIDTH = 128;
const DEVICE_SAMPLE_HEIGHT = 96;

// Debug logging - can be enabled for troubleshooting
const DEBUG_LOGS = true;
const log = (...args) => { if (DEBUG_LOGS) console.log('[MalpracticeMonitor]', ...args); };
const warn = (...args) => { if (DEBUG_LOGS) console.warn('[MalpracticeMonitor]', ...args); };

// Warning limits per violation type
const WARNING_LIMITS = {
  gaze_away: 3,
  multiple_faces: 3,
  mobile_detected: 3,
  tab_switch: 3,
  copy_attempt: 5,
  behavioral_anomaly: 3,
};

// Cooldown between warnings of the same type
const VIOLATION_COOLDOWNS = {
  gaze_away: 15000,
  multiple_faces: 12000,
  mobile_detected: 15000,
  tab_switch: 5000,
  copy_attempt: 3000,
  behavioral_anomaly: 15000,
};

// Consecutive bad frames required before triggering a camera-based warning
const NO_FACE_FRAMES_REQUIRED = 10;
const LOOKING_AWAY_FRAMES_REQUIRED = 8;

// Grace periods
const MOUNT_GRACE_MS = 15000;
const TRANSITION_GRACE_MS = 8000;
const MODEL_LOAD_GRACE_MS = 20000;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isSkinPixel = (red, green, blue) => {
  const channelSpan = Math.max(red, green, blue) - Math.min(red, green, blue);
  return (
    red > 95 &&
    green > 40 &&
    blue > 20 &&
    channelSpan > 15 &&
    Math.abs(red - green) > 15 &&
    red > green &&
    red > blue
  );
};

const formatDuration = (lockedUntil) => {
  const remainingMs = Math.max(0, new Date(lockedUntil || 0).getTime() - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
};

const formatConfidence = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 1 ? Math.round(numeric) : Math.round(numeric * 100);
};

const createFrameSample = (video, canvasRef, width, height) => {
  if (!video?.videoWidth || !video?.videoHeight) {
    return null;
  }

  if (!canvasRef.current) {
    canvasRef.current = document.createElement('canvas');
  }

  const canvas = canvasRef.current;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  return {
    width,
    height,
    data: imageData.data,
  };
};

const buildMask = (sample, matcher) => {
  if (!sample?.data?.length) {
    return new Uint8Array(0);
  }

  const mask = new Uint8Array(sample.width * sample.height);
  for (let dataIndex = 0, pixelIndex = 0; dataIndex < sample.data.length; dataIndex += 4, pixelIndex += 1) {
    mask[pixelIndex] = matcher(
      sample.data[dataIndex],
      sample.data[dataIndex + 1],
      sample.data[dataIndex + 2]
    )
      ? 1
      : 0;
  }

  return mask;
};

const connectedComponents = (mask, width, height, minPixels = 70) => {
  if (!mask?.length || !width || !height) {
    return [];
  }

  const visited = new Uint8Array(mask.length);
  const components = [];

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const startIndex = (row * width) + col;
      if (!mask[startIndex] || visited[startIndex]) {
        continue;
      }

      const stack = [startIndex];
      visited[startIndex] = 1;
      let count = 0;
      let minRow = row;
      let maxRow = row;
      let minCol = col;
      let maxCol = col;
      let sumRow = 0;
      let sumCol = 0;

      while (stack.length) {
        const currentIndex = stack.pop();
        const currentRow = Math.floor(currentIndex / width);
        const currentCol = currentIndex % width;

        count += 1;
        sumRow += currentRow;
        sumCol += currentCol;
        minRow = Math.min(minRow, currentRow);
        maxRow = Math.max(maxRow, currentRow);
        minCol = Math.min(minCol, currentCol);
        maxCol = Math.max(maxCol, currentCol);

        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
            if (rowOffset === 0 && colOffset === 0) {
              continue;
            }

            const nextRow = currentRow + rowOffset;
            const nextCol = currentCol + colOffset;
            if (nextRow < 0 || nextCol < 0 || nextRow >= height || nextCol >= width) {
              continue;
            }

            const nextIndex = (nextRow * width) + nextCol;
            if (!mask[nextIndex] || visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            stack.push(nextIndex);
          }
        }
      }

      if (count >= minPixels) {
        components.push({
          count,
          minRow,
          maxRow,
          minCol,
          maxCol,
          width: maxCol - minCol + 1,
          height: maxRow - minRow + 1,
          centerX: sumCol / count,
          centerY: sumRow / count,
        });
      }
    }
  }

  return components.sort((left, right) => right.count - left.count);
};

const analyzeFaceSample = (sample) => {
  const detections = {
    multipleFaces: false,
    headPoseAway: false,
    gazeAway: false,
    faceMissing: false,
    faceCount: 0,
  };

  if (!sample?.data?.length) {
    detections.faceMissing = true;
    return { detections, confidence: 0.58 };
  }

  const pixelCount = sample.width * sample.height;
  const grayscale = new Float32Array(pixelCount);
  let brightnessTotal = 0;

  for (let pixelIndex = 0, dataIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, dataIndex += 4) {
    const brightness =
      (sample.data[dataIndex] + sample.data[dataIndex + 1] + sample.data[dataIndex + 2]) / 3;
    grayscale[pixelIndex] = brightness;
    brightnessTotal += brightness;
  }

  const brightness = brightnessTotal / Math.max(pixelCount, 1);
  let variance = 0;
  let gradientStrength = 0;

  for (let row = 0; row < sample.height; row += 1) {
    for (let col = 0; col < sample.width; col += 1) {
      const index = (row * sample.width) + col;
      const current = grayscale[index];
      variance += (current - brightness) ** 2;

      if (col < sample.width - 1) {
        gradientStrength += Math.abs(current - grayscale[index + 1]);
      }

      if (row < sample.height - 1) {
        gradientStrength += Math.abs(current - grayscale[index + sample.width]);
      }
    }
  }

  const contrast = Math.sqrt(variance / Math.max(pixelCount, 1));
  gradientStrength /= Math.max(
    (sample.width * Math.max(sample.height - 1, 1)) +
      (sample.height * Math.max(sample.width - 1, 1)),
    1
  );

  if (brightness < 8 || contrast < 4 || gradientStrength < 1.5) {
    detections.faceMissing = true;
    return { detections, confidence: 0.58 };
  }

  const skinMask = buildMask(sample, isSkinPixel);
  const centerStartRow = Math.floor(sample.height * 0.23);
  const centerEndRow = Math.ceil(sample.height * 0.77);
  const centerStartCol = Math.floor(sample.width * 0.23);
  const centerEndCol = Math.ceil(sample.width * 0.77);

  let skinPixels = 0;
  let centerPixels = 0;
  let centerSkinPixels = 0;

  for (let row = 0; row < sample.height; row += 1) {
    for (let col = 0; col < sample.width; col += 1) {
      const index = (row * sample.width) + col;
      if (skinMask[index]) {
        skinPixels += 1;
      }

      const inCenter =
        row >= centerStartRow &&
        row < centerEndRow &&
        col >= centerStartCol &&
        col < centerEndCol;

      if (inCenter) {
        centerPixels += 1;
        if (skinMask[index]) {
          centerSkinPixels += 1;
        }
      }
    }
  }

  const skinRatio = skinPixels / Math.max(pixelCount, 1);
  const centerRatio = centerSkinPixels / Math.max(centerPixels, 1);
  const components = connectedComponents(
    skinMask,
    sample.width,
    sample.height,
    Math.max(30, Math.round(pixelCount * 0.008))
  );

  if (!components.length || skinRatio < 0.015 || centerRatio < 0.01) {
    detections.faceMissing = true;
    return { detections, confidence: 0.56 };
  }

  detections.faceCount = components.length;
  const primary = components[0];
  const primaryAreaRatio = primary.count / Math.max(pixelCount, 1);
  const primaryOffset = Math.abs((primary.centerX / Math.max(sample.width - 1, 1)) - 0.5);
  let confidence = 0.34;

  if (components.length >= 2) {
    const secondary = components[1];
    const secondaryAreaRatio = secondary.count / Math.max(pixelCount, 1);
    const centersFarApart = Math.abs(primary.centerX - secondary.centerX) > (sample.width * 0.18);
    if (secondaryAreaRatio > 0.025 && centersFarApart) {
      detections.multipleFaces = true;
      confidence = Math.max(confidence, 0.72);
    }
  }

  if (primaryOffset > 0.22 && primaryAreaRatio > 0.03) {
    detections.headPoseAway = true;
    confidence = Math.max(confidence, 0.63);
  }

  if (primaryOffset > 0.14 && centerRatio < 0.13) {
    detections.gazeAway = true;
    confidence = Math.max(confidence, 0.57);
  }

  if (primaryAreaRatio < 0.03) {
    detections.faceMissing = true;
    detections.faceCount = 0;
    confidence = Math.max(confidence, 0.54);
  }

  return { detections, confidence };
};

const analyzePhoneSample = (sample) => {
  if (!sample?.data?.length) return null;

  const pixelCount = sample.width * sample.height;

  const screenMask = buildMask(sample, (red, green, blue) => {
    const brightness = (red + green + blue) / 3;
    const maxC = Math.max(red, green, blue);
    const minC = Math.min(red, green, blue);
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
    return brightness > 120 && saturation < 0.30 && !isSkinPixel(red, green, blue);
  });

  const darkMask = buildMask(sample, (red, green, blue) => {
    const brightness = (red + green + blue) / 3;
    const maxC = Math.max(red, green, blue);
    const minC = Math.min(red, green, blue);
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
    return brightness >= 10 && brightness <= 80 && saturation < 0.30 && !isSkinPixel(red, green, blue);
  });

  const minCompSize = Math.max(20, Math.round(pixelCount * 0.008));
  const screenComponents = connectedComponents(screenMask, sample.width, sample.height, minCompSize);
  const darkComponents = connectedComponents(darkMask, sample.width, sample.height, minCompSize);

  const isPhoneShape = (component) => {
    const areaRatio = component.count / Math.max(pixelCount, 1);
    const bboxArea = component.width * component.height;
    const fillRatio = bboxArea > 0 ? component.count / bboxArea : 0;
    const aspect = component.width / Math.max(component.height, 1);
    const isPortrait = aspect >= 0.28 && aspect <= 0.85;
    const isLandscape = aspect >= 1.2 && aspect <= 3.2;
    if (!isPortrait && !isLandscape) return false;
    if (areaRatio < 0.010 || areaRatio > 0.45) return false;
    if (fillRatio < 0.40) return false;
    return true;
  };

  const screenCandidates = screenComponents.filter(isPhoneShape);
  const darkCandidates = darkComponents.filter(isPhoneShape);

  if (screenCandidates.length === 0 && darkCandidates.length === 0) return null;

  const best = [...screenCandidates, ...darkCandidates].reduce((top, c) => {
    const areaRatio = c.count / Math.max(pixelCount, 1);
    const bboxArea = c.width * c.height;
    const fillRatio = bboxArea > 0 ? c.count / bboxArea : 0;
    const score = clamp(0.58 + (fillRatio - 0.40) * 0.4 + (areaRatio * 0.5), 0.58, 0.92);
    return score > (top?.confidence || 0) ? { confidence: score } : top;
  }, null);

  const bothPresent = screenCandidates.length > 0 && darkCandidates.length > 0;
  const finalConfidence = bothPresent ? Math.min(best.confidence + 0.08, 0.94) : best.confidence;

  return { label: 'cell phone', confidence: finalConfidence };
};

const getViolationDescription = (type, detectedObject = '') => {
  switch (type) {
    case 'gaze_away':
      return 'You looked away from the screen or your face was not visible.';
    case 'multiple_faces':
      return 'Multiple faces were detected in the camera frame.';
    case 'mobile_detected':
      return detectedObject
        ? `Unauthorized device detected: ${detectedObject}.`
        : 'Unauthorized device detected.';
    case 'tab_switch':
      return 'You switched away from the active test window.';
    case 'copy_attempt':
      return 'Copy, selection, or context menu action was blocked.';
    case 'behavioral_anomaly':
      return 'Suspicious behavior was detected during this session.';
    default:
      return 'Suspicious behavior was detected.';
  }
};

export function LockScreen({ lockInfo, onUnlock }) {
  const [countdown, setCountdown] = useState(() => formatDuration(lockInfo?.lockedUntil));

  useEffect(() => {
    if (!lockInfo?.lockedUntil) return undefined;

    const intervalId = window.setInterval(() => {
      const remaining = new Date(lockInfo.lockedUntil).getTime() - Date.now();
      if (remaining <= 0) {
        window.clearInterval(intervalId);
        if (typeof onUnlock === 'function') {
          onUnlock();
        } else {
          window.location.reload();
        }
        return;
      }
      setCountdown(formatDuration(lockInfo.lockedUntil));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [lockInfo?.lockedUntil, onUnlock]);

  return (
    <div className={styles.lockOverlay}>
      <div className={styles.lockIcon}>🔒</div>
      <h1 className={styles.lockTitle}>Test Locked</h1>
      <p className={styles.lockSubtitle}>
        A violation was detected: {getViolationDescription(lockInfo?.lockReason, lockInfo?.detectedObject)}
      </p>
      <div className={styles.countdown}>Unlocks in: {countdown}</div>
      <p className={styles.lockSubtitle}>
        After the timer expires you will be redirected back to the start.
        {lockInfo?.institutionId ? ' Your institution has been notified.' : ''}
      </p>
      <p className={styles.lockNotice}>Contact your instructor if this is an error.</p>
    </div>
  );
}

export default function MalpracticeMonitor({
  sessionType,
  assessmentId = '',
  topicId = '',
  paused = false,
  onLocked,
  onWarning,
  onUnlock,
}) {
  // Use centralized malpractice context
  const {
    isLocked,
    lockedUntil,
    lockReason,
    lockCount,
    getWarningCount,
    incrementWarning,
    setLocked,
    clearLock,
    shouldLock,
    getWarningLimit,
    WARNING_LIMITS: CONTEXT_LIMITS,
  } = useMalpractice(sessionType);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const deviceIntervalRef = useRef(null);
  const deviceModelRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const faceCanvasRef = useRef(null);
  const deviceCanvasRef = useRef(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const faceEnabledRef = useRef(false);
  const deviceEnabledRef = useRef(false);
  const faceDetectionModeRef = useRef('inactive');
  const deviceDetectionModeRef = useRef('inactive');
  const isLockedRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const gracePeriodRef = useRef(true);
  const graceTimerRef = useRef(null);
  const lastViolationTimeRef = useRef({});
  const dismissTimerRef = useRef(null);
  const warningFlashTimerRef = useRef(null);
  const pendingWarningRef = useRef(null);
  const noFaceFramesRef = useRef(0);
  const lookingAwayFramesRef = useRef(0);
  const tabThrottleRef = useRef(0);
  const mobileDetectionStreakRef = useRef(0);
  const mobileLastDetectionTimeRef = useRef(0);
  const MOBILE_CONFIRMATION_FRAMES = 2;
  const MOBILE_DETECTION_WINDOW_MS = 15000;

  const [status, setStatus] = useState('loading');
  const [cameraError, setCameraError] = useState(false);
  const [isWarningActive, setIsWarningActive] = useState(false);
  const [warningBanner, setWarningBanner] = useState(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(16, window.innerWidth - PREVIEW_WIDTH - 24),
    y: 16,
  }));

  // Sync local lock ref with context state
  useEffect(() => {
    isLockedRef.current = isLocked;
    if (isLocked && lockedUntil) {
      setLockData({
        isLocked: true,
        lockReason: lockReason,
        warningNumber: lockCount,
        riskLevel: 'HIGH',
        lockedUntil,
        timeRemainingMs: Math.max(0, new Date(lockedUntil).getTime() - Date.now()),
        timeRemainingFormatted: formatDuration(lockedUntil),
        lockCount,
        sessionType,
      });
      onLocked?.({
        isLocked: true,
        lockReason,
        lockedUntil,
        lockCount,
        sessionType,
      });
    }
  }, [isLocked, lockedUntil, lockReason, lockCount, sessionType, onLocked]);

  const stopDetectionLoop = () => {
    if (intervalRef.current) {
      window.clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    if (deviceIntervalRef.current) {
      window.clearTimeout(deviceIntervalRef.current);
      deviceIntervalRef.current = null;
    }
  };

  const scheduleFaceDetection = (delay) => {
    if (!faceEnabledRef.current || !isMountedRef.current) return;
    intervalRef.current = window.setTimeout(async () => {
      if (!isLockedRef.current && isMountedRef.current) await runDetection();
      if (isMountedRef.current && !isLockedRef.current && faceEnabledRef.current) {
        scheduleFaceDetection(3000);
      }
    }, delay);
  };

  const scheduleDeviceDetection = (delay) => {
    if (!deviceEnabledRef.current || !isMountedRef.current) return;
    deviceIntervalRef.current = window.setTimeout(async () => {
      if (!isLockedRef.current && isMountedRef.current) await runDeviceDetection();
      if (isMountedRef.current && !isLockedRef.current && deviceEnabledRef.current) {
        scheduleDeviceDetection(8000);
      }
    }, delay);
  };

  const startGracePeriod = (ms) => {
    gracePeriodRef.current = true;
    if (graceTimerRef.current) window.clearTimeout(graceTimerRef.current);
    noFaceFramesRef.current = 0;
    lookingAwayFramesRef.current = 0;
    resetMobileDetectionStreak();
    graceTimerRef.current = window.setTimeout(() => {
      gracePeriodRef.current = false;
    }, ms);
  };

  const isOnCooldown = (type) => {
    const lastTime = lastViolationTimeRef.current[type] || 0;
    return Date.now() - lastTime < (VIOLATION_COOLDOWNS[type] || 3000);
  };

  const markViolationFired = (type) => {
    lastViolationTimeRef.current[type] = Date.now();
  };

  const resetMobileDetectionStreak = () => {
    mobileDetectionStreakRef.current = 0;
    mobileLastDetectionTimeRef.current = 0;
  };

  const getSessionData = () => ({
    tabSwitches: getWarningCount('tab_switch'),
    copyAttempts: getWarningCount('copy_attempt'),
    gazeWarnings: getWarningCount('gaze_away'),
    faceWarnings: getWarningCount('multiple_faces'),
    deviceDetections: getWarningCount('mobile_detected'),
  });

  const captureFrame = () => {
    if (!videoRef.current?.videoWidth || !videoRef.current?.videoHeight) {
      return '';
    }

    const canvas = document.createElement('canvas');
    const targetWidth = Math.min(320, videoRef.current.videoWidth);
    const scale = targetWidth / Math.max(videoRef.current.videoWidth, 1);
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(videoRef.current.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return '';

    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.62);
  };

  const clearWarningTimers = () => {
    if (dismissTimerRef.current) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (warningFlashTimerRef.current) {
      window.clearTimeout(warningFlashTimerRef.current);
      warningFlashTimerRef.current = null;
    }
  };

  const getWarningTiming = (type, deferred = false) => {
    if (type === 'tab_switch') {
      return {
        flashMs: deferred ? 2600 : 2200,
        dismissMs: deferred ? 9000 : 7000,
      };
    }
    return {
      flashMs: 1800,
      dismissMs: 4000,
    };
  };

  const showWarningOverlay = (type, count, confidence, options = {}) => {
    const { deferred = false, detectedObject = '' } = options;
    clearWarningTimers();

    const limit = getWarningLimit(type) || 3;
    const warningLevel = Math.min(3, count);
    const timing = getWarningTiming(type, deferred);
    setWarningBanner({
      type,
      count,
      limit,
      confidence: formatConfidence(confidence),
      description: getViolationDescription(type, detectedObject),
      visualLevel: warningLevel,
      deferred,
    });
    setIsWarningActive(true);

    warningFlashTimerRef.current = window.setTimeout(() => {
      setIsWarningActive(false);
    }, timing.flashMs);

    dismissTimerRef.current = window.setTimeout(() => {
      setWarningBanner(null);
    }, timing.dismissMs);
  };

  const queueWarningOverlay = (type, count, confidence, detectedObject = '') => {
    pendingWarningRef.current = {
      type,
      count,
      confidence,
      detectedObject,
      queuedAt: Date.now(),
    };
  };

  const flushQueuedWarning = () => {
    if (!pendingWarningRef.current) return;
    const queuedWarning = pendingWarningRef.current;
    pendingWarningRef.current = null;
    showWarningOverlay(queuedWarning.type, queuedWarning.count, queuedWarning.confidence, {
      deferred: true,
      detectedObject: queuedWarning.detectedObject,
    });
  };

  const [lockData, setLockData] = useState(null);

  const applyLockedState = useCallback((payload) => {
    isLockedRef.current = true;
    pendingWarningRef.current = null;
    clearWarningTimers();
    setLockData(payload);
    stopDetectionLoop();
    setWarningBanner(null);
    
    // Sync with context
    setLocked({
      lockedUntil: payload.lockedUntil,
      lockReason: payload.lockReason,
      lockCount: payload.lockCount,
    });
    
    onLocked?.(payload);
  }, [setLocked, onLocked]);

  const sendViolation = async ({
    violationType,
    warningNumber,
    confidence,
    detectedObject = '',
  }) => {
    const response = await api.post('/malpractice/report-violation', {
      violationType,
      confidence,
      detectedObject,
      violationImage: captureFrame(),
      sessionType,
      assessmentId,
      topicId,
      warningNumber,
      sessionData: getSessionData(),
    });

    return response.data;
  };

  const emitWarningLocally = (type, warningNumber, confidence, options = {}) => {
    const shouldDeferUntilVisible =
      type === 'tab_switch' && (document.hidden || !document.hasFocus());

    if (shouldDeferUntilVisible) {
      queueWarningOverlay(type, warningNumber, confidence, options.detectedObject);
    } else {
      showWarningOverlay(type, warningNumber, confidence, options);
    }

    onWarning?.({
      type,
      count: warningNumber,
      limit: getWarningLimit(type) || 3,
      confidence: formatConfidence(confidence),
      detectedObject: options.detectedObject || '',
    });
  };

  const CAMERA_VIOLATIONS = new Set(['gaze_away', 'multiple_faces', 'mobile_detected', 'behavioral_anomaly']);

  // Main warning trigger function - uses centralized context
  const triggerWarning = useCallback(async (type, confidence) => {
    // CRITICAL: Always check lock state first
    if (isLockedRef.current) {
      log('triggerWarning: already locked, ignoring');
      return;
    }

    // Cooldown check
    if (isOnCooldown(type)) {
      log('triggerWarning: on cooldown for', type);
      return;
    }

    // Grace period only suppresses camera detections
    if (CAMERA_VIOLATIONS.has(type) && gracePeriodRef.current) {
      log('triggerWarning: grace period active for', type);
      return;
    }

    // Increment warning in centralized context
    incrementWarning(type);
    const warningNumber = getWarningCount(type);

    log('triggerWarning:', type, 'count:', warningNumber, 'limit:', getWarningLimit(type));

    // Mark violation fired for cooldown tracking
    markViolationFired(type);

    // Show warning UI immediately
    emitWarningLocally(type, warningNumber, confidence);

    // Check if this warning count reaches the lock threshold
    const limit = getWarningLimit(type) || 3;
    if (warningNumber >= limit) {
      log('triggerWarning: threshold reached,', type, warningNumber, '>=', limit, '- applying lock');
      
      const lockPayload = {
        isLocked: true,
        lockReason: type,
        warningNumber,
        riskLevel: 'HIGH',
        lockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        timeRemainingMs: 2 * 60 * 60 * 1000,
        timeRemainingFormatted: '2h 0m 0s',
        lockCount: lockCount + 1,
        sessionType,
      };
      
      // Apply lock in context
      setLocked({
        lockedUntil: lockPayload.lockedUntil,
        lockReason: type,
        lockCount: lockCount + 1,
      });
      
      applyLockedState(lockPayload);
      
      // Still send to server for logging
      sendViolation({ violationType: type, warningNumber, confidence }).catch(() => {});
      return;
    }

    // Send to server for logging
    try {
      const payload = await sendViolation({ violationType: type, warningNumber, confidence });
      if (!isMountedRef.current) return;
      if (payload?.isLocked && !payload?.isDuplicate) {
        applyLockedState({ ...payload, lockReason: payload.lockReason || type });
      }
    } catch (error) {
      if (isMountedRef.current) console.error('Failed to report violation:', error);
    }
  }, [incrementWarning, getWarningCount, getWarningLimit, setLocked, applyLockedState, lockCount, sessionType]);

  const trackMobileDetection = (confidence) => {
    const now = Date.now();
    const timeSinceLastDetection = now - mobileLastDetectionTimeRef.current;

    if (timeSinceLastDetection > MOBILE_DETECTION_WINDOW_MS) {
      mobileDetectionStreakRef.current = 1;
    } else {
      mobileDetectionStreakRef.current += 1;
    }

    mobileLastDetectionTimeRef.current = now;
    log('Mobile detection streak:', mobileDetectionStreakRef.current, 'confidence:', confidence);

    return mobileDetectionStreakRef.current >= MOBILE_CONFIRMATION_FRAMES;
  };

  const handleMobileDetection = async (type, detectedObject, confidence, isHighConfidenceCoco = false) => {
    if (isLockedRef.current || isSubmittingRef.current) return;
    if (isOnCooldown(type)) return;

    log('Mobile detection event:', { detectedObject, confidence, isHighConfidenceCoco });

    if (isHighConfidenceCoco) {
      incrementWarning(type);
      const warningNumber = getWarningCount(type);
      isSubmittingRef.current = true;
      markViolationFired(type);
      emitWarningLocally(type, warningNumber, confidence, { detectedObject });
      try {
        const payload = await sendViolation({ violationType: type, warningNumber, confidence, detectedObject });
        if (!isMountedRef.current) return;
        applyLockedState({ ...payload, detectedObject, lockReason: payload.lockReason || type });
      } catch (err) {
        if (isMountedRef.current) console.error('Mobile lock failed:', err);
      } finally {
        if (isMountedRef.current) isSubmittingRef.current = false;
      }
    } else {
      const isConfirmed = trackMobileDetection(confidence);
      if (!isConfirmed) {
        log('Mobile detection not yet confirmed, streak:', mobileDetectionStreakRef.current);
        return;
      }

      resetMobileDetectionStreak();
      await triggerWarning(type, confidence);
    }
  };

  const runDetection = async () => {
    if (gracePeriodRef.current || !faceEnabledRef.current || isLockedRef.current || isSubmittingRef.current) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    try {
      if (faceDetectionModeRef.current === 'faceapi') {
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks(true);

        if (!detections.length) {
          noFaceFramesRef.current += 1;
          lookingAwayFramesRef.current = 0;
          if (noFaceFramesRef.current >= NO_FACE_FRAMES_REQUIRED) {
            noFaceFramesRef.current = 0;
            await triggerWarning('gaze_away', 0.8);
          }
          return;
        }

        noFaceFramesRef.current = 0;

        if (detections.length > 1) {
          lookingAwayFramesRef.current = 0;
          await triggerWarning('multiple_faces', clamp(detections.length * 0.4, 0.72, 0.98));
          return;
        }

        const landmarks = detections[0]?.landmarks;
        const nosePoints = landmarks?.getNose?.() || [];
        if (!nosePoints.length) return;

        const nose = nosePoints[3] || nosePoints[Math.floor(nosePoints.length / 2)];
        const videoCenterX = video.videoWidth / 2;
        const offsetXRatio = Math.abs(Number(nose.x || 0) - videoCenterX) / Math.max(video.videoWidth / 2, 1);

        if (offsetXRatio > 0.45) {
          lookingAwayFramesRef.current += 1;
          if (lookingAwayFramesRef.current >= LOOKING_AWAY_FRAMES_REQUIRED) {
            lookingAwayFramesRef.current = 0;
            await triggerWarning('gaze_away', clamp(offsetXRatio, 0.6, 0.96));
          }
        } else {
          lookingAwayFramesRef.current = 0;
        }
        return;
      }

      if (faceDetectionModeRef.current === 'native' && faceDetectorRef.current) {
        const detectedFaces = await faceDetectorRef.current.detect(video);

        if (!detectedFaces.length) {
          noFaceFramesRef.current += 1;
          lookingAwayFramesRef.current = 0;
          if (noFaceFramesRef.current >= NO_FACE_FRAMES_REQUIRED) {
            noFaceFramesRef.current = 0;
            await triggerWarning('gaze_away', 0.78);
          }
          return;
        }

        noFaceFramesRef.current = 0;

        if (detectedFaces.length > 1) {
          lookingAwayFramesRef.current = 0;
          await triggerWarning('multiple_faces', clamp(detectedFaces.length * 0.34, 0.7, 0.96));
          return;
        }

        const faceBox = detectedFaces[0]?.boundingBox;
        if (!faceBox?.width || !faceBox?.height) return;

        const faceAreaRatio = (Number(faceBox.width || 0) * Number(faceBox.height || 0)) / Math.max(video.videoWidth * video.videoHeight, 1);
        const faceCenterX = Number(faceBox.x || 0) + (Number(faceBox.width || 0) / 2);
        const centerOffset = Math.abs((faceCenterX / Math.max(video.videoWidth, 1)) - 0.5);

        if (faceAreaRatio < 0.05) {
          noFaceFramesRef.current += 1;
          if (noFaceFramesRef.current >= NO_FACE_FRAMES_REQUIRED) {
            noFaceFramesRef.current = 0;
            await triggerWarning('gaze_away', 0.74);
          }
          return;
        }

        if (centerOffset > 0.22) {
          lookingAwayFramesRef.current += 1;
          if (lookingAwayFramesRef.current >= LOOKING_AWAY_FRAMES_REQUIRED) {
            lookingAwayFramesRef.current = 0;
            await triggerWarning('gaze_away', clamp(0.56 + centerOffset, 0.6, 0.95));
          }
        } else {
          lookingAwayFramesRef.current = 0;
        }
        return;
      }

      // Heuristic fallback
      const faceAnalysis = analyzeFaceSample(
        createFrameSample(video, faceCanvasRef, FACE_SAMPLE_WIDTH, FACE_SAMPLE_HEIGHT)
      );

      if (faceAnalysis.detections.multipleFaces) {
        noFaceFramesRef.current = 0;
        lookingAwayFramesRef.current = 0;
        await triggerWarning('multiple_faces', faceAnalysis.confidence);
        return;
      }

      if (faceAnalysis.detections.faceMissing || !faceAnalysis.detections.faceCount) {
        noFaceFramesRef.current += 1;
        lookingAwayFramesRef.current = 0;
        if (noFaceFramesRef.current >= NO_FACE_FRAMES_REQUIRED) {
          noFaceFramesRef.current = 0;
          await triggerWarning('gaze_away', faceAnalysis.confidence);
        }
        return;
      }

      noFaceFramesRef.current = 0;

      if (faceAnalysis.detections.headPoseAway || faceAnalysis.detections.gazeAway) {
        lookingAwayFramesRef.current += 1;
        if (lookingAwayFramesRef.current >= LOOKING_AWAY_FRAMES_REQUIRED) {
          lookingAwayFramesRef.current = 0;
          await triggerWarning('gaze_away', faceAnalysis.confidence);
        }
      } else {
        lookingAwayFramesRef.current = 0;
      }
    } catch (error) {
      // Swallow detection errors silently
    }
  };

  const runDeviceDetection = async () => {
    if (gracePeriodRef.current || !deviceEnabledRef.current || isLockedRef.current || isSubmittingRef.current) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    try {
      if (deviceDetectionModeRef.current === 'coco' && deviceModelRef.current) {
        const predictions = await deviceModelRef.current.detect(video);
        const dangerClasses = ['cell phone', 'laptop', 'tablet', 'remote'];
        const dangerDetected = predictions.find(
          (prediction) => dangerClasses.includes(prediction.class) && prediction.score > 0.55
        );

        if (dangerDetected) {
          const score = Number(dangerDetected.score || 0);
          const isHighConf = score > 0.75;
          await handleMobileDetection('mobile_detected', dangerDetected.class, score, isHighConf);
        }
        return;
      }

      // Heuristic fallback
      const phoneCandidate = analyzePhoneSample(
        createFrameSample(video, deviceCanvasRef, DEVICE_SAMPLE_WIDTH, DEVICE_SAMPLE_HEIGHT)
      );
      if (phoneCandidate) {
        await handleMobileDetection('mobile_detected', phoneCandidate.label, phoneCandidate.confidence, false);
      }
    } catch (error) {
      // Swallow silently
    }
  };

  const startDetectionLoop = () => {
    stopDetectionLoop();
    scheduleFaceDetection(3000);
    scheduleDeviceDetection(8000);
  };

  useEffect(() => {
    isMountedRef.current = true;

    const init = async () => {
      setStatus('loading');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });

        if (!isMountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        startGracePeriod(MOUNT_GRACE_MS);
      } catch (error) {
        if (!isMountedRef.current) return;
        setCameraError(true);
        setStatus('no-camera');
        return;
      }

      try {
        if ('FaceDetector' in window) {
          faceDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
          faceDetectionModeRef.current = 'native';
        } else {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          ]);
          faceDetectionModeRef.current = 'faceapi';
        }
        faceEnabledRef.current = true;
      } catch {
        faceDetectionModeRef.current = 'heuristic';
        faceEnabledRef.current = true;
      }

      try {
        deviceModelRef.current = await cocoSsd.load();
        deviceDetectionModeRef.current = 'coco';
        deviceEnabledRef.current = true;
      } catch {
        deviceDetectionModeRef.current = 'heuristic';
        deviceEnabledRef.current = true;
      }

      if (!isMountedRef.current) return;
      setStatus('active');
      startGracePeriod(MOUNT_GRACE_MS);
      startDetectionLoop();
    };

    init();

    return () => {
      isMountedRef.current = false;
      stopDetectionLoop();
      if (graceTimerRef.current) window.clearTimeout(graceTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
      clearWarningTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paused prop watcher
  useEffect(() => {
    if (isLockedRef.current) return;
    if (paused) {
      stopDetectionLoop();
      noFaceFramesRef.current = 0;
      lookingAwayFramesRef.current = 0;
    } else {
      startGracePeriod(TRANSITION_GRACE_MS);
      if (faceEnabledRef.current || deviceEnabledRef.current) {
        startDetectionLoop();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Tab switch detection - uses centralized context
  useEffect(() => {
    const registerTabSwitch = async () => {
      const now = Date.now();
      if (now - tabThrottleRef.current < 1200) {
        return;
      }

      tabThrottleRef.current = now;
      await triggerWarning('tab_switch', 1);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        registerTabSwitch();
      }
    };

    const handleBlur = () => {
      registerTabSwitch();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy protection
  useEffect(() => {
    const blockCopy = (event) => {
      event.preventDefault();
      triggerWarning('copy_attempt', 1);
    };

    const blockContext = (event) => {
      event.preventDefault();
      triggerWarning('copy_attempt', 1);
    };

    const blockKeys = (event) => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'a', 'x', 'v'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        triggerWarning('copy_attempt', 1);
      }
    };

    document.addEventListener('copy', blockCopy);
    document.addEventListener('contextmenu', blockContext);
    document.addEventListener('keydown', blockKeys);

    return () => {
      document.removeEventListener('copy', blockCopy);
      document.removeEventListener('contextmenu', blockContext);
      document.removeEventListener('keydown', blockKeys);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush queued warnings
  useEffect(() => {
    const tryFlushQueuedWarning = () => {
      if (!document.hidden && document.hasFocus()) {
        flushQueuedWarning();
      }
    };

    const handleVisibilityReturn = () => {
      if (!document.hidden) {
        window.setTimeout(tryFlushQueuedWarning, 120);
      }
    };

    const handleFocus = () => {
      window.setTimeout(tryFlushQueuedWarning, 120);
    };

    document.addEventListener('visibilitychange', handleVisibilityReturn);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityReturn);
      window.removeEventListener('focus', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag handling
  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!draggingRef.current) return;

      setPosition({
        x: clamp(event.clientX - dragOffsetRef.current.x, 8, Math.max(8, window.innerWidth - PREVIEW_WIDTH - 8)),
        y: clamp(event.clientY - dragOffsetRef.current.y, 8, Math.max(8, window.innerHeight - PREVIEW_HEIGHT - 38)),
      });
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (lockData?.isLocked) {
    return <LockScreen lockInfo={lockData} onUnlock={onUnlock} />;
  }

  const statusLabel =
    status === 'active'
      ? 'Monitoring Active'
      : status === 'limited'
      ? 'Partial Monitoring'
      : status === 'browser'
      ? 'Browser Monitoring'
      : status === 'no-camera'
      ? 'Camera Required'
      : 'Loading Monitoring';

  const previewContent = cameraError ? (
    <div className={styles.cameraPlaceholder}>
      <div>Camera Required for Full Monitoring</div>
    </div>
  ) : (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={styles.video}
      style={{ transform: 'scaleX(-1)' }}
    />
  );

  return (
    <>
      {warningBanner ? (
        <div className={`${styles.warningBanner} ${styles[`warning${warningBanner.visualLevel}`]}`}>
          <div className={styles.warningIcon}>!</div>
          <div className={styles.warningBody}>
            <div className={styles.warningText}>
              Warning {warningBanner.count}/{warningBanner.limit}: {warningBanner.description}
            </div>
            <div className={styles.warningSubtext}>
              Confidence: {warningBanner.confidence}%
              {warningBanner.deferred ? ' | Shown after you returned to the test tab.' : ''}
            </div>
            <div className={styles.warningProgress}>
              <div className={styles.warningProgressFill} />
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`${styles.cameraContainer} ${isWarningActive ? styles.warning : ''}`}
        style={{
          left: position.x,
          top: position.y,
          right: 'auto',
        }}
        onMouseDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          draggingRef.current = true;
          dragOffsetRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
        }}
      >
        {previewContent}
        <div className={styles.statusBar}>
          <span
            className={`${styles.statusDot} ${
              isWarningActive ? styles.warning : status === 'loading' ? styles.loading : ''
            }`}
          />
          <span className={styles.statusLabel}>
            {statusLabel}
            {status === 'limited' ? ' | Camera fallback active' : ''}
            {status === 'browser' ? ' | Tab/copy protection only' : ''}
          </span>
        </div>
      </div>
    </>
  );
}