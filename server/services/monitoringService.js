const MonitoringSession = require('../models/MonitoringSession');
const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');
const User = require('../models/User');
const antiMalpractice = require('./antiMalpractice');

const RISK_ORDER = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const WARNING_COOLDOWN_MS = 25 * 1000;
const EVIDENCE_COOLDOWN_MS = 30 * 1000;
const EVIDENCE_RETENTION_DAYS = 30;
const LOCK_DURATION_MS = 3 * 60 * 60 * 1000;
const MONITORING_WARMUP_MS = Number(process.env.MONITORING_WARMUP_MS || 10000);
const VISION_CONFIRM_WINDOW_MS = 20 * 1000;
const FACE_MISSING_EVIDENCE_CONFIDENCE_THRESHOLD = Number(
  process.env.MONITORING_FACE_MISSING_EVIDENCE_CONFIDENCE || 0.7
);
const EVIDENCE_TRIGGER_PRIORITY = [
  'MULTIPLE_FACES',
  'PHONE_VISIBLE',
  'EXTRA_SCREEN_VISIBLE',
  'FACE_MISSING',
];
const USER_LOCK_FIELD_BY_SESSION = {
  assessment: 'assessmentLock',
  coding: 'codingLock',
  diagnostic: 'diagnosticLock',
};
const SIGNAL_TO_VIOLATION_TYPE = {
  BROWSER_WARNING: 'behavioral_anomaly',
  COPY_ATTEMPT: 'copy_attempt',
  EXTRA_SCREEN_VISIBLE: 'behavioral_anomaly',
  FACE_MISSING: 'face_missing',
  GAZE_AWAY: 'gaze_away',
  HEAD_POSE_AWAY: 'gaze_away',
  MULTIPLE_FACES: 'multiple_faces',
  PATTERN_SHIFT: 'behavioral_anomaly',
  PHONE_VISIBLE: 'mobile_detected',
  SPEED: 'behavioral_anomaly',
  TAB_SWITCH: 'tab_switch',
  TIMING_ANOMALY: 'behavioral_anomaly',
  WINDOW_BLUR: 'behavioral_anomaly',
};
const SIGNAL_TO_LOCK_REASON = SIGNAL_TO_VIOLATION_TYPE;
const PRIMARY_SIGNAL_PRIORITY = [
  'PHONE_VISIBLE',
  'MULTIPLE_FACES',
  'FACE_MISSING',
  'EXTRA_SCREEN_VISIBLE',
  'GAZE_AWAY',
  'HEAD_POSE_AWAY',
  'TAB_SWITCH',
  'COPY_ATTEMPT',
  'WINDOW_BLUR',
  'BROWSER_WARNING',
  'PATTERN_SHIFT',
  'SPEED',
  'TIMING_ANOMALY',
];
const VISION_WARNING_RULES = {
  EXTRA_SCREEN_VISIBLE: {
    requiredHits: 1,
    minConfidence: 0.8,
    suppressDuringWarmup: false,
    warningOnly: true,  // Only warning, no evidence capture or lock
  },
  FACE_MISSING: {
    requiredHits: 1,  // Warning on each detection (lock after 3 total)
    minConfidence: 0.55,
    suppressDuringWarmup: true,
  },
  GAZE_AWAY: {
    requiredHits: 2,
    minConfidence: 0.55,
    suppressDuringWarmup: true,
    warningOnly: true,  // Only warning, no evidence capture or lock
  },
  HEAD_POSE_AWAY: {
    requiredHits: 1,
    minConfidence: 0.6,
    suppressDuringWarmup: true,
    warningOnly: true,  // Only warning, no evidence capture or lock
  },
  MULTIPLE_FACES: {
    requiredHits: 1,
    minConfidence: 0.68,
    suppressDuringWarmup: false,
    warningOnly: true,  // Only warning, no evidence capture or lock
  },
  PHONE_VISIBLE: {
    requiredHits: 1,  // Warning on each detection (lock after 2 total)
    minConfidence: 0.8,
    suppressDuringWarmup: false,
  },
};
const VISION_WARNING_PRIORITY = [
  'PHONE_VISIBLE',
  'EXTRA_SCREEN_VISIBLE',
  'MULTIPLE_FACES',
  'FACE_MISSING',
  'HEAD_POSE_AWAY',
  'GAZE_AWAY',
];
const CAMERA_ANALYSIS_MISSING_SIGNAL = 'CAMERA_ANALYSIS_MISSING';

