import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  analyzeMonitoringFrame,
  finishMonitoringSession,
  getMonitoringReadiness,
  recordMonitoringEvents,
  reportMonitoringFallbackViolation,
  startMonitoringSession,
} from '../services/monitoringService';
import { analyzeLocalMonitoringFrame } from '../utils/localCameraMonitoring';
import {
  getPracticeMonitoringAnalysisTimings,
  isMonitoringStageReadyToProceed,
  MONITORING_START_TIMEOUT_MS,
  scheduleWarmupActivation,
  waitForAttachedVideoPlayback,
  withTimeout,
} from './usePracticeMonitoring.helpers';

const initialMetrics = {
  tabSwitches: 0,
  copyAttempts: 0,
  windowBlurCount: 0,
};
const FRAME_ANALYSIS_INTERVAL_MS = 5000;
const CLIENT_MONITORING_WARMUP_MS = 7500;
const VIDEO_READY_TIMEOUT_MS = 7000;
const BROWSER_ONLY_LOCK_DURATION_MS = 3 * 60 * 60 * 1000;
const LOCAL_VISION_LOCK_LIMITS = {
  mobile_detected: 2,
  multiple_faces: 3,
  face_missing: 3,
};
const LOCAL_VISION_COOLDOWN_MS = {
  mobile_detected: 15000,
  multiple_faces: 12000,
  face_missing: 5000, // Reduced from 15000 to allow warnings to increment more frequently
};
const initialVisionState = {
  alerts: [],
  detections: null,
  confidence: 0,
  riskLevel: 'NONE',
  evidenceCaptured: false,
  evidenceTrigger: null,
  evidenceCount: 0,
  frameSize: null,
  updatedAt: null,
};
const initialMonitoringReadiness = {
  ready: null,
  fullModelReady: false,
  cameraMonitoringReady: false,
  modelLoaded: false,
  modelFilePresent: false,
  onnxRuntimeAvailable: false,
  imageStackAvailable: false,
  modelSource: 'unknown',
  supportedLabels: [],
  supportsCameraMonitoring: false,
  supportsPhoneDetection: false,
  supportsExtraScreenDetection: false,
  supportsFallbackHeuristics: false,
  limitedDetection: false,
  capability: 'unknown',
  message: '',
};

const buildBrowserOnlySessionState = (overrides = {}) => ({
  monitoringSessionId: null,
  warningCount: 0,
  warningLimit: 3,
  finalFlagged: false,
  riskLevel: 'NONE',
  riskScore: 0,
  signals: [],
  finalStatus: 'clean',
  isLocked: false,
  lockedUntil: null,
  lockReason: '',
  lockCount: 0,
  ...overrides,
});

const getMonitoringErrorMessage = (error) =>
  error?.name === 'NotAllowedError'
    ? 'Camera permission was denied. Continuing with browser-only monitoring.'
    : error?.response?.data?.message
      || error?.message
      || 'Unable to start camera monitoring.';

const shouldFallbackToBrowserOnly = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  const message = getMonitoringErrorMessage(error).toLowerCase();

  return (
    !error?.response
    || [404, 502, 503, 504].includes(statusCode)
    || ['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'NotAllowedError'].includes(error?.name)
    || message.includes('route not found')
    || message.includes('unavailable')
    || message.includes('unreachable')
  );
};

const getBrowserOnlySignal = (eventType) => {
  if (eventType === 'copyAttempts') return 'COPY_ATTEMPT';
  if (eventType === 'tabSwitches') return 'TAB_SWITCH';
  if (eventType === 'windowBlurCount') return 'WINDOW_BLUR';
  return 'BROWSER_WARNING';
};

const getBrowserOnlyViolationType = (eventType) => {
  if (eventType === 'copyAttempts') return 'copy_attempt';
  if (eventType === 'tabSwitches') return 'tab_switch';
  if (eventType === 'windowBlurCount') return 'behavioral_anomaly';
  return '';
};

const getBrowserOnlyWarningLimit = () => 3;

const getBrowserOnlyLockReason = (eventType) => {
  if (eventType === 'copyAttempts') return 'copy_attempt';
  if (eventType === 'tabSwitches') return 'tab_switch';
  if (eventType === 'windowBlurCount') return 'behavioral_anomaly';
  return 'behavioral_anomaly';
};

const getBrowserOnlyRiskLevel = (eventType, warningCount, warningLimit) => {
  if (warningCount >= warningLimit) return 'HIGH';
  if (eventType === 'copyAttempts') return 'MEDIUM';
  return 'LOW';
};

const getLocalVisionSignal = (violationType) => {
  if (violationType === 'mobile_detected') return 'PHONE_VISIBLE';
  if (violationType === 'multiple_faces') return 'MULTIPLE_FACES';
  if (violationType === 'face_missing') return 'FACE_MISSING';
  return 'BROWSER_WARNING';
};

const playBeepSound = () => {
  try {
    console.log('[Monitoring] Playing beep sound');
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800; // 800Hz beep
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
    console.log('[Monitoring] Beep sound played successfully');
  } catch (error) {
    console.error('[Monitoring] Failed to play beep sound:', error);
  }
};

const getLocalVisionLockLimit = (violationType) => LOCAL_VISION_LOCK_LIMITS[violationType] || 3;

const getLocalVisionCooldown = (violationType) => LOCAL_VISION_COOLDOWN_MS[violationType] || 12000;

