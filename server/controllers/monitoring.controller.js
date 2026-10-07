const MonitoringSession = require('../models/MonitoringSession');
const mlService = require('../services/mlService');
const {
  addEvent,
  addWarning,
  applyRisk,
  consumeVisionAlertsForWarning,
  captureMonitoringEvidence,
  closeActiveSessionsForUser,
  finalizeSession,
  getBrowserAnalysis,
  mergeBrowserMetrics,
  normalizeWarningLimit,
  summarizeVisionFindings,
  syncSessionLock,
  uniqueStrings,
} = require('../services/monitoringService');

const buildReadinessResponse = (status = {}) => ({
  ready: Boolean(status.ready),
  fullModelReady: Boolean(status.fullModelReady),
  cameraMonitoringReady: Boolean(
    status.cameraMonitoringReady
    || status.supportsCameraMonitoring
    || status.supportsFallbackHeuristics
    || status.fullModelReady
  ),
  modelLoaded: Boolean(status.modelLoaded),
  modelFilePresent: Boolean(status.modelFilePresent),
  onnxRuntimeAvailable: Boolean(status.onnxRuntimeAvailable),
  imageStackAvailable: Boolean(status.imageStackAvailable),
  modelSource: status.modelSource || 'unknown',
  supportedLabels: Array.isArray(status.supportedLabels) ? status.supportedLabels : [],
  supportsCameraMonitoring: Boolean(status.supportsCameraMonitoring),
  supportsPhoneDetection: Boolean(status.supportsPhoneDetection),
  supportsExtraScreenDetection: Boolean(status.supportsExtraScreenDetection),
  supportsFallbackHeuristics: Boolean(status.supportsFallbackHeuristics),
  limitedDetection: Boolean(status.limitedDetection || (status.ready && !status.fullModelReady)),
  capability: status.capability || (status.fullModelReady ? 'full' : status.ready ? 'limited' : 'unavailable'),
  message: status.message || 'Live proctor monitoring is unavailable.',
});

const getMonitoringHealth = async () => {
  if (typeof mlService.getProctorHealth === 'function') {
    return mlService.getProctorHealth();
  }

  if (typeof mlService.getMalpracticesHealth === 'function') {
    return mlService.getMalpracticesHealth();
  }

  return {
    ready: false,
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
    message: 'Live proctor monitoring is unavailable.',
  };
};

const analyzeMonitoringFrameWithModel = async (payload) => {
  // Use malpractices endpoint with trained model instead of proctor endpoint
  if (typeof mlService.analyzeMalpracticesFrame === 'function') {
    return mlService.analyzeMalpracticesFrame(payload);
  }

  if (typeof mlService.analyzeProctorFrame === 'function') {
    return mlService.analyzeProctorFrame(payload);
  }

  return {
    detections: {
      multipleFaces: false,
      headPoseAway: false,
      gazeAway: false,
      faceMissing: false,
      phoneVisible: false,
      extraScreenVisible: false,
      faceCount: 1,
    },
    alerts: [],
    signals: [],
    riskLevel: 'LOW',
    riskScore: 0,
    confidence: 0,
    metadata: {
      modelLoaded: false,
      modelSource: 'heuristic',
    },
    fallback: true,
  };
};

const resolveMonitoringReadiness = async (sessionType = 'assessment') => {
  const monitoringHealth = await getMonitoringHealth();
  const status = {
    ready: monitoringHealth.ready,
    fullModelReady: monitoringHealth.modelLoaded,
    cameraMonitoringReady: monitoringHealth.ready,
    modelLoaded: monitoringHealth.modelLoaded,
    modelFilePresent: Boolean(monitoringHealth.modelFilePresent ?? monitoringHealth.modelLoaded),
    onnxRuntimeAvailable: Boolean(monitoringHealth.onnxRuntimeAvailable),
    imageStackAvailable: Boolean(monitoringHealth.imageStackAvailable),
    modelSource: monitoringHealth.modelSource || 'onnx',
    supportedLabels: Array.isArray(monitoringHealth.supportedLabels) ? monitoringHealth.supportedLabels : [],
    supportsCameraMonitoring: Boolean(monitoringHealth.supportsCameraMonitoring ?? monitoringHealth.supportsFaceDetection),
    supportsPhoneDetection: Boolean(monitoringHealth.supportsPhoneDetection),
    supportsExtraScreenDetection: false,
    supportsFallbackHeuristics: Boolean(monitoringHealth.supportsFallbackHeuristics),
    message: monitoringHealth.message,
  };
  return buildReadinessResponse(
    mlService.buildMonitoringReadiness(status, sessionType)
  );
};