const uniqueStrings = (values = []) => [...new Set((values || []).filter(Boolean).map(String))];

const maxRiskLevel = (left = 'NONE', right = 'NONE') =>
  (RISK_ORDER[right] || 0) > (RISK_ORDER[left] || 0) ? right : left;

const normalizeWarningLimit = () => 3;

const buildEvidenceExpiry = (capturedAt = new Date()) =>
  new Date(capturedAt.getTime() + (EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000));

const getUserLockField = (sessionType = '') => USER_LOCK_FIELD_BY_SESSION[sessionType] || '';

const buildUnlockedLockState = (sessionType = '') => ({
  isLocked: false,
  lockedUntil: null,
  lockReason: '',
  lockCount: 0,
  sessionType,
});

const buildActiveLockState = (lock = {}, sessionType = '') => ({
  isLocked: true,
  lockedUntil: lock.lockedUntil || null,
  lockReason: lock.lockReason || '',
  lockCount: Number(lock.lockCount || 0),
  sessionType,
});

const normalizeSignalCode = (signal = '') => String(signal || '').trim().toUpperCase();

const deriveViolationTypeFromSignals = (signals = []) => {
  const normalizedSignals = uniqueStrings(signals.map(normalizeSignalCode));

  for (const signal of PRIMARY_SIGNAL_PRIORITY) {
    if (normalizedSignals.includes(signal) && SIGNAL_TO_VIOLATION_TYPE[signal]) {
      return SIGNAL_TO_VIOLATION_TYPE[signal];
    }
  }

  for (const signal of normalizedSignals) {
    if (SIGNAL_TO_VIOLATION_TYPE[signal]) {
      return SIGNAL_TO_VIOLATION_TYPE[signal];
    }
  }

  return '';
};

const derivePrimaryViolationType = (session) => {
  const warningSignals = (session?.warnings || [])
    .slice()
    .reverse()
    .flatMap((warning) => warning?.signals || []);
  const sessionSignals = session?.signals || [];
  const primaryFromSignals = deriveViolationTypeFromSignals([
    ...warningSignals,
    ...sessionSignals,
  ]);

  if (primaryFromSignals) {
    return primaryFromSignals;
  }

  if (session?.visionFindings?.phoneVisible) return 'mobile_detected';
  if (session?.visionFindings?.multipleFaces) return 'multiple_faces';
  if (session?.visionFindings?.faceMissing) return 'face_missing';
  if (
    session?.visionFindings?.gazeAway ||
    session?.visionFindings?.headPoseAway
  ) {
    return 'gaze_away';
  }
  if (Number(session?.browserMetrics?.copyAttempts || 0) > 0) return 'copy_attempt';
  if (Number(session?.browserMetrics?.tabSwitches || 0) > 0) return 'tab_switch';
  if (Number(session?.browserMetrics?.windowBlurCount || 0) > 0) return 'behavioral_anomaly';

  return 'behavioral_anomaly';
};

const deriveLockReasonFromSession = (session) => {
  return derivePrimaryViolationType(session) || 'behavioral_anomaly';
};

