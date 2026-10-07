// server/controllers/assessment.controller.js
const Assessment = require('../models/Assessment');
const Progress = require('../models/Progress');
const PerformanceLog = require('../models/PerformanceLog');
const MCQ = require('../models/MCQ');
const CodingProblem = require('../models/CodingProblem');
const User = require('../models/User');
const Topic = require('../models/Topic');
const MonitoringSession = require('../models/MonitoringSession');
const {
  generateRoadmap,
  syncRoadmapForUser,
} = require('../services/roadmapGenerator');
const mlService = require('../services/mlService');
const { getLockedAnswer, clearLocks } = require('../services/mcqAnswerLocks');
const {
  classifyLevel,
  detectWeakAreas,
  getReadinessScore,
  normalizeLevelFromScore,
  buildDiagnosticPerformanceData,
} = mlService;
const {
  calculateAssessmentScore,
  evaluatePass,
  calculateMasteryScore,
  normalizeTopicToModule,
} = require('../services/scoreCalculator');
const { inferPlacementReadiness } = require('../services/userReadinessService');
const { logActivity } = require('../services/streakService');
const {
  buildProgressionForUser,
  getTopicProgressionState,
} = require('../services/progressionService');
const { finalizeSession } = require('../services/monitoringService');
const antiMalpractice = require('../services/antiMalpractice');   // ← NEW

const buildWeakAreaTopicPayload = (progressDoc) => {
  const mcqAccuracy = Math.max(
    0,
    Math.min((progressDoc?.round1Score || 0) / 100, 1)
  );
  const codingAccuracy = (progressDoc?.codingScore || 0) > 0
    ? Math.max(0, Math.min((progressDoc.codingScore || 0) / 100, 1))
    : mcqAccuracy;

  return {
    round1_acc: mcqAccuracy,
    // Keep legacy model inputs populated until the ML service is retrained.
    round2_acc: mcqAccuracy,
    round3_acc: codingAccuracy,
    attempt_count: progressDoc?.totalAttempts || 0,
    hint_rate: progressDoc?.totalAttempts
      ? (progressDoc.hintsUsed || 0) / progressDoc.totalAttempts
      : 0,
  };
};

const normalizeAssessmentSubmissions = (submissions = []) => {
  const deduped = [];
  const indexById = new Map();

  submissions.forEach((submission) => {
    if (!submission?.mcqId) return;

    const key = String(submission.mcqId);
    const normalized = {
      mcqId: submission.mcqId,
      selectedAnswer: submission.selectedAnswer ?? -1,
      timeTaken: Math.max(0, Number(submission.timeTaken) || 0),
      hintsUsed: Math.max(0, Number(submission.hintsUsed) || 0),
    };

    if (indexById.has(key)) {
      deduped[indexById.get(key)] = normalized;
      return;
    }

    indexById.set(key, deduped.length);
    deduped.push(normalized);
  });

  return deduped;
};

