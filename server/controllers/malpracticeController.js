const mongoose = require('mongoose');
const User = require('../models/User');
const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');

// ─── Constants ─────────────────────────────────────────────────────────────
const LOCK_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const EVIDENCE_RETENTION_DAYS = 30;
const MAX_IMAGE_BYTES = 200 * 1024;
const DEDUP_WINDOW_MS = 15000; // Ignore identical violation within 15 seconds (aligned with client cooldowns)
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h window for counting violations

const ALLOWED_SESSION_TYPES = new Set(['assessment', 'diagnostic']);
const ALLOWED_VIOLATION_TYPES = new Set([
  'gaze_away',
  'multiple_faces',
  'mobile_detected',
  'tab_switch',
  'copy_attempt',
  'behavioral_anomaly',
]);

const VIOLATION_TRIGGER_CODES = {
  gaze_away: 'GAZE_AWAY',
  multiple_faces: 'MULTIPLE_FACES',
  mobile_detected: 'PHONE_VISIBLE',
  tab_switch: 'TAB_SWITCH',
  copy_attempt: 'COPY_ATTEMPT',
  behavioral_anomaly: 'BEHAVIORAL_ANOMALY',
};

// Map each sessionType to its lock field on the User document.
const LOCK_FIELD = {
  diagnostic: 'diagnosticLock',
  assessment: 'assessmentLock',
};

// ─── Utility helpers ────────────────────────────────────────────────────────

const normalizeConfidence = (value) => {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric) || numeric <= 0) return 0;
  return numeric > 1 ? Math.min(numeric / 100, 1) : Math.min(numeric, 1);
};

const formatDuration = (ms) => {
  const safe = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
};

/**
 * Clears the lock on the appropriate field for a given sessionType.
 */
const clearLock = (user, sessionType) => {
  const field = LOCK_FIELD[sessionType] || 'assessmentLock';
  user[field] = {
    isLocked: false,
    lockedUntil: null,
    lockReason: '',
    lockCount: Number(user[field]?.lockCount || 0),
  };
};

/**
 * Builds a normalised lock-state response from the correct field.
 */
const buildLockResponse = (user, sessionType, now = Date.now()) => {
  const field = LOCK_FIELD[sessionType] || 'assessmentLock';
  const lock = user[field] || {};
  const lockedUntilTime = lock.lockedUntil ? new Date(lock.lockedUntil).getTime() : 0;
  const active = Boolean(lock.isLocked && lockedUntilTime > now);
  const timeRemainingMs = active ? Math.max(0, lockedUntilTime - now) : 0;

  return {
    isLocked: active,
    lockedUntil: active ? lock.lockedUntil : null,
    timeRemainingMs,
    timeRemainingFormatted: active ? formatDuration(timeRemainingMs) : '0h 0m 0s',
    lockReason: active ? (lock.lockReason || '') : '',
    lockCount: Number(lock.lockCount || 0),
    sessionType,
  };
};

const decodeBase64Image = (value) => {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const matched = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const base64Payload = matched ? matched[2] : raw;
  const contentType = matched ? matched[1] : 'image/jpeg';
  try {
    const buffer = Buffer.from(base64Payload, 'base64');
    return { buffer, contentType, byteLength: buffer.length, dataUrl: matched ? raw : `data:${contentType};base64,${base64Payload}` };
  } catch (_error) {
    return null;
  }
};