const buildSessionResponse = (session, extra = {}) => ({
  monitoringSessionId: session._id,
  warningCount: session.warningCount || 0,
  warningLimit: session.warningLimit || 0,
  warnings: session.warnings || [],
  finalFlagged: !!session.finalFlagged,
  riskLevel: session.riskLevel || 'NONE',
  riskScore: session.riskScore || 0,
  signals: session.signals || [],
  finalStatus: session.finalStatus || 'clean',
  isLocked: extra.isLocked || false,
  lockedUntil: extra.lockedUntil || null,
  lockReason: extra.lockReason || '',
  lockCount: extra.lockCount || 0,
  ...extra,
});

const VISION_WARNING_DESCRIPTIONS = {
  PHONE_VISIBLE: 'phone detected',
  FACE_MISSING: 'face not visible',
  MULTIPLE_FACES: 'multiple faces detected',
  HEAD_POSE_AWAY: 'head turned away from the screen',
  GAZE_AWAY: 'eyes looking away from the screen',
  EXTRA_SCREEN_VISIBLE: 'another screen detected',
};

const VISION_WARNING_GUIDANCE = {
  PHONE_VISIBLE: 'Keep mobile devices away from the test area.',
  FACE_MISSING: 'Keep your face clearly visible in the camera.',
  MULTIPLE_FACES: 'Ensure only you are visible in the camera frame.',
  HEAD_POSE_AWAY: 'Face the screen and keep your head inside the camera frame.',
  GAZE_AWAY: 'Keep your eyes focused on the test screen.',
  EXTRA_SCREEN_VISIBLE: 'Remove any extra screen or secondary device from view.',
};

const capitalizeFirst = (value = '') => (
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : ''
);

const joinNaturalList = (values = []) => {
  const filteredValues = uniqueStrings((values || []).filter(Boolean));

  if (!filteredValues.length) return '';
  if (filteredValues.length === 1) return filteredValues[0];
  if (filteredValues.length === 2) return `${filteredValues[0]} and ${filteredValues[1]}`;

  return `${filteredValues.slice(0, -1).join(', ')}, and ${filteredValues[filteredValues.length - 1]}`;
};

const buildVisionWarningMessage = ({
  signals = [],
  warningCount = 0,
  warningLimit = normalizeWarningLimit(),
}) => {
  const normalizedSignals = uniqueStrings(
    (signals || []).map((signal) => String(signal || '').toUpperCase())
  ).filter((signal) => VISION_WARNING_DESCRIPTIONS[signal]);

  const remainingWarnings = Math.max(
    Number(warningLimit || normalizeWarningLimit()) - Number(warningCount || 0),
    0
  );
  const progressMessage = remainingWarnings > 1
    ? `${remainingWarnings} warnings remaining before this session is locked.`
    : remainingWarnings === 1
      ? 'One more warning will lock this session for 3 hours.'
      : 'This session is now locked for 3 hours pending review.';

  if (!normalizedSignals.length) {
    return `Suspicious behavior detected by camera monitoring. ${progressMessage}`.trim();
  }

  const issueMessage = normalizedSignals.length > 1
    ? `Multiple issues detected: ${joinNaturalList(normalizedSignals.map((signal) => VISION_WARNING_DESCRIPTIONS[signal]))}.`
    : `${capitalizeFirst(VISION_WARNING_DESCRIPTIONS[normalizedSignals[0]])}.`;

  const guidanceMessage = uniqueStrings(
    normalizedSignals
      .map((signal) => VISION_WARNING_GUIDANCE[signal])
      .filter(Boolean)
  ).join(' ');

  return [issueMessage, guidanceMessage, progressMessage].filter(Boolean).join(' ');
};