const syncSessionLock = async (session) => {
  const field = getUserLockField(session?.sessionType);
  if (!field || !session?.userId) {
    return buildUnlockedLockState(session?.sessionType);
  }

  const user = await User.findById(session.userId).select(field);
  if (!user) {
    return buildUnlockedLockState(session?.sessionType);
  }

  // For coding sessions, use per-problem locks if problemId is available
  if (session?.sessionType === 'coding' && session?.problemId) {
    const problemLocks = user.codingProblemLocks || new Map();
    const currentLock = problemLocks.get(session.problemId) || {};
    const currentLockedUntilTime = currentLock.lockedUntil
      ? new Date(currentLock.lockedUntil).getTime()
      : 0;
    const hasActiveLock = Boolean(currentLock.isLocked && currentLockedUntilTime > Date.now());

    if (hasActiveLock) {
      return buildActiveLockState(currentLock, session.sessionType);
    }

    if (!session.finalFlagged) {
      return buildUnlockedLockState(session.sessionType);
    }

    const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    problemLocks.set(session.problemId, {
      isLocked: true,
      lockedUntil,
      lockReason: deriveLockReasonFromSession(session),
      lockCount: Number(currentLock.lockCount || 0) + 1,
    });
    user.codingProblemLocks = problemLocks;
    await user.save();

    return buildActiveLockState(problemLocks.get(session.problemId), session.sessionType);
  }

  // For non-coding or coding without problemId, use global lock
  const currentLock = user[field] || {};
  const currentLockedUntilTime = currentLock.lockedUntil
    ? new Date(currentLock.lockedUntil).getTime()
    : 0;
  const hasActiveLock = Boolean(currentLock.isLocked && currentLockedUntilTime > Date.now());

  if (hasActiveLock) {
    return buildActiveLockState(currentLock, session.sessionType);
  }

  if (!session.finalFlagged) {
    return buildUnlockedLockState(session.sessionType);
  }

  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
  user[field] = {
    isLocked: true,
    lockedUntil,
    lockReason: deriveLockReasonFromSession(session),
    lockCount: Number(currentLock.lockCount || 0) + 1,
  };
  await user.save();

  return buildActiveLockState(user[field], session.sessionType);
};

const decodeBase64ImageBuffer = (imageData) => {
  if (!imageData || typeof imageData !== 'string') return null;

  try {
    const encoded = imageData.includes(',') ? imageData.split(',', 2)[1] : imageData;
    return Buffer.from(encoded, 'base64');
  } catch (_error) {
    return null;
  }
};

const getSessionEvidenceStateValue = (session, triggerCode) => {
  if (!session?.evidenceCaptureState || !triggerCode) return null;

  if (typeof session.evidenceCaptureState.get === 'function') {
    return session.evidenceCaptureState.get(triggerCode) || null;
  }

  return session.evidenceCaptureState[triggerCode] || null;
};

const setSessionEvidenceStateValue = (session, triggerCode, capturedAt) => {
  if (!session || !triggerCode || !capturedAt) return;

  if (!session.evidenceCaptureState || typeof session.evidenceCaptureState.get !== 'function') {
    session.evidenceCaptureState = new Map(
      Object.entries(session.evidenceCaptureState || {})
    );
  }

  session.evidenceCaptureState.set(triggerCode, capturedAt);
  if (typeof session.markModified === 'function') {
    session.markModified('evidenceCaptureState');
  }
};

const getEvidenceSummaryForSession = async (monitoringSessionId) => {
  const [summary] = await MonitoringEvidence.aggregate([
    { $match: { monitoringSessionId } },
    { $sort: { capturedAt: -1, _id: -1 } },
    {
      $group: {
        _id: null,
        evidenceCount: { $sum: 1 },
        latestEvidenceAt: { $first: '$capturedAt' },
        latestEvidenceTrigger: { $first: '$triggerCode' },
      },
    },
  ]);

  return {
    evidenceCount: Number(summary?.evidenceCount || 0),
    latestEvidenceAt: summary?.latestEvidenceAt || null,
    latestEvidenceTrigger: summary?.latestEvidenceTrigger || '',
    hasEvidence: Number(summary?.evidenceCount || 0) > 0,
  };
};

const applyEvidenceSummaryToLog = async (logId, monitoringSessionId) => {
  if (!logId) return null;

  const summary = monitoringSessionId
    ? await getEvidenceSummaryForSession(monitoringSessionId)
    : {
        evidenceCount: 0,
        latestEvidenceAt: null,
        latestEvidenceTrigger: '',
        hasEvidence: false,
      };

  await MalpracticeLog.findByIdAndUpdate(logId, {
    $set: summary,
  });

  return summary;
};