// @desc    Submit a regular assessment round
// @route   POST /api/assessment/submit
// @access  Private
const submitAssessment = async (req, res, next) => {
  try {
    // Extract sessionData along with other fields
    const {
      topicId,
      moduleId,
      round,
      submissions,
      sessionData,
      monitoringSessionId,
    } = req.body;

    if (!topicId || !moduleId || !round || !submissions || !submissions.length) {
      return res.status(400).json({
        success: false,
        message: 'topicId, moduleId, round, and submissions are required',
      });
    }

    const validRounds = ['Basic'];
    if (!validRounds.includes(round)) {
      return res.status(400).json({ success: false, message: 'Invalid round' });
    }

    const progression = await buildProgressionForUser(req.user);
    const topicState = getTopicProgressionState(progression, topicId);
    if (!topicState?.topic?.accessible) {
      return res.status(403).json({
        success: false,
        message: 'This topic is not available for your current level.',
      });
    }
    if (!topicState.topic.unlocked) {
      return res.status(403).json({
        success: false,
        message: 'This topic is locked. Complete earlier topics in this course first.',
      });
    }

    const topicDoc = await Topic.findById(topicId).select('moduleId title');
    if (!topicDoc) {
      return res.status(404).json({
        success: false,
        message: 'Topic not found',
      });
    }
    if (String(topicDoc.moduleId) !== String(moduleId)) {
      return res.status(400).json({
        success: false,
        message: 'Topic and module do not match.',
      });
    }

    const normalizedSubmissions = normalizeAssessmentSubmissions(submissions).map((submission) => {
      const lockedAnswer = getLockedAnswer(req.user._id, submission.mcqId);
      return lockedAnswer === undefined ? submission : { ...submission, selectedAnswer: lockedAnswer };
    });
    if (!normalizedSubmissions.length) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid MCQ submission is required',
      });
    }

    // Fetch the full MCQs to get correct answers
    const mcqIds = normalizedSubmissions.map((submission) => submission.mcqId);
    const questions = await MCQ.find({
      _id: { $in: mcqIds },
      topicId,
      moduleId,
      isActive: true,
    });
    if (questions.length !== mcqIds.length) {
      return res.status(404).json({
        success: false,
        message: 'Some MCQs not found',
      });
    }

    // Calculate score
    const scoreResult = calculateAssessmentScore(questions, normalizedSubmissions);
    clearLocks(req.user._id, mcqIds);
    const { passed, passCriteria, requiredCorrectAnswers } = evaluatePass(
      round,
      scoreResult.correctAnswers,
      scoreResult.totalQuestions
    );

    // Save Assessment document
    const assessment = await Assessment.create({
      userId: req.user._id,
      topicId,
      moduleId,
      round,
      questions: scoreResult.questionResults.map((r) => ({
        mcqId: r.mcqId,
        selectedAnswer: r.selectedAnswer,
        isCorrect: r.isCorrect,
        timeTaken: r.timeTaken,
        hintsUsed: normalizedSubmissions.find((s) => s.mcqId.toString() === r.mcqId.toString())?.hintsUsed || 0,
      })),
      totalQuestions: scoreResult.totalQuestions,
      correctAnswers: scoreResult.correctAnswers,
      accuracy: scoreResult.accuracy,
      totalTimeTaken: scoreResult.questionResults.reduce((sum, r) => sum + r.timeTaken, 0),
      averageTimePerQuestion: scoreResult.averageTimeTaken,
      passed,
      attemptNumber: 1,
      completedAt: new Date(),
      monitoringSessionId: monitoringSessionId || null,
    });

    // Update User stats
    const updateUser = {
      $inc: {
        totalMCQAttempted: scoreResult.totalQuestions,
        totalMCQCorrect: scoreResult.correctAnswers,
      },
    };
    await User.findByIdAndUpdate(req.user._id, updateUser);

    // Update Progress document
    let progress = await Progress.findOne({
      userId: req.user._id,
      topicId,
      moduleId,
    });

    if (!progress) {
      progress = await Progress.create({
        userId: req.user._id,
        topicId,
        moduleId,
        status: 'Unlocked',
        round1Score: 0,
        round2Score: 0,
        round3Score: 0,
        codingScore: 0,
        totalAttempts: 0,
        hintsUsed: 0,
        timeSpentMinutes: 0,
        lastAttemptAt: new Date(),
      });
    }

    const hasCodingProblem = await CodingProblem.exists({
      topicId,
      isActive: true,
      hasCoding: { $ne: false },
    });
    const roundField = 'round1Score';
    progress[roundField] = Math.max(progress[roundField], scoreResult.accuracy);
    progress.totalAttempts += 1;
    progress.hintsUsed += normalizedSubmissions.reduce((sum, s) => sum + (s.hintsUsed || 0), 0);
    const timeSpent = scoreResult.questionResults.reduce((sum, r) => sum + r.timeTaken, 0) / 60; // minutes
    progress.timeSpentMinutes += timeSpent;
    progress.lastAttemptAt = new Date();

    if (progress.round1Score >= 80 && (!hasCodingProblem || (progress.codingScore || 0) >= 80)) {
      progress.status = 'Completed';
      progress.completedAt = new Date();
    } else {
      progress.status = 'InProgress';
      progress.completedAt = null;
    }

    await progress.save();
    await syncRoadmapForUser(req.user._id);

    // Mastery score
    const hintUsageRate =
      normalizedSubmissions.reduce((sum, s) => sum + (s.hintsUsed || 0), 0) / normalizedSubmissions.length;
    const { masteryScore, masteryLevel } = calculateMasteryScore(
      progress.round1Score,
      progress.codingScore,
      hintUsageRate,
      progress.totalAttempts - 1
    );

    progress.masteryScore = masteryScore;
    await progress.save();

    await PerformanceLog.create({
      userId: req.user._id,
      topicId,
      moduleId,
      sessionDate: new Date(),
      round1Accuracy: progress.round1Score / 100,
      round2Accuracy: progress.round1Score / 100,
      round3Accuracy: (progress.codingScore || 0) > 0
        ? progress.codingScore / 100
        : progress.round1Score / 100,
      codingAccuracy: progress.codingScore / 100,
      averageResponseTime: scoreResult.averageTimeTaken,
      hintUsageRate,
      attemptCount: progress.totalAttempts,
      masteryScore,
      weakFlag: !passed,
      weakType: null,
    });

    // ─── NEW: Anti‑Malpractice Analysis ────────────────────
    let malpracticeFlag = 'NONE';   // default
    let monitoringSummary = null;
    if (monitoringSessionId) {
      try {
        const monitoringSession = await MonitoringSession.findOne({
          _id: monitoringSessionId,
          userId: req.user._id,
        });

        if (monitoringSession) {
          await finalizeSession(monitoringSession, {
            assessmentId: assessment._id,
            topicId,
            moduleId,
            browserMetrics: sessionData || {},
          });

          malpracticeFlag = monitoringSession.riskLevel || 'NONE';
          monitoringSummary = {
            monitoringSessionId: monitoringSession._id,
            warningCount: monitoringSession.warningCount || 0,
            warningLimit: monitoringSession.warningLimit || 0,
            finalFlagged: !!monitoringSession.finalFlagged,
            riskLevel: monitoringSession.riskLevel || 'NONE',
            signals: monitoringSession.signals || [],
          };
        }
      } catch (monitoringErr) {
        console.error('Monitoring session finalization failed:', monitoringErr);
      }
    } else if (sessionData) {
      try {
        const answersForAnalysis = normalizedSubmissions.map((sub) => ({
          questionId: sub.mcqId,
          selectedOption: sub.selectedAnswer,
          timeToAnswer: sub.timeTaken,
          changedAnswer: false,   // frontend can send this if available
        }));

        const analysisResult = antiMalpractice.analyzeSession({
          answers: answersForAnalysis,
          tabSwitches: sessionData.tabSwitches || 0,
          copyAttempts: sessionData.copyAttempts || 0,
          windowBlurCount: sessionData.windowBlurCount || 0,
          ipAddress: sessionData.ipAddress || req.ip,
        });

        const institutionId = req.user.institutionId || null;
        await antiMalpractice.saveIfSuspicious(
          analysisResult,
          req.user._id,
          assessment._id,
          institutionId,
          {
            answers: answersForAnalysis,
            ...sessionData,
            ipAddress: sessionData.ipAddress || req.ip,
          }
        );

        malpracticeFlag = analysisResult.riskLevel;   // LOW / MEDIUM / HIGH
      } catch (malErr) {
        console.error('Malpractice analysis failed:', malErr);
        malpracticeFlag = 'ERROR';
      }
    }

    // ── Proctor frame analysis (optional) ─────────────────
    try {
      if (sessionData && sessionData.proctorImage) {
        const proctorPayload = {
          imageData: sessionData.proctorImage,
          metadata: {
            userId: String(req.user._id),
            sessionType: 'assessment',
            topicId: topicId || null,
            moduleId: moduleId || null,
          },
        };
        const proctor = await mlService.analyzeProctorFrame(proctorPayload);
        monitoringSummary = monitoringSummary || {};
        monitoringSummary.proctor = proctor;
      }
    } catch (proErr) {
      console.error('Proctor analysis failed:', proErr?.message || proErr);
    }

    // ── ML integration: weak areas & readiness (non‑blocking) ──
    (async () => {
      try {
        const allProgress = await Progress.find({ userId: req.user._id }).populate('topicId', 'title');
        const topicPerformanceList = allProgress.map((p) => ({
          topic_name: p.topicId.title,
          ...buildWeakAreaTopicPayload(p),
        }));

        const weakResult = await detectWeakAreas(topicPerformanceList);

        await PerformanceLog.findOneAndUpdate(
          { userId: req.user._id, topicId, moduleId },
          {
            weakFlag: weakResult.weak_topics.length > 0,
            weakType: weakResult.weak_topics.length > 0 ? 'conceptual' : null,
            errorPatterns: weakResult.weak_topics.map(w => w.topic_name),
          }
        );

        const topicMasteryMap = {};
        allProgress.forEach(p => {
          const normalizedKey = normalizeTopicToModule(p.topicId.title);
          // Use the highest mastery score if multiple topics map to same module
          if (!topicMasteryMap[normalizedKey] || p.masteryScore > topicMasteryMap[normalizedKey]) {
            topicMasteryMap[normalizedKey] = p.masteryScore;
          }
        });
        const readiness = await getReadinessScore(topicMasteryMap);

        await User.findByIdAndUpdate(req.user._id, {
          placementReadiness: readiness.readiness_score || 0,
        });
      } catch (mlErr) {
        console.error('ML update failed:', mlErr.message);
      }
    })().catch(console.error);

    // ── Update streak ─────────────────────────────────────
    await logActivity(req.user._id, 1, Math.round(timeSpent), [
      topicDoc?.title || 'Unknown',
    ]);

    let nextAction = 'review';
    if (passed) {
      nextAction = hasCodingProblem ? 'unlock_coding' : 'completed';
    }

    res.status(200).json({
      success: true,
      data: {
        results: scoreResult.questionResults,
        passed,
        totalQuestions: scoreResult.totalQuestions,
        correctAnswers: scoreResult.correctAnswers,
        requiredCorrectAnswers,
        passCriteria,
        nextAction,
        masteryScore: progress.masteryScore,
        masteryLevel,
        assessmentId: assessment._id,
        monitoring: monitoringSummary,
        malpracticeFlag,      // ← added to response
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Submit diagnostic test (unchanged, but can also integrate if desired)
const submitDiagnostic = async (req, res, next) => {
  try {
    const { submissions } = req.body;
    if (!submissions || !submissions.length) {
      return res.status(400).json({
        success: false,
        message: 'Submissions are required',
      });
    }

    const normalizedSubmissions = normalizeAssessmentSubmissions(submissions).map((submission) => {
      const lockedAnswer = getLockedAnswer(req.user._id, submission.mcqId);
      return lockedAnswer === undefined ? submission : { ...submission, selectedAnswer: lockedAnswer };
    });
    if (!normalizedSubmissions.length) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid MCQ submission is required',
      });
    }

    const mcqIds = normalizedSubmissions.map((submission) => submission.mcqId);
    const questions = await MCQ.find({ _id: { $in: mcqIds }, isActive: true });
    if (questions.length !== mcqIds.length) {
      return res.status(404).json({
        success: false,
        message: 'Some MCQs not found',
      });
    }

    const scoreResult = calculateAssessmentScore(questions, normalizedSubmissions);

    const assessment = await Assessment.create({
      userId: req.user._id,
      topicId: null,
      moduleId: null,
      round: 'Diagnostic',
      questions: scoreResult.questionResults.map((r) => ({
        mcqId: r.mcqId,
        selectedAnswer: r.selectedAnswer,
        isCorrect: r.isCorrect,
        timeTaken: r.timeTaken,
        hintsUsed: 0,
      })),
      totalQuestions: scoreResult.totalQuestions,
      correctAnswers: scoreResult.correctAnswers,
      accuracy: scoreResult.accuracy,
      passed: true,
      completedAt: new Date(),
    });

    let mlLevel = 'Beginner';
    try {
      const perfData = buildDiagnosticPerformanceData(
        {
          totalScore: scoreResult.accuracy,
          perTopicScores: scoreResult.topicWiseScores || {},
          avgTimePerQuestion: scoreResult.averageTimeTaken,
        },
        req.user.currentStreak || 0
      );

      const mlResult = await classifyLevel(perfData);
      if (mlResult && mlResult.level) {
        mlLevel = normalizeLevelFromScore(
          mlResult.level,
          scoreResult.accuracy
        );
      }
    } catch (mlErr) {
      console.error('ML classification failed, fallback:', mlErr.message);
      const score = scoreResult.accuracy;
      if (score >= 70) mlLevel = 'Placement-Ready';
      else if (score >= 50) mlLevel = 'Intermediate';
    }

    const user = await User.findById(req.user._id);
    const readinessScore = inferPlacementReadiness({
      currentLevel: mlLevel,
      diagnosticScore: scoreResult.accuracy,
      diagnosticCompleted: true,
    });

    await User.findByIdAndUpdate(req.user._id, {
      diagnosticCompleted: true,
      diagnosticScore: scoreResult.accuracy,
      currentLevel: mlLevel,
      placementReadiness: readinessScore,
      isProfileComplete: true,
      roadmapGenerated: user.roadmapGenerated || false,
    });

    if (!user.roadmapGenerated || !user.activeRoadmap) {
      try {
        await generateRoadmap(req.user._id, mlLevel, scoreResult);
      } catch (rdErr) {
        console.error('Roadmap generation failed:', rdErr.message);
      }
    }

    await logActivity(req.user._id, 1, 0, ['Diagnostic']);

    res.status(200).json({
      success: true,
      data: {
        score: scoreResult.accuracy,
        level: mlLevel,
        placementReadiness: readinessScore,
        message: 'Your roadmap is being generated',
        diagnosticCompleted: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get assessment history for user
// @route   GET /api/assessment/history
// @access  Private
const getAssessmentHistory = async (req, res, next) => {
  try {
    const filter = { userId: req.user._id };
    if (req.query.topicId) {
      filter.topicId = req.query.topicId;
    }

    const assessments = await Assessment.find(filter)
      .populate('topicId', 'title')
      .populate('moduleId', 'title')
      .sort({ completedAt: -1 });

    res.status(200).json({
      success: true,
      data: assessments,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitAssessment, submitDiagnostic, getAssessmentHistory };