const BROWSER_EVENT_DEFINITIONS = {
  blur: {
    eventType: 'window_blur',
    message: 'Window focus was lost during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'WINDOW_BLUR',
  },
  copyattempt: {
    eventType: 'copy_attempt',
    message: 'Copy or selection activity was blocked during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'COPY_ATTEMPT',
  },
  copyattempts: {
    eventType: 'copy_attempt',
    message: 'Copy or selection activity was blocked during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'COPY_ATTEMPT',
  },
  copyattempted: {
    eventType: 'copy_attempt',
    message: 'Copy or selection activity was blocked during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'COPY_ATTEMPT',
  },
  tabswitch: {
    eventType: 'tab_switch',
    message: 'Tab switching was detected during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'TAB_SWITCH',
  },
  tabswitches: {
    eventType: 'tab_switch',
    message: 'Tab switching was detected during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'TAB_SWITCH',
  },
  windowblur: {
    eventType: 'window_blur',
    message: 'Window focus was lost during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'WINDOW_BLUR',
  },
  windowblurcount: {
    eventType: 'window_blur',
    message: 'Window focus was lost during the monitored session.',
    riskLevel: 'MEDIUM',
    signal: 'WINDOW_BLUR',
  },
};
const BROWSER_METRIC_WARNING_RULES = [
  {
    metric: 'tabSwitches',
    signal: 'TAB_SWITCH',
    riskLevel: 'MEDIUM',
    message: 'You switched away from the test window. Stay on this tab throughout the test.',
  },
  {
    metric: 'copyAttempts',
    signal: 'COPY_ATTEMPT',
    riskLevel: 'MEDIUM',
    message: 'Copy or selection activity was detected. Copying from external sources is not permitted.',
  },
  {
    metric: 'windowBlurCount',
    signal: 'WINDOW_BLUR',
    riskLevel: 'MEDIUM',
    message: 'Browser window lost focus. Keep the test window active and focused.',
  },
];

const normalizeBrowserEventKey = (value = '') =>
  String(value || '')
    .trim()
    .replace(/[\s_-]/g, '')
    .toLowerCase();

const getBrowserEventDefinition = (event = {}) => {
  const directMatch = BROWSER_EVENT_DEFINITIONS[normalizeBrowserEventKey(event?.type)];
  if (directMatch) return directMatch;

  return BROWSER_EVENT_DEFINITIONS[normalizeBrowserEventKey(event?.signal)];
};

const countWarningsForSignal = (session, signal) => (
  (session.warnings || []).filter((warning) => (
    (warning.signals || []).map(String).includes(signal)
  )).length
);

const applyBrowserMetricWarnings = (session) => {
  const warningLimit = Number(session.warningLimit || 3);

  BROWSER_METRIC_WARNING_RULES.forEach((rule) => {
    const observedCount = Number(session.browserMetrics?.[rule.metric] || 0);
    const targetWarnings = Math.min(observedCount, warningLimit);
    let currentWarnings = countWarningsForSignal(session, rule.signal);

    while (currentWarnings < targetWarnings && !session.finalFlagged) {
      const added = addWarning(session, {
        source: 'browser',
        riskLevel: rule.riskLevel,
        message: rule.message,
        signals: [rule.signal],
        force: true,
      });

      if (!added) break;
      currentWarnings += 1;
    }
  });
};

const applyBrowserMetricsAndEvents = (session, payload = {}) => {
  const { browserMetrics, events = [] } = payload;

  if (browserMetrics) {
    mergeBrowserMetrics(session, browserMetrics);
    const browserAnalysis = getBrowserAnalysis(session);
    applyRisk(session, {
      source: 'browser',
      riskLevel: browserAnalysis.riskLevel,
      riskScore: browserAnalysis.riskScore,
      signals: browserAnalysis.flags,
    });

    if ((browserAnalysis.flags || []).length > 0) {
      addEvent(session, {
        source: 'browser',
        type: 'browser_metrics',
        riskLevel: browserAnalysis.riskLevel,
        message: browserAnalysis.reasons?.join('; ') || 'Browser monitoring event detected.',
        metadata: {
          ...session.browserMetrics,
          flags: browserAnalysis.flags,
        },
      });
    }
  }

  (events || []).forEach((event) => {
    const browserEvent = getBrowserEventDefinition(event);
    const nextType = browserEvent?.eventType || event.type || 'event';
    const nextRiskLevel = event.riskLevel || browserEvent?.riskLevel || 'LOW';
    const nextMessage = event.message || browserEvent?.message || '';
    const nextSignals = browserEvent?.signal ? [browserEvent.signal] : [];

    addEvent(session, {
      source: event.source || 'browser',
      type: nextType,
      riskLevel: nextRiskLevel,
      message: nextMessage,
      metadata: event.metadata || {},
    });

    applyRisk(session, {
      source: event.source || 'browser',
      riskLevel: nextRiskLevel,
      signals: nextSignals,
    });

    if (nextSignals.length > 0) {
      addWarning(session, {
        source: event.source || 'browser',
        riskLevel: nextRiskLevel,
        message: nextMessage,
        signals: nextSignals,
      });
    }
  });

  if (browserMetrics) {
    applyBrowserMetricWarnings(session);
  }
};