const backfillEvidenceLogLink = async (monitoringSessionId, malpracticeLogId) => {
  if (!monitoringSessionId || !malpracticeLogId) return;

  await MonitoringEvidence.updateMany(
    {
      monitoringSessionId,
      $or: [
        { malpracticeLogId: null },
        { malpracticeLogId: { $ne: malpracticeLogId } },
      ],
    },
    {
      $set: {
        malpracticeLogId,
      },
    }
  );
};

const isEvidenceCooldownActive = (session, triggerCode, now = new Date()) => {
  const lastCaptureAt = getSessionEvidenceStateValue(session, triggerCode);
  if (!lastCaptureAt) return false;
  return (now.getTime() - new Date(lastCaptureAt).getTime()) < EVIDENCE_COOLDOWN_MS;
};

const qualifiesFaceMissingEvidence = (session, alert = {}, confidence = 0) => {
  const previousDetections = session?.visionFindings?.latestDetections || {};
  const previousFaceMissing = !!previousDetections.faceMissing;
  const nextConfidence = Number(alert.confidence ?? confidence ?? 0);

  return previousFaceMissing || nextConfidence >= FACE_MISSING_EVIDENCE_CONFIDENCE_THRESHOLD;
};

const selectEvidenceTrigger = (session, alerts = [], confidence = 0) => {
  const byCode = new Map((alerts || []).map((alert) => [alert.code, alert]));
  const now = new Date();

  for (const triggerCode of EVIDENCE_TRIGGER_PRIORITY) {
    const alert = byCode.get(triggerCode);
    if (!alert) continue;

    // Skip evidence capture for warning-only violations (like HEAD_POSE_AWAY)
    const rule = VISION_WARNING_RULES[triggerCode];
    if (rule?.warningOnly) continue;

    // Only capture evidence after warning threshold is reached
    const warningCount = session.warningCount || 0;
    const warningLimit = session.warningLimit || normalizeWarningLimit();
    
    // For phone detection: capture after 2 warnings
    // For face missing: capture after 3 warnings (but face missing doesn't capture, just locks)
    if (triggerCode === 'PHONE_VISIBLE' && warningCount < 2) {
      continue;
    }
    
    // Face missing doesn't capture evidence, only locks
    if (triggerCode === 'FACE_MISSING') {
      continue;
    }

    if (
      triggerCode === 'FACE_MISSING' &&
      !qualifiesFaceMissingEvidence(session, alert, confidence)
    ) {
      continue;
    }

    if (isEvidenceCooldownActive(session, triggerCode, now)) {
      continue;
    }

    return { alert, triggerCode, capturedAt: now };
  }

  return null;
};

const captureMonitoringEvidence = async ({
  session,
  alerts = [],
  imageData,
  metadata = {},
  riskLevel = 'LOW',
  confidence = 0,
  modelSource = 'heuristic',
}) => {
  if (!session?.institutionId) {
    return {
      evidenceCaptured: false,
      evidenceTrigger: null,
      evidenceCount: 0,
    };
  }

  const trigger = selectEvidenceTrigger(session, alerts, confidence);
  if (!trigger) {
    const summary = await getEvidenceSummaryForSession(session._id);
    return {
      evidenceCaptured: false,
      evidenceTrigger: null,
      evidenceCount: summary.evidenceCount,
    };
  }

  const imageBuffer = decodeBase64ImageBuffer(imageData);
  if (!imageBuffer?.length) {
    const summary = await getEvidenceSummaryForSession(session._id);
    return {
      evidenceCaptured: false,
      evidenceTrigger: null,
      evidenceCount: summary.evidenceCount,
    };
  }

  const existingLog = await MalpracticeLog.findOne({
    monitoringSessionId: session._id,
  }).select('_id monitoringSessionId');

  await MonitoringEvidence.create({
    monitoringSessionId: session._id,
    malpracticeLogId: existingLog?._id || null,
    institutionId: session.institutionId,
    userId: session.userId,
    sessionType: session.sessionType,
    triggerCode: trigger.triggerCode,
    riskLevel: String(trigger.alert?.severity || riskLevel || 'LOW').toUpperCase(),
    capturedAt: trigger.capturedAt,
    expiresAt: buildEvidenceExpiry(trigger.capturedAt),
    contentType: 'image/jpeg',
    imageBuffer,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    modelSource: modelSource === 'onnx' ? 'onnx' : 'heuristic',
    confidence: Number(trigger.alert?.confidence ?? confidence ?? 0),
  });

  setSessionEvidenceStateValue(session, trigger.triggerCode, trigger.capturedAt);

  const summary = await getEvidenceSummaryForSession(session._id);
  if (existingLog?._id) {
    await applyEvidenceSummaryToLog(existingLog._id, session._id);
  }

  return {
    evidenceCaptured: true,
    evidenceTrigger: trigger.triggerCode,
    evidenceCount: summary.evidenceCount,
  };
};