const buildEvidenceExpiry = (capturedAt = new Date()) =>
  new Date(capturedAt.getTime() + EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

/**
 * Determine whether this violation should trigger a lock.
 * Uses counts from the DB (real violations for this user in the session window)
 * to prevent clients from faking the warningNumber.
 */
const shouldLockForViolation = async ({ userId, violationType, warningNumber, sessionData = {} }) => {
  if (violationType === 'mobile_detected') return true;

  if (violationType === 'copy_attempt') {
    return Number(sessionData.copyAttempts || 0) >= 5 || Number(warningNumber || 0) >= 5;
  }

  // For camera-based violations, count real logs from DB in the session window.
  const sessionStart = new Date(Date.now() - SESSION_WINDOW_MS);
  const dbCount = await MalpracticeLog.countDocuments({
    userId,
    violationType,
    createdAt: { $gte: sessionStart },
  });

  // Use whichever is higher — client or server count — for safety.
  const effectiveCount = Math.max(Number(warningNumber || 0), dbCount);

  if (violationType === 'tab_switch') return effectiveCount >= 3;
  if (violationType === 'gaze_away') return effectiveCount >= 3;
  if (violationType === 'multiple_faces') return effectiveCount >= 3;

  return effectiveCount >= 3;
};

const deriveRiskLevel = ({ violationType, warningNumber, sessionData = {} }) => {
  if (violationType === 'mobile_detected') return 'HIGH';
  if (violationType === 'multiple_faces') return Number(warningNumber || 0) >= 3 ? 'HIGH' : 'MEDIUM';
  if (violationType === 'tab_switch') return Number(sessionData.tabSwitches || 0) >= 3 ? 'HIGH' : 'LOW';
  if (violationType === 'copy_attempt') {
    if (Number(sessionData.copyAttempts || 0) >= 5 || Number(warningNumber || 0) >= 5) return 'HIGH';
    return Number(warningNumber || 0) >= 3 ? 'MEDIUM' : 'LOW';
  }
  if (violationType === 'gaze_away') {
    if (Number(warningNumber || 0) >= 3) return 'HIGH';
    return Number(warningNumber || 0) >= 2 ? 'MEDIUM' : 'LOW';
  }
  return Number(warningNumber || 0) >= 3 ? 'HIGH' : 'MEDIUM';
};

const persistEvidenceForLog = async ({ log, user, imageData, sessionType, violationType, riskLevel, confidence }) => {
  const parsed = decodeBase64Image(imageData);
  if (!parsed || !parsed.buffer?.length || parsed.byteLength > MAX_IMAGE_BYTES) {
    return { storedOnLog: false, storedInEvidence: false, evidenceCount: Number(log.evidenceCount || 0), latestEvidenceAt: log.latestEvidenceAt || null, latestEvidenceTrigger: log.latestEvidenceTrigger || '', hasEvidence: Boolean(log.hasEvidence) };
  }

  log.violationImage = parsed.dataUrl;

  if (!user.institutionId) {
    log.hasEvidence = false;
    log.evidenceCount = Number(log.evidenceCount || 0);
    return { storedOnLog: true, storedInEvidence: false, evidenceCount: Number(log.evidenceCount || 0), latestEvidenceAt: log.latestEvidenceAt || null, latestEvidenceTrigger: log.latestEvidenceTrigger || '', hasEvidence: false };
  }

  const capturedAt = new Date();
  await MonitoringEvidence.create({
    monitoringSessionId: log.monitoringSessionId || null,
    malpracticeLogId: log._id,
    institutionId: user.institutionId,
    userId: user._id,
    sessionType,
    triggerCode: VIOLATION_TRIGGER_CODES[violationType] || String(violationType || 'MALPRACTICE').toUpperCase(),
    riskLevel,
    capturedAt,
    expiresAt: buildEvidenceExpiry(capturedAt),
    contentType: 'image/jpeg',
    imageBuffer: parsed.buffer,
    width: 0,
    height: 0,
    modelSource: 'heuristic',
    confidence: normalizeConfidence(confidence),
  });

  const evidenceCount = await MonitoringEvidence.countDocuments({ malpracticeLogId: log._id });
  log.hasEvidence = true;
  log.evidenceCount = evidenceCount;
  log.latestEvidenceAt = capturedAt;
  log.latestEvidenceTrigger = VIOLATION_TRIGGER_CODES[violationType] || String(violationType || '').toUpperCase();

  return { storedOnLog: true, storedInEvidence: true, evidenceCount, latestEvidenceAt: capturedAt, latestEvidenceTrigger: log.latestEvidenceTrigger, hasEvidence: true };
};

const sanitizeSessionData = (sessionData = {}) => ({
  ipAddress: '',
  tabSwitches: Number(sessionData.tabSwitches || 0),
  copyAttempts: Number(sessionData.copyAttempts || 0),
  windowBlurCount: Number(sessionData.windowBlurCount || 0),
  gazeWarnings: Number(sessionData.gazeWarnings || 0),
  faceWarnings: Number(sessionData.faceWarnings || 0),
  deviceDetections: Number(sessionData.deviceDetections || 0),
  avgAnswerTime: Number(sessionData.avgAnswerTime || 0),
  timingStdDev: Number(sessionData.timingStdDev || 0),
  totalQuestions: Number(sessionData.totalQuestions || 0),
  changedAnswers: Number(sessionData.changedAnswers || 0),
});

const normalizePagination = (page, limit) => {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 20)));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