const ensureOwnedActiveSession = async (req, res) => {
  const session = await MonitoringSession.findOne({
    _id: req.params.id,
    userId: req.user._id,
  });

  if (!session) {
    res.status(404).json({ success: false, message: 'Monitoring session not found' });
    return null;
  }

  return session;
};

const getMonitoringReadiness = async (req, res, next) => {
  try {
    const readiness = await resolveMonitoringReadiness(req.query?.sessionType);
    const statusCode = readiness.ready ? 200 : 503;

    res.status(statusCode).json({
      success: readiness.ready,
      data: readiness,
    });
  } catch (err) {
    next(err);
  }
};

const startMonitoringSession = async (req, res, next) => {
  try {
    const { sessionType, topicId, moduleId, problemId, deviceType, previewEnabled } = req.body;

    if (!['assessment', 'coding', 'diagnostic'].includes(sessionType)) {
      return res.status(400).json({
        success: false,
        message: 'sessionType must be assessment, coding, or diagnostic',
      });
    }

    if (sessionType === 'assessment' && (!topicId || !moduleId)) {
      return res.status(400).json({
        success: false,
        message: 'topicId and moduleId are required for assessment monitoring',
      });
    }

    if (sessionType === 'coding' && !problemId) {
      return res.status(400).json({
        success: false,
        message: 'problemId is required for coding monitoring',
      });
    }

    const readiness = await resolveMonitoringReadiness(sessionType);
    if (!readiness.ready) {
      return res.status(503).json({
        success: false,
        message: readiness.message,
        data: readiness,
      });
    }

    await closeActiveSessionsForUser(req.user._id, sessionType);

    const session = await MonitoringSession.create({
      userId: req.user._id,
      institutionId: req.user.institutionId || null,
      sessionType,
      topicId: topicId || null,
      moduleId: moduleId || null,
      problemId: problemId || null,
      deviceType: ['desktop', 'mobile'].includes(deviceType) ? deviceType : 'unknown',
      previewEnabled: !!previewEnabled,
      warningLimit: normalizeWarningLimit(req.user),
      startedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      data: buildSessionResponse(session),
    });
  } catch (err) {
    next(err);
  }
};

const recordMonitoringEvents = async (req, res, next) => {
  try {
    const session = await ensureOwnedActiveSession(req, res);
    if (!session) return;

    const { browserMetrics, events = [] } = req.body;

    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Monitoring session is already finished',
      });
    }

    applyBrowserMetricsAndEvents(session, {
      browserMetrics,
      events,
    });

    session.finalStatus = session.finalFlagged ? 'flagged' : session.warningCount > 0 ? 'warned' : session.finalStatus;
    
    // Use findOneAndUpdate to avoid version conflicts from concurrent updates
    const updatedSession = await MonitoringSession.findByIdAndUpdate(
      session._id,
      {
        browserMetrics: session.browserMetrics,
        signals: session.signals,
        events: session.events,
        warningCount: session.warningCount,
        warnings: session.warnings,
        finalStatus: session.finalStatus,
        finalFlagged: session.finalFlagged,
      },
      { new: true, runValidators: false }
    );
    
    if (!updatedSession) {
      return res.status(404).json({
        success: false,
        message: 'Monitoring session not found',
      });
    }
    
    const lockState = await syncSessionLock(updatedSession);

    res.status(200).json({
      success: true,
      data: buildSessionResponse(updatedSession, lockState),
    });
  } catch (err) {
    next(err);
  }
};