const mergeBrowserMetrics = (session, metrics = {}) => {
  const next = {
    tabSwitches: Number(metrics.tabSwitches || 0),
    copyAttempts: Number(metrics.copyAttempts || 0),
    windowBlurCount: Number(metrics.windowBlurCount || 0),
  };

  session.browserMetrics = {
    tabSwitches: Math.max(session.browserMetrics?.tabSwitches || 0, next.tabSwitches),
    copyAttempts: Math.max(session.browserMetrics?.copyAttempts || 0, next.copyAttempts),
    windowBlurCount: Math.max(session.browserMetrics?.windowBlurCount || 0, next.windowBlurCount),
  };
};

const isMonitoringWarmupActive = (session, now = Date.now()) => {
  const startedAt = session?.startedAt ? new Date(session.startedAt).getTime() : 0;
  if (!startedAt) return false;
  return (now - startedAt) < MONITORING_WARMUP_MS;
};

const getVisionAlertState = (session) => {
  const currentState = session?.visionAlertState;
  if (!currentState || typeof currentState !== 'object' || Array.isArray(currentState)) {
    session.visionAlertState = {};
    return session.visionAlertState;
  }

  return currentState;
};

const resetVisionAlertCounter = (session, alertCode) => {
  const state = getVisionAlertState(session);
  if (state[alertCode]) {
    state[alertCode] = {
      count: 0,
      lastSeenAt: null,
      lastConfidence: 0,
    };
    if (typeof session?.markModified === 'function') {
      session.markModified('visionAlertState');
    }
  }
};

const consumeVisionAlertsForWarning = (session, alerts = [], now = Date.now()) => {
  const alertState = getVisionAlertState(session);
  const activeCodes = new Set((alerts || []).map((alert) => String(alert?.code || '').toUpperCase()).filter(Boolean));

  for (const [alertCode, rule] of Object.entries(VISION_WARNING_RULES)) {
    if (rule.requiredHits > 1 && !activeCodes.has(alertCode)) {
      resetVisionAlertCounter(session, alertCode);
    }
  }

  const confirmedAlerts = [];

  for (const alert of alerts || []) {
    const alertCode = String(alert?.code || '').toUpperCase();
    const rule = VISION_WARNING_RULES[alertCode];
    if (!rule) continue;

    const confidence = Number(alert?.confidence || 0);
    if (confidence < rule.minConfidence) {
      resetVisionAlertCounter(session, alertCode);
      continue;
    }

    if (rule.suppressDuringWarmup && isMonitoringWarmupActive(session, now)) {
      resetVisionAlertCounter(session, alertCode);
      continue;
    }

    const previous = alertState[alertCode] || {
      count: 0,
      lastSeenAt: null,
      lastConfidence: 0,
    };
    const previousSeenAt = previous.lastSeenAt ? new Date(previous.lastSeenAt).getTime() : 0;
    const withinWindow = previousSeenAt > 0 && (now - previousSeenAt) <= VISION_CONFIRM_WINDOW_MS;
    const nextCount = rule.requiredHits > 1
      ? (withinWindow ? previous.count + 1 : 1)
      : 1;

    alertState[alertCode] = {
      count: nextCount,
      lastSeenAt: new Date(now),
      lastConfidence: confidence,
    };

    if (nextCount >= rule.requiredHits) {
      confirmedAlerts.push({
        ...alert,
        code: alertCode,
      });
      alertState[alertCode] = {
        count: 0,
        lastSeenAt: new Date(now),
        lastConfidence: confidence,
      };
    }
  }

  if (typeof session?.markModified === 'function') {
    session.markModified('visionAlertState');
  }

  if (!confirmedAlerts.length) {
    return {
      warningSuggested: false,
      alerts: [],
      primaryAlert: null,
    };
  }

  confirmedAlerts.sort((left, right) => (
    VISION_WARNING_PRIORITY.indexOf(left.code) - VISION_WARNING_PRIORITY.indexOf(right.code)
  ));

  return {
    warningSuggested: true,
    alerts: confirmedAlerts,
    primaryAlert: confirmedAlerts[0],
  };
};