// ─── Route handlers ─────────────────────────────────────────────────────────

/**
 * GET /malpractice/check-lock?sessionType=assessment|diagnostic
 * Returns the lock state for the specific session type only.
 */
const checkLockStatus = async (req, res, next) => {
  try {
    const sessionType = ALLOWED_SESSION_TYPES.has(req.query.sessionType)
      ? req.query.sessionType
      : 'assessment';

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const lockState = buildLockResponse(user, sessionType);

    // Auto-clear expired locks in the DB.
    if (!lockState.isLocked) {
      const field = LOCK_FIELD[sessionType];
      if (user[field]?.isLocked) {
        clearLock(user, sessionType);
        await user.save();
      }
    }

    return res.json(lockState);
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /malpractice/report-violation
 * Records a violation for the correct session type. Includes:
 * - 8-second server-side dedup to prevent duplicate logs
 * - DB-count-based lock threshold (not trusting client warningNumber alone)
 * - Separate lock fields per sessionType
 */
const reportViolation = async (req, res, next) => {
  try {
    const {
      violationType,
      confidence,
      detectedObject = '',
      violationImage = '',
      sessionType,
      assessmentId = '',
      topicId = null,
      warningNumber = 0,
      sessionData = {},
    } = req.body || {};

    if (!ALLOWED_VIOLATION_TYPES.has(violationType)) {
      return res.status(400).json({ success: false, message: 'Invalid violationType' });
    }

    const resolvedSessionType = ALLOWED_SESSION_TYPES.has(sessionType) ? sessionType : 'assessment';

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const now = Date.now();

    // Auto-clear expired lock for this session type.
    const currentLock = buildLockResponse(user, resolvedSessionType, now);
    if (!currentLock.isLocked && user[LOCK_FIELD[resolvedSessionType]]?.isLocked) {
      clearLock(user, resolvedSessionType);
    }

    // If already locked, return the existing lock state without creating a new log.
    if (currentLock.isLocked) {
      return res.json({
        success: true,
        isLocked: true,
        lockApplied: false,
        isDuplicate: true,
        warningNumber: Number(warningNumber || 0),
        riskLevel: 'HIGH',
        lockedUntil: currentLock.lockedUntil,
        timeRemainingMs: currentLock.timeRemainingMs,
        timeRemainingFormatted: currentLock.timeRemainingFormatted,
        lockReason: currentLock.lockReason,
        lockCount: currentLock.lockCount,
        sessionType: resolvedSessionType,
      });
    }

    // ── Server-side deduplication ──────────────────────────────────────────
    // Only dedup if this is the EXACT same warning number (prevents double-logging).
    // Different warning numbers are legitimate new events.
    const dedupCutoff = new Date(now - DEDUP_WINDOW_MS);
    const recentDuplicate = await MalpracticeLog.findOne({
      userId: user._id,
      violationType,
      warningNumber,  // Only dedup if same warning number
      createdAt: { $gte: dedupCutoff },
    }).lean();

    if (recentDuplicate) {
      const freshLock = buildLockResponse(user, resolvedSessionType, now);
      return res.json({
        success: true,
        isLocked: freshLock.isLocked,
        lockApplied: false,
        isDuplicate: true,
        warningNumber: Number(warningNumber || 0),
        riskLevel: 'LOW',
        lockedUntil: freshLock.lockedUntil,
        timeRemainingMs: freshLock.timeRemainingMs,
        timeRemainingFormatted: freshLock.timeRemainingFormatted,
        lockReason: freshLock.lockReason,
        lockCount: freshLock.lockCount,
        sessionType: resolvedSessionType,
      });
    }

    // ── Determine risk level and lock decision ────────────────────────────
    const normalizedSessionData = sanitizeSessionData(sessionData);
    const normalizedConfidence = normalizeConfidence(confidence);
    const riskLevel = deriveRiskLevel({ violationType, warningNumber, sessionData: normalizedSessionData });

    const lockApplied = await shouldLockForViolation({
      userId: user._id,
      violationType,
      warningNumber,
      sessionData: normalizedSessionData,
    });

    // ── Create the log ────────────────────────────────────────────────────
    const logPayload = {
      userId: user._id,
      institutionId: user.institutionId || null,
      sessionType: resolvedSessionType,
      assessmentReference: String(assessmentId || ''),
      violationType,
      confidence: normalizedConfidence,
      detectedObject: String(detectedObject || '').trim(),
      warningNumber: Number(warningNumber || 0),
      resultedInLock: lockApplied,
      riskLevel,
      riskScore: normalizedConfidence,
      flags: [String(violationType).toUpperCase()],
      reasons: [String(violationType).replace(/_/g, ' ')],
      sourceFlags: ['browser', 'vision'],
      finalFlagged: lockApplied,
      warningCount: Number(warningNumber || 0),
      warningLimit: violationType === 'copy_attempt' ? 5 : 3,
      sessionData: normalizedSessionData,
      hasEvidence: false,
      evidenceCount: 0,
      latestEvidenceAt: null,
      latestEvidenceTrigger: '',
    };

    if (topicId && mongoose.Types.ObjectId.isValid(topicId)) {
      logPayload.topicId = topicId;
    }
    if (assessmentId && mongoose.Types.ObjectId.isValid(assessmentId)) {
      logPayload.assessmentId = assessmentId;
    }

    const log = await MalpracticeLog.create(logPayload);
    await persistEvidenceForLog({
      log,
      user,
      imageData: violationImage,
      sessionType: resolvedSessionType,
      violationType,
      riskLevel,
      confidence: normalizedConfidence,
    });

    // ── Apply lock to the correct field ──────────────────────────────────
    if (lockApplied) {
      const field = LOCK_FIELD[resolvedSessionType];
      user[field] = {
        isLocked: true,
        lockedUntil: new Date(now + LOCK_DURATION_MS),
        lockReason: violationType,
        lockCount: Number(user[field]?.lockCount || 0) + 1,
      };
    }

    await Promise.all([log.save(), user.save()]);
    const freshLock = buildLockResponse(user, resolvedSessionType, Date.now());

    return res.json({
      success: true,
      isLocked: freshLock.isLocked,
      lockApplied,
      warningNumber: Number(warningNumber || 0),
      riskLevel,
      lockedUntil: freshLock.lockedUntil,
      timeRemainingMs: freshLock.timeRemainingMs,
      timeRemainingFormatted: freshLock.timeRemainingFormatted,
      lockReason: freshLock.lockReason,
      lockCount: freshLock.lockCount,
      sessionType: resolvedSessionType,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /institution/malpractice/unlock  (institution-protected)
 * Unlocks a student from either or both session types.
 */
const unlockStudent = async (req, res, next) => {
  try {
    const { studentId, sessionType } = req.body || {};

    if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'A valid studentId is required' });
    }

    const student = await User.findById(studentId);
    if (!student || String(student.institutionId || '') !== String(req.institution._id)) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (sessionType && ALLOWED_SESSION_TYPES.has(sessionType)) {
      clearLock(student, sessionType);
    } else {
      // If no sessionType specified, unlock both.
      clearLock(student, 'assessment');
      clearLock(student, 'diagnostic');
    }

    await student.save();
    return res.json({ success: true, message: 'Student unlocked' });
  } catch (error) {
    return next(error);
  }
};

const getInstitutionMalpracticeLogs = async (req, res, next) => {
  try {
    const { page, limit, riskLevel, violationType, search = '', from = '', to = '' } = req.query || {};
    const paging = normalizePagination(page, limit);
    const query = { institutionId: req.institution._id };

    if (riskLevel && riskLevel !== 'ALL') query.riskLevel = String(riskLevel).toUpperCase();
    if (violationType && violationType !== 'all') query.violationType = String(violationType);

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const users = await User.find({
        institutionId: req.institution._id,
        $or: [{ name: regex }, { username: regex }, { email: regex }],
      }).select('_id');
      const ids = users.map((item) => item._id);
      query.userId = ids.length ? { $in: ids } : { $in: [] };
    }

    const [totalCount, logs] = await Promise.all([
      MalpracticeLog.countDocuments(query),
      MalpracticeLog.find(query)
        .populate('userId', 'name username email assessmentLock diagnosticLock')
        .sort({ createdAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
    ]);

    const logIds = logs.map((log) => log._id);
    const latestEvidence = logIds.length
      ? await MonitoringEvidence.aggregate([
          { $match: { malpracticeLogId: { $in: logIds } } },
          { $sort: { capturedAt: -1, _id: -1 } },
          { $group: { _id: '$malpracticeLogId', evidenceId: { $first: '$_id' }, capturedAt: { $first: '$capturedAt' } } },
        ])
      : [];

    const evidenceMap = new Map(latestEvidence.map((item) => [String(item._id), item]));
    const nowTs = Date.now();

    const responseLogs = logs.map((log) => {
      // Determine which lock field is relevant for this log's session type.
      const relevantLock = log.sessionType === 'diagnostic'
        ? (log.userId?.diagnosticLock || {})
        : (log.userId?.assessmentLock || {});
      const lockedUntilTime = relevantLock.lockedUntil ? new Date(relevantLock.lockedUntil).getTime() : 0;
      const evidence = evidenceMap.get(String(log._id));

      return {
        _id: log._id,
        userId: log.userId ? {
          _id: log.userId._id,
          name: log.userId.name || log.userId.username || 'Unknown Student',
          username: log.userId.username || '',
          email: log.userId.email || '',
        } : null,
        violationType: log.violationType || null,
        confidence: Number(log.confidence || 0),
        detectedObject: log.detectedObject || '',
        riskLevel: log.riskLevel,
        resultedInLock: Boolean(log.resultedInLock),
        warningNumber: Number(log.warningNumber || log.warningCount || 0),
        createdAt: log.createdAt,
        sessionType: log.sessionType,
        sessionData: log.sessionData || {},
        hasEvidence: Boolean(log.hasEvidence || evidence),
        evidenceCount: Number(log.evidenceCount || 0),
        latestEvidenceId: evidence?.evidenceId || null,
        latestEvidenceAt: evidence?.capturedAt || log.latestEvidenceAt || null,
        isCurrentlyLocked: Boolean(relevantLock.isLocked && lockedUntilTime > nowTs),
        lockedUntil: relevantLock.lockedUntil || null,
        lockReason: relevantLock.lockReason || '',
        lockCount: Number(relevantLock.lockCount || 0),
      };
    });

    return res.json({
      success: true,
      logs: responseLogs,
      totalCount,
      currentPage: paging.page,
      totalPages: Math.max(1, Math.ceil(totalCount / paging.limit)),
    });
  } catch (error) {
    return next(error);
  }
};

const getInstitutionMalpracticeStats = async (req, res, next) => {
  try {
    const institutionId = req.institution._id;
    const now = new Date();

    const [
      totalViolations,
      highRiskCount,
      mobileDetections,
      tabSwitchCount,
      lockedStudentsCount,
      topOffendersRaw,
      recentAlerts,
    ] = await Promise.all([
      MalpracticeLog.countDocuments({ institutionId }),
      MalpracticeLog.countDocuments({ institutionId, riskLevel: 'HIGH' }),
      MalpracticeLog.countDocuments({ institutionId, violationType: 'mobile_detected' }),
      MalpracticeLog.countDocuments({ institutionId, violationType: 'tab_switch' }),
      User.countDocuments({
        institutionId,
        $or: [
          { 'assessmentLock.isLocked': true, 'assessmentLock.lockedUntil': { $gt: now } },
          { 'diagnosticLock.isLocked': true, 'diagnosticLock.lockedUntil': { $gt: now } },
        ],
      }),
      MalpracticeLog.aggregate([
        { $match: { institutionId } },
        { $group: { _id: '$userId', violationCount: { $sum: 1 } } },
        { $sort: { violationCount: -1, _id: 1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { _id: 0, userId: '$user._id', username: { $ifNull: ['$user.name', '$user.username'] }, violationCount: 1 } },
      ]),
      MalpracticeLog.find({ institutionId })
        .populate('userId', 'name username email')
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean(),
    ]);

    return res.json({
      success: true,
      totalViolations,
      highRiskCount,
      lockedStudentsCount,
      mobileDetections,
      tabSwitchCount,
      topOffenders: topOffendersRaw,
      recentAlerts: recentAlerts.map((log) => ({
        _id: log._id,
        userId: log.userId ? {
          _id: log.userId._id,
          name: log.userId.name || log.userId.username || 'Unknown Student',
          username: log.userId.username || '',
          email: log.userId.email || '',
        } : null,
        violationType: log.violationType || null,
        riskLevel: log.riskLevel,
        createdAt: log.createdAt,
        resultedInLock: Boolean(log.resultedInLock),
        sessionType: log.sessionType,
      })),
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  checkLockStatus,
  getInstitutionMalpracticeLogs,
  getInstitutionMalpracticeStats,
  reportViolation,
  unlockStudent,
};
