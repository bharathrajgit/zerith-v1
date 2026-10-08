// server/controllers/institution.analytics.controller.js
const User = require('../models/User');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Streak = require('../models/Streak');
const PerformanceLog = require('../models/PerformanceLog');
const MalpracticeLog = require('../models/MalpracticeLog');
const MonitoringEvidence = require('../models/MonitoringEvidence');
const Institution = require('../models/Institution');
const MonitoringSession = require('../models/MonitoringSession');
const {
  applyEvidenceSummaryToLog,
  backfillEvidenceLogLink,
} = require('../services/monitoringService');
const { syncInstitutionRoster } = require('../services/institutionRosterService');

// ─── Helper: get students of the institution ────────
const getStudents = async (institutionId, additionalFilter = {}) => {
  return User.find({ institutionId, ...additionalFilter }).select(
    'name email currentLevel placementReadiness lastActiveAt diagnosticCompleted departmentCode studentSource'
  ).lean();
};

// ─── Helper: active in last N days ─────────────────
const activeInDays = (lastActiveAt, days) => {
  if (!lastActiveAt) return false;
  const limit = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return new Date(lastActiveAt) >= limit;
};

// @desc    Dashboard overview for institution
// @route   GET /api/institution/analytics/overview
// @access  Private (Institution)
const getDashboardOverview = async (req, res, next) => {
  try {
    const institutionId = req.institution._id;
    const allStudents = await getStudents(institutionId);
    const totalStudents = allStudents.length;
    if (totalStudents === 0) {
      return res.json({
        success: true,
        data: {
          totalStudents: 0,
          activeToday: 0,
          activeThisWeek: 0,
          inactiveStudents: 0,
          avgPlacementReadiness: 0,
          levelDistribution: { Beginner: 0, Intermediate: 0, PlacementReady: 0 },
          diagnosticCompleted: 0,
          diagnosticPending: 0,
          atRiskStudents: 0,
        },
      });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date().setDate(now.getDate() - 7);
    const sevenDaysAgo = new Date(weekAgo);

    let activeToday = 0;
    let activeThisWeek = 0;
    let diagnosticCompleted = 0;
    let diagnosticPending = 0;
    let levelCounts = { Beginner: 0, Intermediate: 0, 'Placement-Ready': 0 };
    let readinessSum = 0;
    let readinessCount = 0;
    let atRisk = 0;

    allStudents.forEach(s => {
      if (activeInDays(s.lastActiveAt, 1)) activeToday++;
      if (activeInDays(s.lastActiveAt, 7)) activeThisWeek++;

      if (s.diagnosticCompleted) diagnosticCompleted++;
      else diagnosticPending++;

      if (s.currentLevel) {
        levelCounts[s.currentLevel] = (levelCounts[s.currentLevel] || 0) + 1;
      }

      if (s.placementReadiness != null) {
        readinessSum += s.placementReadiness;
        readinessCount++;
      }
      if (s.placementReadiness !== undefined && s.placementReadiness < 40) {
        atRisk++;
      }
    });

    const inactiveStudents = totalStudents - activeThisWeek;
    const avgPlacementReadiness = readinessCount > 0 ? Math.round(readinessSum / readinessCount) : 0;

    res.json({
      success: true,
      data: {
        totalStudents,
        activeToday,
        activeThisWeek,
        inactiveStudents,
        avgPlacementReadiness,
        levelDistribution: {
          Beginner: levelCounts['Beginner'] || 0,
          Intermediate: levelCounts['Intermediate'] || 0,
          'Placement-Ready': levelCounts['Placement-Ready'] || 0,
        },
        diagnosticCompleted,
        diagnosticPending,
        atRiskStudents: atRisk,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Analytics per department
// @route   GET /api/institution/analytics/departments
// @access  Private (Institution)
const getDepartmentAnalytics = async (req, res, next) => {
  try {
    await syncInstitutionRoster(req.institution._id);
    const institution = await Institution.findById(req.institution._id);
    if (!institution) throw new Error('Institution not found');

    const deptResults = [];
    for (const dept of institution.departments) {
      const students = await getStudents(institution._id, { departmentCode: dept.code });
      const total = students.length;
      if (total === 0) {
        deptResults.push({ name: dept.name, code: dept.code, totalStudents: 0 });
        continue;
      }

      let activeToday = 0, activeThisWeek = 0, diagnosticDone = 0, readinessSum = 0, atRisk = 0;
      let levels = { Beginner: 0, Intermediate: 0, 'Placement-Ready': 0 };
      const studentList = [];

      students.forEach(s => {
        if (activeInDays(s.lastActiveAt, 1)) activeToday++;
        if (activeInDays(s.lastActiveAt, 7)) activeThisWeek++;
        if (s.diagnosticCompleted) diagnosticDone++;
        if (s.currentLevel) levels[s.currentLevel] = (levels[s.currentLevel] || 0) + 1;
        if (s.placementReadiness != null) readinessSum += s.placementReadiness;
        if (s.placementReadiness !== undefined && s.placementReadiness < 40) atRisk++;
        studentList.push({
          _id: s._id,
          name: s.name,
          email: s.email,
          placementReadiness: s.placementReadiness || 0,
          lastActiveAt: s.lastActiveAt,
          studentSource: s.studentSource,
          currentLevel: s.currentLevel,
        });
      });

      const avgReadiness = total > 0 ? Math.round(readinessSum / total) : 0;

      // Top 5 & bottom 5 performers
      const sorted = [...studentList].sort((a, b) => b.placementReadiness - a.placementReadiness);
      const topPerformers = sorted.slice(0, 5);
      const bottomPerformers = [...sorted].reverse().slice(0, 5);

      // Weekly progress trend: active student counts for last 7 days
      const weeklyTrend = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const activeCount = studentList.filter(s => {
          if (!s.lastActiveAt) return false;
          const t = new Date(s.lastActiveAt);
          return t >= dayStart && t < dayEnd;
        }).length;
        weeklyTrend.push({
          date: dayStart.toISOString().split('T')[0],
          active: activeCount,
        });
      }

      deptResults.push({
        name: dept.name,
        code: dept.code,
        totalStudents: total,
        activeToday,
        activeThisWeek,
        diagnosticCompleted: diagnosticDone,
        diagnosticPending: total - diagnosticDone,
        avgPlacementReadiness: avgReadiness,
        levelDistribution: {
          Beginner: levels['Beginner'] || 0,
          Intermediate: levels['Intermediate'] || 0,
          'Placement-Ready': levels['Placement-Ready'] || 0,
        },
        atRiskStudents: atRisk,
        topPerformers,
        bottomPerformers,
        weeklyProgressTrend: weeklyTrend,
      });
    }

    res.json({ success: true, data: deptResults });
  } catch (err) {
    next(err);
  }
};

// @desc    Comprehensive student report
// @route   GET /api/institution/analytics/student/:studentId
// @access  Private (Institution)
const getStudentDetailReport = async (req, res, next) => {
  try {
    const student = await User.findById(req.params.studentId).select('-password');
    if (!student || student.institutionId?.toString() !== req.institution._id.toString()) {
      return res.status(403).json({ success: false, message: 'Student not in your institution' });
    }

    // Progress on all topics
    const progressDocs = await Progress.find({ userId: student._id })
      .populate('topicId', 'title order')
      .populate('moduleId', 'title order')
      .lean();

    // Assessment history
    const assessments = await Assessment.find({ userId: student._id })
      .sort({ completedAt: -1 })
      .limit(50)
      .populate('topicId', 'title')
      .lean();

    // Streak info
    const streak = await Streak.findOne({ userId: student._id }).lean();

    // Performance logs (last 30)
    const perfLogs = await PerformanceLog.find({ userId: student._id })
      .sort({ sessionDate: -1 })
      .limit(30)
      .lean();

    res.json({
      success: true,
      data: {
        profile: {
          _id: student._id,
          name: student.name,
          email: student.email,
          currentLevel: student.currentLevel,
          placementReadiness: student.placementReadiness,
          diagnosticCompleted: student.diagnosticCompleted,
          diagnosticScore: student.diagnosticScore,
          totalProblemsSolved: student.totalProblemsSolved,
          totalMCQAttempted: student.totalMCQAttempted,
          totalMCQCorrect: student.totalMCQCorrect,
          currentStreak: student.currentStreak,
          longestStreak: student.longestStreak,
          lastActiveAt: student.lastActiveAt,
          departmentCode: student.departmentCode,
          studentSource: student.studentSource,
        },
        topicsProgress: progressDocs.map(p => ({
          topic: p.topicId?.title || 'Unknown',
          module: p.moduleId?.title || 'Unknown',
          status: p.status,
          masteryScore: p.masteryScore,
          round1Score: p.round1Score,
          round2Score: p.round2Score,
          round3Score: p.round3Score,
          codingScore: p.codingScore,
          totalAttempts: p.totalAttempts,
          hintsUsed: p.hintsUsed,
          timeSpentMinutes: p.timeSpentMinutes,
          weakAreas: p.weakAreas || [],
        })),
        assessmentHistory: assessments.slice(0, 20), // last 20 assessments
        streak: streak ? {
          currentStreak: streak.currentStreak,
          longestStreak: streak.longestStreak,
          totalActiveDays: streak.totalActiveDays,
          weeklyActivity: streak.weeklyActivity,
        } : null,
        performanceLogs: perfLogs,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    At-risk students with reasons
// @route   GET /api/institution/analytics/at-risk
// @access  Private (Institution)
const getAtRiskStudents = async (req, res, next) => {
  try {
    const institutionId = req.institution._id;
    const allStudents = await User.find({ institutionId }).select('name email placementReadiness lastActiveAt').lean();

    // Find students who failed a topic 3+ times
    const repeatedFailures = await Progress.aggregate([
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.institutionId': institutionId, totalAttempts: { $gte: 3 }, status: { $ne: 'Completed' } } },
      { $group: { _id: '$userId' } }
    ]);
    const failureIds = new Set(repeatedFailures.map(f => f._id.toString()));

    const atRiskList = [];
    for (const s of allStudents) {
      const reasons = [];
      if (s.placementReadiness !== undefined && s.placementReadiness < 40) reasons.push('Low readiness (<40)');
      if (s.lastActiveAt) {
        const daysSince = Math.floor((Date.now() - new Date(s.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince >= 5) reasons.push(`Inactive for ${daysSince} days`);
      } else {
        reasons.push('No activity recorded');
      }
      if (failureIds.has(s._id.toString())) reasons.push('Failed same topic 3+ times');

      if (reasons.length > 0) {
        const severity = reasons.includes('Low readiness (<40)') ? 'HIGH' :
                         reasons.includes('Failed same topic 3+ times') ? 'HIGH' :
                         reasons.some(r => r.startsWith('Inactive')) ? 'MEDIUM' : 'LOW';
        atRiskList.push({
          _id: s._id,
          name: s.name,
          email: s.email,
          placementReadiness: s.placementReadiness || 0,
          lastActiveAt: s.lastActiveAt,
          reasons,
          severity,
        });
      }
    }

    atRiskList.sort((a, b) => {
      const sevOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return sevOrder[b.severity] - sevOrder[a.severity];
    });

    res.json({ success: true, data: atRiskList });
  } catch (err) {
    next(err);
  }
};

// @desc    Malpractice report for the institution
// @route   GET /api/institution/analytics/malpractice
// @access  Private (Institution)
const getMalpracticeReport = async (req, res, next) => {
  try {
    const logs = await MalpracticeLog.find({ institutionId: req.institution._id })
      .populate('userId', 'name email')
      .populate('assessmentId', 'topicId completedAt')
      .populate('monitoringSessionId', 'sessionType finalStatus warningCount warningLimit')
      .sort({ createdAt: -1 })
      .lean();
    const high = logs.filter(l => l.riskLevel === 'HIGH');
    const medium = logs.filter(l => l.riskLevel === 'MEDIUM');
    const low = logs.filter(l => l.riskLevel === 'LOW');
    res.json({
      success: true,
      data: {
        high,
        medium,
        low,
        summary: {
          total: logs.length,
          highCount: high.length,
          mediumCount: medium.length,
          lowCount: low.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Evidence metadata for a malpractice log
// @route   GET /api/institution/analytics/malpractice/:logId/evidence
// @access  Private (Institution)
const getMalpracticeEvidence = async (req, res, next) => {
  try {
    const log = await MalpracticeLog.findOne({
      _id: req.params.logId,
      institutionId: req.institution._id,
    }).select('_id monitoringSessionId hasEvidence');

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Malpractice log not found',
      });
    }

    if (log.monitoringSessionId) {
      await backfillEvidenceLogLink(log.monitoringSessionId, log._id);
    }

    const evidenceDocs = await MonitoringEvidence.find({
      malpracticeLogId: log._id,
    })
      .sort({ capturedAt: -1, _id: -1 })
      .select('capturedAt triggerCode riskLevel confidence')
      .lean();

    if (!evidenceDocs.length && log.monitoringSessionId) {
      await applyEvidenceSummaryToLog(log._id, log.monitoringSessionId);
    }

    res.json({
      success: true,
      data: evidenceDocs.map((item) => ({
        id: item._id,
        capturedAt: item.capturedAt,
        triggerCode: item.triggerCode,
        riskLevel: item.riskLevel,
        confidence: Number(item.confidence || 0),
        imageUrl: `/institution/analytics/malpractice/evidence/${item._id}/image`,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Stream malpractice evidence image
// @route   GET /api/institution/analytics/malpractice/evidence/:evidenceId/image
// @access  Private (Institution)
const streamMalpracticeEvidenceImage = async (req, res, next) => {
  try {
    const evidence = await MonitoringEvidence.findById(req.params.evidenceId)
      .select('institutionId userId monitoringSessionId malpracticeLogId contentType imageBuffer');

    if (!evidence) {
      return res.status(404).json({
        success: false,
        message: 'Evidence image not found',
      });
    }

    if (String(evidence.institutionId) !== String(req.institution._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    if (evidence.malpracticeLogId) {
      const log = await MalpracticeLog.findOne({
        _id: evidence.malpracticeLogId,
        institutionId: req.institution._id,
      }).select('_id');
      if (!log) {
        return res.status(404).json({
          success: false,
          message: 'Evidence image not found',
        });
      }
    }

    res.setHeader('Content-Type', evidence.contentType || 'image/jpeg');
    res.setHeader('Content-Length', evidence.imageBuffer?.length || 0);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).end(evidence.imageBuffer);
  } catch (err) {
    next(err);
  }
};

// @desc    Placement prediction timeline for students
// @route   GET /api/institution/analytics/placement-prediction
// @access  Private (Institution)
const getPlacementPredictionReport = async (req, res, next) => {
  try {
    await syncInstitutionRoster(req.institution._id);
    const institutionId = req.institution._id;
    const institution = await Institution.findById(institutionId).select('departments').lean();
    const students = await User.find({ institutionId }).select(
      'name email placementReadiness currentLevel lastActiveAt departmentCode studentSource'
    ).lean();

    const predictions = [];
    for (const s of students) {
      const readiness = s.placementReadiness || 0;
      if (readiness >= 80) {
        predictions.push({
          student: s,
          timeline: 'ready_now',
          estimatedDays: 0,
          dailyProgressRate: null,
        });
        continue;
      }

      // Compute daily progress rate from performance logs
      const logs = await PerformanceLog.find({ userId: s._id }).sort({ sessionDate: 1 }).lean();
      let rate = 0;
      if (logs.length >= 2) {
        const first = logs[0];
        const last = logs[logs.length - 1];
        const daysDiff = (new Date(last.sessionDate) - new Date(first.sessionDate)) / (1000 * 60 * 60 * 24);
        const scoreDiff = (last.masteryScore || 0) - (first.masteryScore || 0);
        if (daysDiff > 0) rate = scoreDiff / daysDiff;
      }
      // Fallback rate if insufficient data
      if (rate <= 0) rate = 0.5; // default small improvement assumption

      const remaining = 80 - readiness;
      const estimatedDays = Math.max(1, Math.ceil(remaining / rate));

      let timeline;
      if (estimatedDays <= 30) timeline = 'within_30_days';
      else if (estimatedDays <= 60) timeline = 'within_60_days';
      else if (estimatedDays <= 90) timeline = 'within_90_days';
      else timeline = 'needs_more_time';

      predictions.push({
        student: s,
        timeline,
        estimatedDays,
        dailyProgressRate: Math.round(rate * 100) / 100,
      });
    }

    const groups = {
      ready_now: predictions.filter(p => p.timeline === 'ready_now'),
      within_30_days: predictions.filter(p => p.timeline === 'within_30_days'),
      within_60_days: predictions.filter(p => p.timeline === 'within_60_days'),
      within_90_days: predictions.filter(p => p.timeline === 'within_90_days'),
      needs_more_time: predictions.filter(p => p.timeline === 'needs_more_time'),
    };

    const byDepartment = (institution?.departments || []).map((department) => {
      const departmentPredictions = predictions.filter(
        (entry) => entry.student.departmentCode === department.code
      );
      return {
        code: department.code,
        name: department.name,
        readyNow: departmentPredictions.filter((entry) => entry.timeline === 'ready_now').length,
        within30: departmentPredictions.filter((entry) => entry.timeline === 'within_30_days').length,
        within60: departmentPredictions.filter((entry) => entry.timeline === 'within_60_days').length,
        within90: departmentPredictions.filter((entry) => entry.timeline === 'within_90_days').length,
        needsMore: departmentPredictions.filter((entry) => entry.timeline === 'needs_more_time').length,
        totalStudents: departmentPredictions.length,
      };
    });

    res.json({
      success: true,
      data: {
        groups,
        byDepartment,
        summary: {
          readyNow: groups.ready_now.length,
          within30: groups.within_30_days.length,
          within60: groups.within_60_days.length,
          within90: groups.within_90_days.length,
          needsMore: groups.needs_more_time.length,
          totalStudents: predictions.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update malpractice review status
// @route   PATCH /api/institution/analytics/malpractice/:logId/status
// @access  Private (Institution)
const updateMalpracticeStatus = async (req, res, next) => {
  try {
    const { status, reviewNote = '' } = req.body;
    const allowedStatuses = ['reviewed', 'dismissed', 'confirmed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of ${allowedStatuses.join(', ')}`,
      });
    }

    const log = await MalpracticeLog.findOne({
      _id: req.params.logId,
      institutionId: req.institution._id,
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Malpractice log not found',
      });
    }

    log.status = status;
    log.reviewNote = String(reviewNote || '').trim();
    await log.save();
    const monitoringSessionId = log.monitoringSessionId?._id || log.monitoringSessionId || null;
    await log.populate('userId', 'name email');
    await log.populate('assessmentId', 'topicId completedAt');
    await log.populate('monitoringSessionId', 'sessionType finalStatus warningCount warningLimit');

    if (monitoringSessionId) {
      await MonitoringSession.findByIdAndUpdate(monitoringSessionId, {
        finalStatus: status,
      });
    }

    res.json({
      success: true,
      data: log,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardOverview,
  getDepartmentAnalytics,
  getStudentDetailReport,
  getAtRiskStudents,
  getMalpracticeReport,
  getMalpracticeEvidence,
  getPlacementPredictionReport,
  streamMalpracticeEvidenceImage,
  updateMalpracticeStatus,
};