const shouldIssueWarning = (session, warning = {}) => {
  if (warning.force) return !session.finalFlagged;
  if (session.finalFlagged) return false;
  const nextSignals = uniqueStrings((warning.signals || []).map(normalizeSignalCode));

  if (!nextSignals.length) {
    const lastWarning = session.warnings?.[session.warnings.length - 1];
    if (!lastWarning?.createdAt) return true;
    return (Date.now() - new Date(lastWarning.createdAt).getTime()) >= WARNING_COOLDOWN_MS;
  }

  return !(session.warnings || []).some((existingWarning) => {
    if (!existingWarning?.createdAt) return false;

    const warningAgeMs = Date.now() - new Date(existingWarning.createdAt).getTime();
    if (warningAgeMs >= WARNING_COOLDOWN_MS) {
      return false;
    }

    const existingSignals = uniqueStrings(
      (existingWarning.signals || []).map(normalizeSignalCode)
    );

    return existingSignals.some((signal) => nextSignals.includes(signal));
  });
};

const addEvent = (session, event) => {
  session.events.push({
    source: event.source || 'browser',
    type: event.type || 'event',
    riskLevel: event.riskLevel || 'LOW',
    message: event.message || '',
    metadata: event.metadata || {},
    createdAt: event.createdAt || new Date(),
  });
};

const addWarning = (session, warning) => {
  if (!shouldIssueWarning(session, warning)) return false;

  session.warningCount += 1;
  session.warnings.push({
    source: warning.source || 'combined',
    riskLevel: warning.riskLevel || 'MEDIUM',
    message: warning.message || '',
    signals: uniqueStrings((warning.signals || []).map(normalizeSignalCode)),
    createdAt: new Date(),
  });

  if (session.warningCount >= session.warningLimit) {
    session.finalFlagged = true;
    session.riskLevel = maxRiskLevel(session.riskLevel, 'HIGH');
  }

  return true;
};

const applyRisk = (session, { riskLevel = 'LOW', riskScore = 0, source, signals = [] }) => {
  session.riskLevel = maxRiskLevel(session.riskLevel, riskLevel);
  session.riskScore = Math.max(Number(session.riskScore || 0), Number(riskScore || 0));
  session.sourceFlags = uniqueStrings([...(session.sourceFlags || []), ...(source ? [source] : [])]);
  session.signals = uniqueStrings([...(session.signals || []), ...signals]);
};

const summarizeVisionFindings = (session, detections = {}, confidence = 0) => {
  session.visionFindings = {
    multipleFaces: !!(session.visionFindings?.multipleFaces || detections.multipleFaces),
    headPoseAway: !!(session.visionFindings?.headPoseAway || detections.headPoseAway),
    gazeAway: !!(session.visionFindings?.gazeAway || detections.gazeAway),
    faceMissing: !!(session.visionFindings?.faceMissing || detections.faceMissing),
    phoneVisible: !!(session.visionFindings?.phoneVisible || detections.phoneVisible),
    extraScreenVisible: !!(session.visionFindings?.extraScreenVisible || detections.extraScreenVisible),
    faceCount: Math.max(Number(session.visionFindings?.faceCount || 1), Number(detections.faceCount || 0)),
    confidence: Math.max(Number(session.visionFindings?.confidence || 0), Number(confidence || 0)),
    latestDetections: detections || {},
  };
};