const analyzeMonitoringFrame = async (req, res, next) => {
  try {
    const session = await ensureOwnedActiveSession(req, res);
    if (!session) return;

    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Monitoring session is already finished',
      });
    }

    const { imageData, metadata = {} } = req.body;
    if (!imageData) {
      return res.status(400).json({
        success: false,
        message: 'imageData is required',
      });
    }

    const result = await analyzeMonitoringFrameWithModel({
      imageData,
      metadata: {
        ...metadata,
        sessionType: session.sessionType,
      },
    });

    const modelSource = result?.metadata?.modelSource === 'onnx' ? 'onnx' : 'heuristic';
    const visionMonitoringActive = Boolean(
      (result?.metadata?.modelLoaded && modelSource === 'onnx')
      || modelSource === 'heuristic'
    );
    const detections = {
      multipleFaces: false,
      headPoseAway: false,
      gazeAway: false,
      faceMissing: false,
      phoneVisible: false,
      extraScreenVisible: false,
      faceCount: 1,
      ...(result?.detections || {}),
    };
    const alerts = Array.isArray(result?.alerts) ? result.alerts : [];
    const signals = uniqueStrings([
      ...(visionMonitoringActive ? (result?.signals || []) : []),
      ...alerts.map((alert) => alert.code),
    ]);
    const evidenceResult = await captureMonitoringEvidence({
      session,
      alerts,
      imageData,
      metadata,
      riskLevel: visionMonitoringActive ? (result?.riskLevel || 'LOW') : 'LOW',
      confidence: result?.confidence || 0,
      modelSource,
    });

    summarizeVisionFindings(session, detections, result?.confidence || 0);
    applyRisk(session, {
      source: alerts.length > 0 ? 'combined' : 'vision',
      riskLevel: visionMonitoringActive ? (result?.riskLevel || 'LOW') : 'LOW',
      riskScore: visionMonitoringActive ? (result?.riskScore || 0) : 0,
      signals,
    });

    alerts.forEach((alert) => {
      addEvent(session, {
        source: 'vision',
        type: alert.code || 'vision_alert',
        riskLevel: alert.severity || result?.riskLevel || 'LOW',
        message: alert.message || 'Vision monitoring alert detected.',
        metadata: {
          confidence: alert.confidence || 0,
          detections,
        },
      });
    });

    const warningDecision = consumeVisionAlertsForWarning(session, alerts);
    if (warningDecision.warningSuggested && warningDecision.primaryAlert) {
      const nextWarningCount = Number(session.warningCount || 0) + 1;
      const nextWarningLimit = Number(session.warningLimit || normalizeWarningLimit());
      const warningSignals = uniqueStrings(warningDecision.alerts.map((alert) => alert.code));
      const warningMessage = buildVisionWarningMessage({
        signals: warningSignals,
        warningCount: nextWarningCount,
        warningLimit: nextWarningLimit,
      });

      addWarning(session, {
        source: session.sourceFlags?.includes('browser') ? 'combined' : 'vision',
        riskLevel: warningDecision.primaryAlert.severity || result?.riskLevel || 'MEDIUM',
        message: warningMessage,
        signals: warningSignals,
      });
    }

    session.lastAnalyzedAt = new Date();
    session.finalStatus = session.finalFlagged ? 'flagged' : session.warningCount > 0 ? 'warned' : session.finalStatus;
    const updatedSession = await MonitoringSession.findByIdAndUpdate(
      session._id,
      {
        visionFindings: session.visionFindings,
        riskLevel: session.riskLevel,
        riskScore: session.riskScore,
        sourceFlags: session.sourceFlags,
        signals: session.signals,
        visionAlertState: session.visionAlertState,
        events: session.events,
        warningCount: session.warningCount,
        warnings: session.warnings,
        finalFlagged: session.finalFlagged,
        lastAnalyzedAt: session.lastAnalyzedAt,
        finalStatus: session.finalStatus,
      },
      { new: true, runValidators: false }
    );

    if (!updatedSession) {
      return res.status(404).json({
        success: false,
        message: 'Monitoring session not found',
      });
    }

    const lockState = await syncSessionLock(updatedSession);

    res.status(200).json({
      success: true,
      data: buildSessionResponse(updatedSession, {
        alerts,
        confidence: Number(result?.confidence || 0),
        detections,
        frameSize: result?.frameSize || null,
        evidenceCaptured: !!evidenceResult?.evidenceCaptured,
        evidenceTrigger: evidenceResult?.evidenceTrigger || null,
        evidenceCount: Number(evidenceResult?.evidenceCount || 0),
        modelSource,
        mlFallback: Boolean(result?.fallback),
        ...lockState,
      }),
    });
  } catch (err) {
    next(err);
  }
};

const finishMonitoringSession = async (req, res, next) => {
  try {
    const session = await ensureOwnedActiveSession(req, res);
    if (!session) return;

    if (session.status === 'finished') {
      const lockState = await syncSessionLock(session);
      return res.status(200).json({
        success: true,
        data: buildSessionResponse(session, lockState),
      });
    }

    applyBrowserMetricsAndEvents(session, req.body || {});
    await finalizeSession(session, req.body || {});
    const lockState = await syncSessionLock(session);

    res.status(200).json({
      success: true,
      data: buildSessionResponse(session, lockState),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  analyzeMonitoringFrame,
  finishMonitoringSession,
  getMonitoringReadiness,
  recordMonitoringEvents,
  startMonitoringSession,
};