const buildBrowserEventPayload = (eventType) => {
  if (eventType === 'copyAttempts') {
    return {
      source: 'browser',
      type: 'copy_attempt',
      riskLevel: 'MEDIUM',
      message: 'Copy or selection activity was blocked during the monitored session.',
    };
  }

  if (eventType === 'tabSwitches') {
    return {
      source: 'browser',
      type: 'tab_switch',
      riskLevel: 'MEDIUM',
      message: 'Tab switching was detected during the monitored session.',
    };
  }

  if (eventType === 'windowBlurCount') {
    return {
      source: 'browser',
      type: 'window_blur',
      riskLevel: 'MEDIUM',
      message: 'Window focus was lost during the monitored session.',
    };
  }

  return null;
};

const isCompactViewport = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
};

const waitForStreamPlayback = (mediaStream) => new Promise((resolve, reject) => {
  const hasLiveTrack = typeof mediaStream?.getTracks === 'function'
    ? mediaStream.getTracks().some((track) => track?.readyState !== 'ended')
    : true;

  if (mediaStream && mediaStream.active !== false && hasLiveTrack) {
    resolve();
    return;
  }

  reject(new Error('Camera preview could not be initialized. Please try again.'));
});

export default function usePracticeMonitoring({
  sessionType,
  topicId,
  moduleId,
  problemId,
  autoStart = false,
  allowBrowserOnlyFallback = true,
  analysisEnabled = true,
  mode = 'full',
  institutionLinked = false,
  sessionLabel = 'practice session',
  onStatusChange,
}) {
  const captureVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameTimerRef = useRef(null);
  const frameKickoffTimerRef = useRef(null);
  const warmupTimerRef = useRef(null);
  const eventFlushTimerRef = useRef(null);
  const analysisResumeTimerRef = useRef(null);
  const frameAnalysisInFlightRef = useRef(false);
  const pendingStartPromiseRef = useRef(null);
  const beginSessionPromiseRef = useRef(null);
  const pendingStartResolveRef = useRef(null);
  const readyWaitersRef = useRef([]);
  const pendingBrowserEventsRef = useRef([]);
  const sessionIdRef = useRef(null);
  const startedAutoRef = useRef(false);
  const latestBrowserMetricsRef = useRef(initialMetrics);
  const latestErrorRef = useRef('');
  const finishingRef = useRef(false);
  const browserOnlyWarningRef = useRef(0);
  const localVisionWarningCountsRef = useRef({
    mobile_detected: 0,
    multiple_faces: 0,
    face_missing: 0,
  });
  const localVisionLastReportAtRef = useRef({
    mobile_detected: 0,
    multiple_faces: 0,
    face_missing: 0,
  });
  const toastShowingRef = useRef({
    mobile_detected: false,
    multiple_faces: false,
    face_missing: false,
  });
  const startAttemptRef = useRef(0);
  const [runtimeMode, setRuntimeMode] = useState(mode);
  const isBrowserOnly = runtimeMode === 'browser-only';

  const [showConsent, setShowConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [stream, setStream] = useState(null);
  const [browserMetrics, setBrowserMetrics] = useState(initialMetrics);
  const [visionState, setVisionState] = useState(initialVisionState);
  const [sessionState, setSessionState] = useState(
    isBrowserOnly
      ? buildBrowserOnlySessionState()
      : null
  );
  const [permissionState, setPermissionState] = useState('idle');
  const [browserOnlyStarted, setBrowserOnlyStarted] = useState(isBrowserOnly ? autoStart : false);
  const [isMobile, setIsMobile] = useState(isCompactViewport);
  const [monitoringStage, setMonitoringStage] = useState(isBrowserOnly && autoStart ? 'active' : 'idle');
  const [monitoringReadiness, setMonitoringReadiness] = useState(initialMonitoringReadiness);
  const monitoringAnalysisTimings = useMemo(
    () => getPracticeMonitoringAnalysisTimings(sessionType),
    [sessionType]
  );

  const warningLimit = sessionState?.warningLimit || 3;
  const sessionId = sessionState?.monitoringSessionId || null;
  const browserEventTrackingActive = isBrowserOnly
    ? browserOnlyStarted
    : Boolean(sessionId) && monitoringStage !== 'finished';
  const isMonitoring = isBrowserOnly
    ? browserOnlyStarted
    : (!!sessionId && !!stream && isMonitoringStageReadyToProceed(monitoringStage));
  const isMonitoringReady = isMonitoring
    || (!!sessionId && !!stream && monitoringStage === 'warming_up');

  const resetRuntimeState = useCallback(() => {
    latestBrowserMetricsRef.current = initialMetrics;
    pendingBrowserEventsRef.current = [];
    setBrowserMetrics(initialMetrics);
    setVisionState(initialVisionState);
    browserOnlyWarningRef.current = 0;
  }, []);

  const updateErrorState = useCallback((message = '') => {
    latestErrorRef.current = message;
    setError(message);
  }, []);

  const resolveReadyWaiters = useCallback((value) => {
    if (!readyWaitersRef.current.length) return;

    const waiters = readyWaitersRef.current.splice(0);
    waiters.forEach(({ resolve, timeoutId }) => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      resolve(value);
    });
  }, []);

  const cleanupMedia = useCallback(() => {
    if (frameTimerRef.current) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }

    if (frameKickoffTimerRef.current) {
      window.clearTimeout(frameKickoffTimerRef.current);
      frameKickoffTimerRef.current = null;
    }

    if (warmupTimerRef.current) {
      window.clearTimeout(warmupTimerRef.current);
      warmupTimerRef.current = null;
    }

    if (eventFlushTimerRef.current) {
      window.clearTimeout(eventFlushTimerRef.current);
      eventFlushTimerRef.current = null;
    }

    if (analysisResumeTimerRef.current) {
      window.clearTimeout(analysisResumeTimerRef.current);
      analysisResumeTimerRef.current = null;
    }

    frameAnalysisInFlightRef.current = false;

    setStream((current) => {
      current?.getTracks?.().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const resolvePendingStart = useCallback((value) => {
    if (pendingStartResolveRef.current) {
      pendingStartResolveRef.current(value);
      pendingStartResolveRef.current = null;
    }
    pendingStartPromiseRef.current = null;
  }, []);

  const updateSessionState = useCallback((nextState) => {
    sessionIdRef.current = nextState?.monitoringSessionId || null;
    setSessionState((current) => {
      const previousWarnings = current?.warningCount || 0;
      const previousFinalFlagged = !!current?.finalFlagged;
      const previousLocked = !!current?.isLocked;
      if (
        nextState &&
        (
          (nextState.warningCount || 0) > previousWarnings ||
          (!!nextState.finalFlagged && !previousFinalFlagged) ||
          (!!nextState.isLocked && !previousLocked)
        )
      ) {
        onStatusChange?.(nextState);
      }
      // Merge warnings array from backend response
      const mergedState = {
        ...current,
        ...nextState,
        warnings: Array.isArray(nextState?.warnings) ? nextState.warnings : (current?.warnings || []),
      };
      console.log('[updateSessionState] Updated sessionState with warnings:', mergedState.warnings);
      return mergedState;
    });
  }, [onStatusChange]);

  const waitForMonitoringReady = useCallback((timeoutMs = MONITORING_START_TIMEOUT_MS) => {
    if (isMonitoringReady) {
      return Promise.resolve(sessionState || true);
    }

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        readyWaitersRef.current = readyWaitersRef.current.filter((waiter) => waiter.timeoutId !== timeoutId);
        resolve(false);
      }, timeoutMs);

      readyWaitersRef.current.push({ resolve, timeoutId });
    });
  }, [isMonitoringReady, sessionState]);

  const activateBrowserOnlyFallback = useCallback(async (message, options = {}) => {
    const { startCamera = false } = options;
    const nextState = buildBrowserOnlySessionState();

    cleanupMedia();
    resetRuntimeState();
    setRuntimeMode('browser-only');
    setPermissionState(startCamera ? 'idle' : 'fallback');
    setMonitoringStage(startCamera ? 'requesting_camera' : 'active');
    setMonitoringReadiness((current) => ({
      ...initialMonitoringReadiness,
      ...current,
      ready: false,
      cameraMonitoringReady: Boolean(startCamera || current.cameraMonitoringReady),
      supportsCameraMonitoring: Boolean(startCamera || current.supportsCameraMonitoring),
      supportsFallbackHeuristics: true,
      limitedDetection: true,
      capability: 'limited',
      message: message || current.message || 'Live camera monitoring is unavailable right now.',
    }));
    updateSessionState(nextState);
    setBrowserOnlyStarted(true);
    updateErrorState('');

    if (!startCamera || !navigator.mediaDevices?.getUserMedia) {
      resolveReadyWaiters(nextState);
      resolvePendingStart(nextState);
      return nextState;
    }

    let mediaStream = null;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      setPermissionState('granted');
      setMonitoringStage('awaiting_video');
      await waitForStreamPlayback(mediaStream);

      if (mediaStream) {
        setStream(mediaStream);
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        await waitForCaptureVideoElement({ timeoutMs: VIDEO_READY_TIMEOUT_MS });
        await waitForAttachedVideoPlayback({
          getVideo: () => captureVideoRef.current,
          mediaStream,
          timeoutMs: VIDEO_READY_TIMEOUT_MS,
        });
      }
    } catch (cameraError) {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      setPermissionState(cameraError?.name === 'NotAllowedError' ? 'denied' : 'fallback');
    } finally {
      setMonitoringStage('active');
      resolveReadyWaiters(nextState);
      resolvePendingStart(nextState);
    }

    return nextState;
  }, [
    cleanupMedia,
    resetRuntimeState,
    resolvePendingStart,
    resolveReadyWaiters,
    updateErrorState,
    updateSessionState,
  ]);

  const syncBrowserOnlyViolation = useCallback(async (
    eventType,
    nextMetrics,
    nextWarningCount,
    nextWarningLimit
  ) => {
    if (!isBrowserOnly || !browserOnlyStarted) return;

    const violationType = getBrowserOnlyViolationType(eventType);
    if (!violationType) return;

    try {
      const response = await reportMonitoringFallbackViolation({
        violationType,
        confidence: eventType === 'copyAttempts' ? 0.92 : 0.74,
        sessionType,
        topicId,
        warningNumber: nextWarningCount,
        sessionData: nextMetrics,
      });

      updateSessionState(buildBrowserOnlySessionState({
        warningCount: nextWarningCount,
        warningLimit: nextWarningLimit,
        finalFlagged: !!response?.isLocked,
        riskLevel: response?.riskLevel || getBrowserOnlyRiskLevel(eventType, nextWarningCount, nextWarningLimit),
        riskScore: 0,
        signals: [getBrowserOnlySignal(eventType)],
        finalStatus: response?.isLocked ? 'flagged' : 'warned',
        isLocked: !!response?.isLocked,
        lockedUntil: response?.lockedUntil || null,
        lockReason: response?.lockReason || '',
        lockCount: Number(response?.lockCount || 0),
      }));
    } catch (_fallbackSyncError) {
      // Browser-only fallback should still work locally even if server logging fails.
    }
  }, [browserOnlyStarted, isBrowserOnly, sessionType, topicId, updateSessionState]);

  const syncLocalVisionViolation = useCallback(async (analysis = {}) => {
    if (!isBrowserOnly || !browserOnlyStarted) return;

    const violationType = analysis?.primaryViolationType;
    if (!violationType) return;

    const cooldownMs = getLocalVisionCooldown(violationType);
    const lastReportedAt = localVisionLastReportAtRef.current[violationType] || 0;
    if (Date.now() - lastReportedAt < cooldownMs) {
      return;
    }

    localVisionLastReportAtRef.current[violationType] = Date.now();

    const nextWarningCount = (localVisionWarningCountsRef.current[violationType] || 0) + 1;
    localVisionWarningCountsRef.current[violationType] = nextWarningCount;

    const warningLimit = getLocalVisionLockLimit(violationType);
    const signal = getLocalVisionSignal(violationType);
    const confidence = Number(analysis?.confidence || 0);
    const fallbackRiskLevel = analysis?.riskLevel
      || (nextWarningCount >= warningLimit
        ? 'HIGH'
        : nextWarningCount >= 2
          ? 'MEDIUM'
          : 'LOW');
    const warningMessage = Array.isArray(analysis?.alerts) && analysis.alerts[0]?.message
      ? String(analysis.alerts[0].message)
      : violationType === 'mobile_detected'
        ? 'Phone detected in the camera frame.'
        : violationType === 'multiple_faces'
          ? 'Multiple faces detected in the camera frame.'
          : 'Face missing from the camera frame.';
    const locallyLocked = nextWarningCount >= warningLimit;

    // Play beep sound and show toast for face_missing and mobile_detected
    if (violationType === 'face_missing' || violationType === 'mobile_detected') {
      console.log('[Monitoring] Triggering beep and toast for:', violationType, 'warning:', nextWarningCount, '/', warningLimit);
      playBeepSound();
      // Only show toast if not already showing for this violation type
      if (!toastShowingRef.current[violationType]) {
        toastShowingRef.current[violationType] = true;
        // Use setTimeout to avoid React render cycle error
        setTimeout(() => {
          toast.error(`${warningMessage} Warning ${nextWarningCount}/${warningLimit}`, {
            duration: 5000,
            id: `violation-${violationType}`,
            onClose: () => {
              toastShowingRef.current[violationType] = false;
            },
          });
        }, 0);
        // Reset flag after duration as backup
        setTimeout(() => {
          toastShowingRef.current[violationType] = false;
        }, 5000);
      }
    }

    try {
      const response = await reportMonitoringFallbackViolation({
        violationType,
        confidence: confidence || (violationType === 'mobile_detected' ? 0.88 : 0.72),
        detectedObject: analysis?.detectedObject || '',
        violationImage: analysis?.violationImage || '',
        sessionType,
        topicId,
        warningNumber: nextWarningCount,
        sessionData: {
          ...latestBrowserMetricsRef.current,
          localVisionWarningCount: nextWarningCount,
          localVisionWarningType: violationType,
        },
      });

      updateSessionState(buildBrowserOnlySessionState({
        warningCount: nextWarningCount,
        warningLimit,
        finalFlagged: !!response?.isLocked,
        riskLevel: response?.riskLevel || fallbackRiskLevel,
        riskScore: confidence,
        signals: [signal],
        warnings: [{
          message: warningMessage,
          signals: [signal],
          confidence,
        }],
        alerts: [{
          type: violationType,
          message: warningMessage,
          confidence,
        }],
        finalStatus: response?.isLocked ? 'flagged' : 'warned',
        isLocked: !!response?.isLocked,
        lockedUntil: response?.lockedUntil || null,
        lockReason: response?.lockReason || violationType,
        lockCount: Number(response?.lockCount || 0),
      }));
    } catch (_error) {
      updateSessionState(buildBrowserOnlySessionState({
        warningCount: nextWarningCount,
        warningLimit,
        finalFlagged: locallyLocked,
        riskLevel: fallbackRiskLevel,
        riskScore: confidence,
        signals: [signal],
        warnings: [{
          message: warningMessage,
          signals: [signal],
          confidence,
        }],
        alerts: [{
          type: violationType,
          message: warningMessage,
          confidence,
        }],
        finalStatus: locallyLocked ? 'flagged' : 'warned',
        isLocked: locallyLocked,
        lockedUntil: locallyLocked ? new Date(Date.now() + BROWSER_ONLY_LOCK_DURATION_MS).toISOString() : null,
        lockReason: violationType,
        lockCount: locallyLocked ? nextWarningCount : 0,
      }));
    }
  }, [browserOnlyStarted, isBrowserOnly, sessionType, topicId, updateSessionState]);

  const openConsent = useCallback(() => {
    updateErrorState('');
    if (pendingStartPromiseRef.current) {
      setShowConsent(true);
      return pendingStartPromiseRef.current;
    }

    pendingStartPromiseRef.current = new Promise((resolve) => {
      pendingStartResolveRef.current = resolve;
      setShowConsent(true);
    });

    return pendingStartPromiseRef.current;
  }, [updateErrorState]);

  const startSampling = useCallback(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    const applyVisionState = (nextState = {}) => {
      const nextDetections = nextState?.detections
        ? {
          ...nextState.detections,
          faceBoxes: Array.isArray(nextState?.faceBoxes) ? nextState.faceBoxes : (nextState?.detections?.faceBoxes || []),
          phoneBoxes: Array.isArray(nextState?.phoneBoxes) ? nextState.phoneBoxes : (nextState?.detections?.phoneBoxes || []),
          annotations: Array.isArray(nextState?.annotations) ? nextState.annotations : (nextState?.detections?.annotations || []),
        }
        : null;

      setVisionState({
        alerts: Array.isArray(nextState?.alerts) ? nextState.alerts : [],
        detections: nextDetections,
        confidence: Number(nextState?.confidence || 0),
        riskLevel: nextState?.riskLevel || 'NONE',
        evidenceCaptured: !!nextState?.evidenceCaptured,
        evidenceTrigger: nextState?.evidenceTrigger || null,
        evidenceCount: Number(nextState?.evidenceCount || 0),
        frameSize: nextState?.frameSize || null,
        updatedAt: Date.now(),
      });
    };

    const runLocalAnalysis = async () => {
      const localAnalysis = await analyzeLocalMonitoringFrame(captureVideoRef.current);
      if (!localAnalysis) return false;

      applyVisionState({
        ...localAnalysis,
        detections: localAnalysis?.detections || null,
        faceBoxes: localAnalysis?.faceBoxes || [],
        phoneBoxes: localAnalysis?.phoneBoxes || [],
        annotations: localAnalysis?.annotations || [],
      });

      await syncLocalVisionViolation(localAnalysis);
      return true;
    };

    const sampleFrame = async () => {
      if (frameAnalysisInFlightRef.current) return;
      if (!analysisEnabled || !captureVideoRef.current || document.hidden) return;
      if (captureVideoRef.current.readyState < 2) return;

      frameAnalysisInFlightRef.current = true;
      try {
        // Always run local analysis for face/phone detection since server doesn't have full model
        const localAnalysisSuccess = await runLocalAnalysis();
        
        if (!isBrowserOnly && sessionId) {
          const imageData = (() => {
            const sourceWidth = captureVideoRef.current.videoWidth || 320;
            const sourceHeight = captureVideoRef.current.videoHeight || 240;
            const maxWidth = 640;
            const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            canvasRef.current.width = width;
            canvasRef.current.height = height;
            const context = canvasRef.current.getContext('2d', { willReadFrequently: true });
            if (!context) return '';
            context.drawImage(captureVideoRef.current, 0, 0, width, height);
            return canvasRef.current.toDataURL('image/jpeg', 0.62);
          })();

          if (!imageData) return;

          console.log('[Monitoring] Analyzing frame, isBrowserOnly:', isBrowserOnly, 'sessionId:', sessionId);
          const nextState = await analyzeMonitoringFrame(sessionId, {
            imageData,
            metadata: {
              width: captureVideoRef.current.videoWidth || 320,
              height: captureVideoRef.current.videoHeight || 240,
              deviceType: isMobile ? 'mobile' : 'desktop',
            },
          });
          console.log('[Monitoring] Frame analysis result:', nextState?.detections, nextState?.alerts, nextState?.riskLevel);

          // Apply server-side results for phone detection (uses trained YOLO model)
          // Keep local analysis for face detection
          if (nextState?.detections) {
            applyVisionState(nextState || {});
            updateSessionState(nextState);
            
            // Play beep and show toast for face_missing and mobile_detected from server
            if (nextState.detections.faceMissing || nextState.detections.phoneVisible) {
              const violationType = nextState.detections.phoneVisible ? 'mobile_detected' : 'face_missing';
              const warningMessage = nextState.detections.phoneVisible 
                ? 'Phone detected in the camera frame.' 
                : 'Face missing from the camera frame.';
              const warningCount = nextState.warningCount || 0;
              const warningLimit = nextState.warningLimit || 3;
              
              console.log('[Monitoring] Server-side detection:', violationType, 'warning:', warningCount, '/', warningLimit);
              
              // Check if we should play beep and show toast (based on cooldown)
              const lastReportedAt = localVisionLastReportAtRef.current[violationType] || 0;
              const cooldownMs = getLocalVisionCooldown(violationType);
              if (Date.now() - lastReportedAt >= cooldownMs) {
                localVisionLastReportAtRef.current[violationType] = Date.now();
                console.log('[Monitoring] Triggering server-side beep and toast for:', violationType);
                playBeepSound();
                // Only show toast if not already showing for this violation type
                if (!toastShowingRef.current[violationType]) {
                  toastShowingRef.current[violationType] = true;
                  // Use setTimeout to avoid React render cycle error
                  setTimeout(() => {
                    toast.error(`${warningMessage} Warning ${warningCount}/${warningLimit}`, {
                      duration: 5000,
                      id: `violation-${violationType}`,
                      onClose: () => {
                        toastShowingRef.current[violationType] = false;
                      },
                    });
                  }, 0);
                  // Reset flag after duration as backup
                  setTimeout(() => {
                    toastShowingRef.current[violationType] = false;
                  }, 5000);
                }
              } else {
                console.log('[Monitoring] Cooldown active for:', violationType, 'time remaining:', cooldownMs - (Date.now() - lastReportedAt));
              }
            }
          } else {
            console.log('[Monitoring] Server has no detections, keeping local analysis results');
          }
        }
      } catch (_frameError) {
        console.error('[Monitoring] Frame analysis error:', _frameError);
        if (!isBrowserOnly && sessionId) {
          try {
            await runLocalAnalysis();
          } catch (localFrameError) {
            console.error('[Monitoring] Local frame fallback error:', localFrameError);
          }
        }
      } finally {
        frameAnalysisInFlightRef.current = false;
      }
    };

    if (frameTimerRef.current) {
      window.clearInterval(frameTimerRef.current);
    }

    if (frameKickoffTimerRef.current) {
      window.clearTimeout(frameKickoffTimerRef.current);
    }

    frameKickoffTimerRef.current = window.setTimeout(() => {
      sampleFrame();
    }, monitoringAnalysisTimings.frameKickoffDelayMs);

    frameTimerRef.current = window.setInterval(sampleFrame, FRAME_ANALYSIS_INTERVAL_MS);
  }, [
    analysisEnabled,
    isBrowserOnly,
    isMobile,
    monitoringAnalysisTimings.frameKickoffDelayMs,
    sessionId,
    syncLocalVisionViolation,
    updateSessionState,
  ]);

  const beginSession = useCallback(async () => {
    if (beginSessionPromiseRef.current) {
      return beginSessionPromiseRef.current;
    }

    const startPromise = (async () => {
      if (isBrowserOnly) {
        const nextState = buildBrowserOnlySessionState();
        resetRuntimeState();
        setPermissionState('granted');
        setMonitoringStage('active');
        updateSessionState(nextState);
        setBrowserOnlyStarted(true);
        resolvePendingStart(nextState);
        setShowConsent(false);
        return nextState;
      }

      const attemptId = startAttemptRef.current + 1;
      startAttemptRef.current = attemptId;
      setStarting(true);
      updateErrorState('');
      setPermissionState('idle');
      setMonitoringStage('checking_readiness');

      try {
        return await withTimeout(async () => {
          let readiness;
          try {
            console.log('[Monitoring] Checking monitoring readiness...');
            readiness = await getMonitoringReadiness(sessionType);
            console.log('[Monitoring] Readiness check result:', readiness);
          } catch (readinessError) {
            console.log('[Monitoring] Readiness check failed, will attempt fallback:', readinessError);
            // If readiness check fails, treat it as not ready and allow fallback
            readiness = { ready: false, message: 'Live proctor monitoring service is unreachable.' };
          }
          setMonitoringReadiness(readiness || initialMonitoringReadiness);
          
          console.log('[Monitoring] allowBrowserOnlyFallback:', allowBrowserOnlyFallback, 'readiness?.ready:', readiness?.ready);
          
          // If readiness is not ready and browser-only fallback is allowed, trigger fallback immediately
          if (!readiness?.ready && allowBrowserOnlyFallback) {
            console.log('[Monitoring] Readiness not ready, triggering browser-only fallback');
            throw new Error(readiness?.message || 'Live camera monitoring is unavailable right now.');
          }
          
          if (!readiness?.ready) {
            throw new Error(readiness?.message || 'Live camera monitoring is unavailable right now.');
          }

          if (attemptId !== startAttemptRef.current) {
            return false;
          }

          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('This browser does not support webcam access for monitored sessions.');
          }

          setMonitoringStage('requesting_camera');
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: false,
          });

          if (attemptId !== startAttemptRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return false;
          }

          setPermissionState('granted');
          setMonitoringStage('awaiting_video');
          await waitForStreamPlayback(mediaStream);

          if (attemptId !== startAttemptRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return false;
          }

          setStream(mediaStream);
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
          console.log('[Monitoring] Stream set, waiting for capture video element...');
          await waitForCaptureVideoElement({ timeoutMs: VIDEO_READY_TIMEOUT_MS });
          console.log('[Monitoring] Capture video element ready, waiting for video playback...');
          await waitForAttachedVideoPlayback({
            getVideo: () => captureVideoRef.current,
            mediaStream,
            timeoutMs: VIDEO_READY_TIMEOUT_MS,
          });
          console.log('[Monitoring] Video playback ready, starting monitoring session...');

          if (attemptId !== startAttemptRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return false;
          }

          setMonitoringStage('starting_session');

          const nextSession = await startMonitoringSession({
            sessionType,
            topicId,
            moduleId,
            problemId,
            deviceType: isCompactViewport() ? 'mobile' : 'desktop',
            previewEnabled: true,
          });

          if (attemptId !== startAttemptRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return false;
          }

          resetRuntimeState();
          updateSessionState(nextSession);
          setMonitoringStage('warming_up');
          await waitForWarmupActivation({
            attemptId,
            mediaStream,
            onActivate: () => setMonitoringStage('active'),
          });
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          resolvePendingStart(nextSession);
          return nextSession;
        }, MONITORING_START_TIMEOUT_MS, 'Starting the monitored session is taking longer than expected. Please try again.', {
          onTimeout: () => {
            startAttemptRef.current += 1;
          },
        });
      } catch (startError) {
        if (startError?.response?.data?.data) {
          setMonitoringReadiness({
            ...initialMonitoringReadiness,
            ...startError.response.data.data,
          });
        }

        const message = getMonitoringErrorMessage(startError);

        if (allowBrowserOnlyFallback && shouldFallbackToBrowserOnly(startError)) {
          return activateBrowserOnlyFallback(message, {
            startCamera: startError?.name !== 'NotAllowedError',
          });
        }

        setPermissionState(startError?.name === 'NotAllowedError' ? 'denied' : 'error');
        setMonitoringStage(message.toLowerCase().includes('unavailable') ? 'unavailable' : 'error');
        updateErrorState(message);
        cleanupMedia();
        resolveReadyWaiters(false);
        resolvePendingStart(false);
        return false;
      } finally {
        setStarting(false);
        setShowConsent(false);
        beginSessionPromiseRef.current = null;
      }
    })();

    beginSessionPromiseRef.current = startPromise;
    return startPromise;
  }, [
    allowBrowserOnlyFallback,
    cleanupMedia,
    activateBrowserOnlyFallback,
    isBrowserOnly,
    moduleId,
    problemId,
    resetRuntimeState,
    resolvePendingStart,
    resolveReadyWaiters,
    sessionType,
    topicId,
    updateSessionState,
    updateErrorState,
  ]);

  const startMonitoring = useCallback(async () => {
    if (isMonitoring || isMonitoringStageReadyToProceed(monitoringStage)) {
      return sessionState || true;
    }
    return openConsent();
  }, [isMonitoring, monitoringStage, openConsent, sessionState]);

  const finishMonitoring = useCallback(async (payload = {}, options = {}) => {
    if (isBrowserOnly) {
      cleanupMedia();
      setMonitoringStage('finished');
      resolveReadyWaiters(false);
      return;
    }

    if (!sessionId || finishingRef.current) {
      cleanupMedia();
      setMonitoringStage('finished');
      resolveReadyWaiters(false);
      return;
    }

    const pendingEvents = pendingBrowserEventsRef.current.splice(0);
    finishingRef.current = true;
    try {
      const nextState = await finishMonitoringSession(
        sessionId,
        {
          browserMetrics: latestBrowserMetricsRef.current,
          events: pendingEvents,
          ...payload,
        },
        options
      );
      updateSessionState(nextState);
    } catch (_finishError) {
      if (pendingEvents.length > 0) {
        pendingBrowserEventsRef.current = [
          ...pendingEvents,
          ...pendingBrowserEventsRef.current,
        ];
      }
      // Best effort finish for unload/unmount.
    } finally {
      finishingRef.current = false;
      cleanupMedia();
      setMonitoringStage('finished');
      resolveReadyWaiters(false);
    }
  }, [cleanupMedia, isBrowserOnly, resolveReadyWaiters, sessionId, updateSessionState]);

  const trackBrowserEvent = useCallback((eventType) => {
    let nextMetricsSnapshot = initialMetrics;

    setBrowserMetrics((current) => {
      const next = {
        ...current,
        tabSwitches: current.tabSwitches + (eventType === 'tabSwitches' ? 1 : 0),
        copyAttempts: current.copyAttempts + (eventType === 'copyAttempts' ? 1 : 0),
        windowBlurCount: current.windowBlurCount + (eventType === 'windowBlurCount' ? 1 : 0),
      };
      nextMetricsSnapshot = next;
      latestBrowserMetricsRef.current = next;
      return next;
    });

    if (!isBrowserOnly && sessionId) {
      const browserEvent = buildBrowserEventPayload(eventType);
      if (browserEvent) {
        pendingBrowserEventsRef.current = [
          ...pendingBrowserEventsRef.current,
          browserEvent,
        ];
      }
    }

    if (!isBrowserOnly || !browserOnlyStarted) return;

    if (eventType === 'tabSwitches' || eventType === 'windowBlurCount' || eventType === 'copyAttempts') {
      const nextWarningCount = eventType === 'copyAttempts'
        ? nextMetricsSnapshot.copyAttempts
        : eventType === 'tabSwitches'
          ? nextMetricsSnapshot.tabSwitches
          : nextMetricsSnapshot.windowBlurCount;
      const nextWarningLimit = getBrowserOnlyWarningLimit(eventType);
      const locallyLocked = nextWarningCount >= nextWarningLimit;

      browserOnlyWarningRef.current = nextWarningCount;

      updateSessionState(buildBrowserOnlySessionState({
        warningCount: nextWarningCount,
        warningLimit: nextWarningLimit,
        finalFlagged: locallyLocked,
        riskLevel: getBrowserOnlyRiskLevel(eventType, nextWarningCount, nextWarningLimit),
        riskScore: 0,
        signals: [getBrowserOnlySignal(eventType)],
        finalStatus: locallyLocked ? 'flagged' : 'warned',
        isLocked: locallyLocked,
        lockedUntil: locallyLocked
          ? new Date(Date.now() + BROWSER_ONLY_LOCK_DURATION_MS).toISOString()
          : null,
        lockReason: locallyLocked ? getBrowserOnlyLockReason(eventType) : '',
        lockCount: locallyLocked ? 1 : 0,
      }));

      syncBrowserOnlyViolation(
        eventType,
        nextMetricsSnapshot,
        nextWarningCount,
        nextWarningLimit
      );
    }
  }, [browserOnlyStarted, isBrowserOnly, sessionId, syncBrowserOnlyViolation, updateSessionState]);

  useEffect(() => {
    if (!isMonitoringReady) return;
    resolveReadyWaiters(sessionState || true);
  }, [isMonitoringReady, resolveReadyWaiters, sessionState]);

  useEffect(() => {
    const onResize = () => setIsMobile(isCompactViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (isBrowserOnly || !sessionId || monitoringStage === 'finished') return undefined;
    if (eventFlushTimerRef.current) {
      window.clearTimeout(eventFlushTimerRef.current);
    }

    eventFlushTimerRef.current = window.setTimeout(async () => {
      const pendingEvents = pendingBrowserEventsRef.current.splice(0);

      try {
        const nextState = await recordMonitoringEvents(sessionId, {
          browserMetrics: latestBrowserMetricsRef.current,
          events: pendingEvents,
        });
        updateSessionState(nextState);
      } catch (_eventError) {
        if (pendingEvents.length > 0) {
          pendingBrowserEventsRef.current = [
            ...pendingEvents,
            ...pendingBrowserEventsRef.current,
          ];
        }
        // Ignore transient sync issues; metrics will be retried on the next flush or finish.
      }
    }, 600);

    return () => {
      if (eventFlushTimerRef.current) {
        window.clearTimeout(eventFlushTimerRef.current);
        eventFlushTimerRef.current = null;
      }
    };
  }, [browserMetrics, isBrowserOnly, monitoringStage, sessionId, updateSessionState]);

  useEffect(() => {
    if (isBrowserOnly || (monitoringStage !== 'active' && monitoringStage !== 'warming_up') || !sessionId || !stream || !analysisEnabled) {
      return undefined;
    }

    if (monitoringStage === 'warming_up') {
      return undefined;
    }

    if (analysisResumeTimerRef.current) {
      window.clearTimeout(analysisResumeTimerRef.current);
    }

    analysisResumeTimerRef.current = window.setTimeout(() => {
      startSampling();
    }, monitoringAnalysisTimings.analysisResumeGraceMs);

    return () => {
      if (analysisResumeTimerRef.current) {
        window.clearTimeout(analysisResumeTimerRef.current);
        analysisResumeTimerRef.current = null;
      }
      if (frameKickoffTimerRef.current) {
        window.clearTimeout(frameKickoffTimerRef.current);
        frameKickoffTimerRef.current = null;
      }
      if (frameTimerRef.current) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    };
  }, [
    analysisEnabled,
    isBrowserOnly,
    monitoringAnalysisTimings.analysisResumeGraceMs,
    monitoringStage,
    sessionId,
    startSampling,
    stream,
  ]);

  useEffect(() => {
    if (!autoStart || startedAutoRef.current || isMonitoring || starting) return;
    startedAutoRef.current = true;
    startMonitoring();
  }, [autoStart, isMonitoring, startMonitoring, starting]);

  useEffect(() => () => {
    startAttemptRef.current += 1;
    cleanupMedia();
    resolveReadyWaiters(false);
    resolvePendingStart(false);
  }, [cleanupMedia, resolvePendingStart, resolveReadyWaiters]);

  const waitForCaptureVideoElement = useCallback(({ timeoutMs = VIDEO_READY_TIMEOUT_MS }) => new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (captureVideoRef.current) {
        resolve(captureVideoRef.current);
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Camera preview initialization timed out.'));
        return;
      }

      window.setTimeout(check, 50);
    };

    check();
  }), []);

  const waitForWarmupActivation = useCallback(({
    attemptId,
    mediaStream,
    onActivate,
  }) => new Promise((resolve) => {
    warmupTimerRef.current = scheduleWarmupActivation({
      attemptId,
      getCurrentAttemptId: () => startAttemptRef.current,
      mediaStream,
      onActivate: () => {
        resolve(true);
        onActivate?.();
      },
      setMonitoringStage,
      warmupMs: CLIENT_MONITORING_WARMUP_MS,
      setTimeoutImpl: window.setTimeout,
    });
  }), []);

  const consentModal = useMemo(
    () => ({
      open: showConsent,
      loading: starting,
      error,
      sessionLabel,
      warningLimit,
      onAccept: beginSession,
      onDecline: () => {
        setShowConsent(false);
        setPermissionState('denied');
        setMonitoringStage('error');
        updateErrorState('Camera access is required to continue this monitored session.');
        resolvePendingStart(false);
      },
      onFallback: allowBrowserOnlyFallback ? () => {
        setShowConsent(false);
        activateBrowserOnlyFallback('Camera access declined. Using browser-only monitoring.');
      } : undefined,
    }),
    [beginSession, error, resolvePendingStart, sessionLabel, showConsent, starting, updateErrorState, warningLimit, allowBrowserOnlyFallback, activateBrowserOnlyFallback]
  );

  return {
    browserMetrics,
    browserEventTrackingActive,
    captureVideoRef,
    consentModal,
    error,
    finishMonitoring,
    isMobile,
    isMonitoring,
    latestErrorRef,
    monitoringMode: runtimeMode,
    monitoringReadiness,
    monitoringStage,
    permissionState,
    sessionId,
    sessionIdRef,
    sessionState,
    startMonitoring,
    stream,
    trackBrowserEvent,
    visionState,
    waitForMonitoringReady,
  };
}