const getBrowserAnalysis = (session) =>
  antiMalpractice.analyzeSession({
    answers: [],
    tabSwitches: session.browserMetrics?.tabSwitches || 0,
    copyAttempts: session.browserMetrics?.copyAttempts || 0,
    windowBlurCount: session.browserMetrics?.windowBlurCount || 0,
  });

const deriveSessionFinalStatus = (session) => {
  if (session.finalFlagged) return 'flagged';
  if ((session.warningCount || 0) > 0) return 'warned';
  if ((session.signals || []).includes(CAMERA_ANALYSIS_MISSING_SIGNAL)) return 'limited';
  return 'clean';
};

const buildMalpracticePayload = (session) => {
  const browserAnalysis = getBrowserAnalysis(session);
  const violationType = derivePrimaryViolationType(session);
  const reasons = uniqueStrings([
    ...(session.warnings || []).map((warning) => warning.message),
    ...(session.events || []).map((event) => event.message),
    ...(browserAnalysis.reasons || []),
  ]);
  const flags = uniqueStrings([
    ...(browserAnalysis.flags || []),
    ...(session.signals || []),
  ]);

  const sourceFlags = uniqueStrings([
    ...(session.sourceFlags || []),
    session.browserMetrics?.tabSwitches || session.browserMetrics?.copyAttempts || session.browserMetrics?.windowBlurCount ? 'browser' : '',
    session.visionFindings?.latestDetections && Object.keys(session.visionFindings.latestDetections).length ? 'vision' : '',
  ]).filter(Boolean);

  const combinedSource =
    sourceFlags.includes('browser') && sourceFlags.includes('vision')
      ? ['combined', ...sourceFlags]
      : sourceFlags;

  const riskLevel = maxRiskLevel(
    maxRiskLevel(browserAnalysis.riskLevel, session.riskLevel || 'NONE'),
    session.finalFlagged ? 'HIGH' : 'NONE'
  );
  const riskScore = Math.max(Number(browserAnalysis.riskScore || 0), Number(session.riskScore || 0));
  const confidence = Math.max(
    Number(session?.visionFindings?.confidence || 0),
    Number(riskScore || 0)
  );

  return {
    shouldPersist: session.finalFlagged || riskLevel === 'HIGH' || riskLevel === 'MEDIUM' || (session.warningCount || 0) > 0,
    violationType,
    detectedObject: violationType === 'mobile_detected' ? 'cell phone' : '',
    confidence,
    riskLevel,
    riskScore,
    flags,
    reasons,
    sourceFlags: uniqueStrings(combinedSource),
  };
};

const upsertMalpracticeLogForSession = async (session) => {
  const payload = buildMalpracticePayload(session);
  if (!payload.shouldPersist) return null;

  const evidenceSummary = await getEvidenceSummaryForSession(session._id);

  const update = {
    userId: session.userId,
    institutionId: session.institutionId || null,
    assessmentId: session.assessmentId || null,
    monitoringSessionId: session._id,
    sessionType: session.sessionType,
    topicId: session.topicId || null,
    moduleId: session.moduleId || null,
    problemId: session.problemId || null,
    violationType: payload.violationType || 'behavioral_anomaly',
    confidence: Number(payload.confidence || 0),
    detectedObject: payload.detectedObject || '',
    warningNumber: Number(session.warningCount || 0),
    riskLevel: payload.riskLevel,
    riskScore: payload.riskScore,
    flags: payload.flags,
    reasons: payload.reasons,
    sourceFlags: payload.sourceFlags,
    warningCount: session.warningCount || 0,
    warningLimit: session.warningLimit || 0,
    finalFlagged: !!session.finalFlagged,
    visionFindings: {
      multipleFaces: !!session.visionFindings?.multipleFaces,
      headPoseAway: !!session.visionFindings?.headPoseAway,
      gazeAway: !!session.visionFindings?.gazeAway,
      faceMissing: !!session.visionFindings?.faceMissing,
      phoneVisible: !!session.visionFindings?.phoneVisible,
      extraScreenVisible: !!session.visionFindings?.extraScreenVisible,
      faceCount: Number(session.visionFindings?.faceCount || 0),
      confidence: Number(session.visionFindings?.confidence || 0),
    },
    evidenceCount: evidenceSummary.evidenceCount,
    latestEvidenceAt: evidenceSummary.latestEvidenceAt,
    latestEvidenceTrigger: evidenceSummary.latestEvidenceTrigger,
    hasEvidence: evidenceSummary.hasEvidence,
    sessionData: {
      ipAddress: '',
      tabSwitches: Number(session.browserMetrics?.tabSwitches || 0),
      copyAttempts: Number(session.browserMetrics?.copyAttempts || 0),
      windowBlurCount: Number(session.browserMetrics?.windowBlurCount || 0),
      avgAnswerTime: 0,
      timingStdDev: 0,
      totalQuestions: 0,
      changedAnswers: 0,
    },
  };

  const log = await MalpracticeLog.findOneAndUpdate(
    { monitoringSessionId: session._id },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await backfillEvidenceLogLink(session._id, log._id);
  await applyEvidenceSummaryToLog(log._id, session._id);

  return log;
};

const finalizeSession = async (session, finishPayload = {}) => {
  if (!session) return null;

  if (finishPayload.browserMetrics) {
    mergeBrowserMetrics(session, finishPayload.browserMetrics);
  }

  if (finishPayload.assessmentId) session.assessmentId = finishPayload.assessmentId;
  if (finishPayload.topicId) session.topicId = finishPayload.topicId;
  if (finishPayload.moduleId) session.moduleId = finishPayload.moduleId;
  if (finishPayload.problemId) session.problemId = finishPayload.problemId;

  if (session.previewEnabled && !session.lastAnalyzedAt) {
    addEvent(session, {
      source: 'vision',
      type: 'camera_analysis_missing',
      riskLevel: 'LOW',
      message: 'Camera preview started, but no camera analysis frame was recorded before finish.',
    });
    applyRisk(session, {
      source: 'vision',
      riskLevel: 'LOW',
      signals: [CAMERA_ANALYSIS_MISSING_SIGNAL],
    });
  }

  session.status = 'finished';
  session.finishedAt = new Date();
  session.finalStatus = deriveSessionFinalStatus(session);
  await session.save();
  await upsertMalpracticeLogForSession(session);
  await syncSessionLock(session);
  return session;
};

const closeActiveSessionsForUser = async (userId, sessionType) => {
  const activeSessions = await MonitoringSession.find({
    userId,
    sessionType,
    status: 'active',
  });

  for (const session of activeSessions) {
    await finalizeSession(session);
  }
};

module.exports = {
  addEvent,
  addWarning,
  applyRisk,
  applyEvidenceSummaryToLog,
  backfillEvidenceLogLink,
  buildMalpracticePayload,
  consumeVisionAlertsForWarning,
  captureMonitoringEvidence,
  closeActiveSessionsForUser,
  EVIDENCE_COOLDOWN_MS,
  EVIDENCE_RETENTION_DAYS,
  FACE_MISSING_EVIDENCE_CONFIDENCE_THRESHOLD,
  finalizeSession,
  getBrowserAnalysis,
  getEvidenceSummaryForSession,
  isMonitoringWarmupActive,
  maxRiskLevel,
  mergeBrowserMetrics,
  MONITORING_WARMUP_MS,
  normalizeWarningLimit,
  selectEvidenceTrigger,
  summarizeVisionFindings,
  syncSessionLock,
  uniqueStrings,
  upsertMalpracticeLogForSession,
};
