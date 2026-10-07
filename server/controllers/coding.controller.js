const CodingProblem = require('../models/CodingProblem');
const CodingSubmission = require('../models/CodingSubmission');
const CodingWorkspace = require('../models/CodingWorkspace');
const CodingDiscussionThread = require('../models/CodingDiscussionThread');
const CodingDiscussionReply = require('../models/CodingDiscussionReply');
const PerformanceLog = require('../models/PerformanceLog');
const Progress = require('../models/Progress');
const User = require('../models/User');
const MonitoringSession = require('../models/MonitoringSession');
const {
  COURSE_ORDER,
  buildProgressionForUser,
  getTopicProgressionState,
  normalizeCourseLevel,
} = require('../services/progressionService');
const { syncRoadmapForUser } = require('../services/roadmapGenerator');
const { judgeJavaSubmission } = require('../services/codeJudge');
const { calculateMasteryScore } = require('../services/scoreCalculator');
const { logActivity } = require('../services/streakService');
const mlService = require('../services/mlService');
const { finalizeSession } = require('../services/monitoringService');

const canAccessCodingWithoutMcq = (user, topicState) => {
  if (!topicState?.topic) return false;

  const learnerLevel = normalizeCourseLevel(user?.currentLevel);
  const topicLevel = normalizeCourseLevel(
    topicState.topic.courseLevel || topicState.module?.difficulty
  );

  return COURSE_ORDER.indexOf(topicLevel) < COURSE_ORDER.indexOf(learnerLevel);
};

const getActiveCodingLock = async (user, problemId = null) => {
  // If problemId is provided, check per-problem lock
  if (problemId) {
    const problemLocks = user?.codingProblemLocks || new Map();
    const lock = problemLocks.get(problemId) || {};
    const lockedUntilTime = lock.lockedUntil ? new Date(lock.lockedUntil).getTime() : 0;
    const now = Date.now();
    const isActive = Boolean(lock.isLocked && lockedUntilTime > now);

    if (isActive) {
      return {
        isLocked: true,
        lockedUntil: lock.lockedUntil,
        lockReason: lock.lockReason || '',
        lockCount: Number(lock.lockCount || 0),
        sessionType: 'coding',
        problemId,
      };
    }

    if (lock.isLocked) {
      // Clean up expired lock
      problemLocks.set(problemId, {
        isLocked: false,
        lockedUntil: null,
        lockReason: '',
        lockCount: Number(lock.lockCount || 0),
      });
      await User.findByIdAndUpdate(user._id, {
        $set: { codingProblemLocks: problemLocks },
      });
    }

    return {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: Number(lock.lockCount || 0),
      sessionType: 'coding',
      problemId,
    };
  }

  // Fall back to global coding lock for backward compatibility
  const lock = user?.codingLock || {};
  const lockedUntilTime = lock.lockedUntil ? new Date(lock.lockedUntil).getTime() : 0;
  const now = Date.now();
  const isActive = Boolean(lock.isLocked && lockedUntilTime > now);

  if (isActive) {
    return {
      isLocked: true,
      lockedUntil: lock.lockedUntil,
      lockReason: lock.lockReason || '',
      lockCount: Number(lock.lockCount || 0),
      sessionType: 'coding',
    };
  }

  if (lock.isLocked) {
    user.codingLock = {
      isLocked: false,
      lockedUntil: null,
      lockReason: '',
      lockCount: Number(lock.lockCount || 0),
    };
    await User.findByIdAndUpdate(user._id, {
      $set: { codingLock: user.codingLock },
    });
  }

  return {
    isLocked: false,
    lockedUntil: null,
    lockReason: '',
    lockCount: Number(lock.lockCount || 0),
    sessionType: 'coding',
  };
};

const buildAccessState = async (user, topicId) => {
  const codingLock = await getActiveCodingLock(user);
  if (codingLock.isLocked) {
    return {
      allowed: false,
      status: 423,
      lockReason: 'Coding access is temporarily locked due to repeated malpractice warnings.',
      lockState: codingLock,
    };
  }

  const progression = await buildProgressionForUser(user);
  const topicState = getTopicProgressionState(progression, topicId);

  if (!topicState?.topic?.accessible) {
    return {
      allowed: false,
      status: 403,
      lockReason: 'This topic is not available for your current level.',
      topicState,
    };
  }

  if (!topicState.topic.unlocked) {
    return {
      allowed: false,
      status: 403,
      lockReason: 'This topic is locked. Complete earlier topics in this course first.',
      topicState,
    };
  }

  const progress = await Progress.findOne({
    userId: user._id,
    topicId,
  }).select('round1Score codingScore status completedAt');

  if ((progress?.round1Score || 0) < 80 && !canAccessCodingWithoutMcq(user, topicState)) {
    return {
      allowed: false,
      status: 403,
      lockReason: 'Complete the MCQ round for this topic before opening the coding challenge.',
      topicState,
      progress,
    };
  }

  return {
    allowed: true,
    status: 200,
    lockReason: '',
    lockState: codingLock,
    topicState,
    progress,
  };
};

const sendAccessError = (res, access) => res.status(access.status).json({
  success: false,
  message: access.lockReason,
  ...(access.lockState || {}),
});

const serializeSubmission = (submission) => ({
  _id: submission._id,
  mode: submission.mode,
  verdict: submission.verdict,
  executionTimeMs: submission.executionTimeMs,
  passedVisibleCount: submission.passedVisibleCount,
  totalVisibleCount: submission.totalVisibleCount,
  passedHiddenCount: submission.passedHiddenCount,
  totalHiddenCount: submission.totalHiddenCount,
  createdAt: submission.createdAt,
});

const isValidDiscussionScope = (scope) => ['public', 'institution'].includes(scope);

const ensureDiscussionScope = (scope, user) => {
  if (!isValidDiscussionScope(scope)) {
    return 'Invalid discussion scope.';
  }
  if (scope === 'institution' && !user?.institutionId) {
    return 'Institution circle is only available for institution-linked students.';
  }
  return '';
};

const loadDiscussionThread = async (threadId) =>
  CodingDiscussionThread.findById(threadId)
    .populate('authorUserId', 'name username email institutionId')
    .lean();

const serializeDiscussionThread = async (thread) => {
  const replies = await CodingDiscussionReply.find({ threadId: thread._id })
    .populate('authorUserId', 'name username email institutionId')
    .sort({ createdAt: 1 })
    .lean();

  return {
    _id: thread._id,
    problemId: thread.problemId,
    scope: thread.scope,
    institutionId: thread.institutionId,
    title: thread.title,
    body: thread.body,
    tags: thread.tags || [],
    resolved: !!thread.resolved,
    replyCount: thread.replyCount || replies.length,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    author: {
      _id: thread.authorUserId?._id,
      name: thread.authorUserId?.name || thread.authorUserId?.username || thread.authorUserId?.email,
    },
    replies: replies.map((reply) => ({
      _id: reply._id,
      body: reply.body,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      author: {
        _id: reply.authorUserId?._id,
        name: reply.authorUserId?.name || reply.authorUserId?.username || reply.authorUserId?.email,
      },
    })),
  };
};

const serializeProblemDetail = async (problem, userId) => {
  const [workspace, submissions] = await Promise.all([
    CodingWorkspace.findOne({ userId, problemId: problem._id }).lean(),
    CodingSubmission.find({ userId, problemId: problem._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const safe = problem.toObject();
  safe.testCases = Array.isArray(safe.testCases)
    ? safe.testCases.filter((testCase) => !testCase.isHidden)
    : [];

  return {
    problem: safe,
    workspace: {
      draftCode: workspace?.draftCode || problem.javaStarterCode || '',
      solved: !!workspace?.solved,
      acceptedAt: workspace?.acceptedAt || null,
      lastRun: workspace?.lastRun || null,
    },
    recentSubmissions: submissions.map(serializeSubmission),
  };
};

const upsertWorkspace = async ({ userId, problem, draftCode, lastRun, solved, acceptedAt }) =>
  CodingWorkspace.findOneAndUpdate(
    { userId, problemId: problem._id },
    {
      $set: {
        draftCode,
        language: 'java',
        ...(lastRun ? { lastRun } : {}),
        ...(typeof solved === 'boolean' ? { solved } : {}),
        ...(acceptedAt ? { acceptedAt } : {}),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const saveSubmission = async ({
  userId,
  problem,
  code,
  mode,
  result,
}) =>
  CodingSubmission.create({
    userId,
    problemId: problem._id,
    topicId: problem.topicId || null,
    mode,
    language: 'java',
    code,
    verdict: result.verdict,
    compileOutput: result.compileOutput || '',
    runtimeOutput: result.runtimeOutput || '',
    executionTimeMs: result.executionTimeMs || 0,
    passedVisibleCount: result.passedVisibleCount || 0,
    totalVisibleCount: result.totalVisibleCount || 0,
    passedHiddenCount: result.passedHiddenCount || 0,
    totalHiddenCount: result.totalHiddenCount || 0,
    testResults: result.testResults || [],
  });

const markAcceptedProgress = async (user, problem, alreadySolved = false) => {
  if (!problem.topicId) return;

  let progress = await Progress.findOne({
    userId: user._id,
    topicId: problem.topicId,
  });

  if (!progress) {
    progress = await Progress.create({
      userId: user._id,
      topicId: problem.topicId,
      moduleId: problem.moduleId,
      status: 'Unlocked',
      codingScore: 0,
    });
  }

  progress.codingScore = Math.max(progress.codingScore || 0, 100);
  progress.lastAttemptAt = new Date();
  progress.masteryScore = calculateMasteryScore(
    progress.round1Score || 0,
    progress.codingScore || 0,
    progress.totalAttempts > 0
      ? (progress.hintsUsed || 0) / progress.totalAttempts
      : 0,
    Math.max(0, (progress.totalAttempts || 0) - 1)
  ).masteryScore;

  if ((progress.round1Score || 0) >= 80) {
    progress.status = 'Completed';
    progress.completedAt = progress.completedAt || new Date();
  } else {
    progress.status = progress.status === 'Locked' ? 'Unlocked' : progress.status;
  }

  await progress.save();

  await PerformanceLog.create({
    userId: user._id,
    topicId: problem.topicId,
    moduleId: problem.moduleId,
    sessionDate: new Date(),
    round1Accuracy: (progress.round1Score || 0) / 100,
    round2Accuracy: (progress.round1Score || 0) / 100,
    round3Accuracy: (progress.codingScore || 0) / 100,
    codingAccuracy: (progress.codingScore || 0) / 100,
    attemptCount: progress.totalAttempts || 0,
    masteryScore: progress.masteryScore || 0,
    weakFlag: false,
    weakType: null,
  });

  const update = {
    $addToSet: { topicsMastered: problem.topicId },
  };

  if (!alreadySolved) {
    update.$inc = { totalProblemsSolved: 1 };
  }

  await User.findByIdAndUpdate(user._id, update);
  await logActivity(user._id, 1, Math.max(10, problem.timeLimit || 30), [problem.title]);

  await syncRoadmapForUser(user._id);
};

const getCodingHub = async (req, res, next) => {
  try {
    const codingLock = await getActiveCodingLock(req.user);
    const [progression, problems, workspaces, progresses] = await Promise.all([
      buildProgressionForUser(req.user),
      CodingProblem.find({
        isActive: true,
        hasCoding: { $ne: false },
      })
        .populate('topicId', 'title order courseLevel')
        .populate('moduleId', 'title order difficulty')
        .sort({ createdAt: 1 })
        .lean(),
      CodingWorkspace.find({ userId: req.user._id }).lean(),
      Progress.find({ userId: req.user._id }).select('topicId round1Score codingScore status').lean(),
    ]);

    const workspaceByProblemId = new Map(
      workspaces.map((workspace) => [String(workspace.problemId), workspace])
    );
    const progressByTopicId = new Map(
      progresses.map((progress) => [String(progress.topicId), progress])
    );

    const items = problems.map((problem) => {
      if (codingLock.isLocked) {
        return {
          _id: problem._id,
          title: problem.title,
          difficulty: problem.difficulty,
          topicId: problem.topicId?._id || problem.topicId,
          topicTitle: problem.topicId?.title || 'Unknown Topic',
          moduleId: problem.moduleId?._id || problem.moduleId,
          moduleTitle: problem.moduleId?.title || 'Unknown Module',
          courseLevel: problem.topicId?.courseLevel || problem.moduleId?.difficulty || 'Beginner',
          points: problem.points || 0,
          timeLimit: problem.timeLimit || 30,
          state: 'locked',
          lockReason: 'Coding access is temporarily locked due to repeated malpractice warnings.',
          solved: false,
        };
      }

      const topicState = getTopicProgressionState(progression, problem.topicId?._id || problem.topicId);
      const progress = progressByTopicId.get(String(problem.topicId?._id || problem.topicId));
      const workspace = workspaceByProblemId.get(String(problem._id));

      let state = 'locked';
      let lockReason = 'Complete the previous topics to unlock this problem.';

      const unlockedByLevel = canAccessCodingWithoutMcq(req.user, topicState);

      if (topicState?.topic?.accessible && topicState.topic.unlocked) {
        if ((progress?.round1Score || 0) >= 80 || unlockedByLevel) {
          state = workspace?.solved || (progress?.codingScore || 0) >= 80 ? 'solved' : 'unlocked';
          lockReason = '';
        } else {
          lockReason = 'Pass the MCQ for this topic before coding.';
        }
      } else if (topicState?.topic?.accessible) {
        lockReason = 'Complete the earlier topic in this course first.';
      } else {
        lockReason = 'This course is still locked for your current progression.';
      }

      return {
        _id: problem._id,
        title: problem.title,
        difficulty: problem.difficulty,
        topicId: problem.topicId?._id || problem.topicId,
        topicTitle: problem.topicId?.title || 'Unknown Topic',
        moduleId: problem.moduleId?._id || problem.moduleId,
        moduleTitle: problem.moduleId?.title || 'Unknown Module',
        courseLevel: problem.topicId?.courseLevel || problem.moduleId?.difficulty || 'Beginner',
        points: problem.points || 0,
        timeLimit: problem.timeLimit || 30,
        state,
        lockReason,
        solved: state === 'solved',
      };
    });

    res.status(200).json({
      success: true,
      data: {
        problems: items,
        codingLock,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getCodingProblemById = async (req, res, next) => {
  try {
    const problem = await CodingProblem.findOne({
      _id: req.params.problemId,
      isActive: true,
      hasCoding: { $ne: false },
    })
      .populate('topicId', 'title order courseLevel')
      .populate('moduleId', 'title order difficulty')
      .select(
        'title description problemStatement inputFormat outputFormat sampleInput sampleOutput solutionApproach timeComplexity spaceComplexity difficulty javaStarterCode constraints hints timeLimit points leetcodeUrl topicId moduleId testCases tags'
      );

    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found' });
    }

    const access = await buildAccessState(req.user, problem.topicId?._id || problem.topicId);
    if (!access.allowed) {
      return sendAccessError(res, access);
    }

    const detail = await serializeProblemDetail(problem, req.user._id);
    res.status(200).json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
};

const getCodingProblemByTopic = async (req, res, next) => {
  try {
    const problem = await CodingProblem.findOne({
      topicId: req.params.topicId,
      isActive: true,
      hasCoding: { $ne: false },
    }).select('_id title difficulty leetcodeUrl topicId moduleId timeLimit points');

    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found for this topic' });
    }

    const access = await buildAccessState(req.user, req.params.topicId);
    if (!access.allowed) {
      return sendAccessError(res, access);
    }

    res.status(200).json({ success: true, data: { problem } });
  } catch (err) {
    next(err);
  }
};

const updateWorkspaceDraft = async (req, res, next) => {
  try {
    const { draftCode } = req.body;
    const problem = await CodingProblem.findById(req.params.problemId).select('javaStarterCode topicId moduleId');

    if (!problem || problem.hasCoding === false) {
      return res.status(404).json({ success: false, message: 'Coding problem not found' });
    }

    const access = await buildAccessState(req.user, problem.topicId);
    if (!access.allowed) {
      return sendAccessError(res, access);
    }

    const workspace = await upsertWorkspace({
      userId: req.user._id,
      problem,
      draftCode: String(draftCode || problem.javaStarterCode || ''),
    });

    res.status(200).json({
      success: true,
      data: {
        workspace: {
          draftCode: workspace.draftCode,
          solved: workspace.solved,
          acceptedAt: workspace.acceptedAt,
          lastRun: workspace.lastRun,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const runCodingProblem = async (req, res, next) => {
  try {
    const { code, monitoringSessionId, sessionData } = req.body;
    const problem = await CodingProblem.findOne({
      _id: req.params.problemId,
      isActive: true,
      hasCoding: { $ne: false },
    }).select('title topicId moduleId javaStarterCode timeLimit testCases');

    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found' });
    }

    const access = await buildAccessState(req.user, problem.topicId);
    if (!access.allowed) {
      return sendAccessError(res, access);
    }

    const sourceCode = String(code || '').trim() || problem.javaStarterCode || '';
    if (!sourceCode.trim()) {
      return res.status(400).json({ success: false, message: 'Code is required' });
    }

    const visibleTests = (problem.testCases || []).filter((testCase) => !testCase.isHidden);
    const result = await judgeJavaSubmission({
      sourceCode,
      testCases: visibleTests,
      mode: 'run',
      timeLimitSeconds: problem.timeLimit || 30,
    });

    await Promise.all([
      upsertWorkspace({
        userId: req.user._id,
        problem,
        draftCode: sourceCode,
        lastRun: {
          verdict: result.verdict,
          runtimeOutput: result.runtimeOutput || '',
          compileOutput: result.compileOutput || '',
          executionTimeMs: result.executionTimeMs || 0,
          updatedAt: new Date(),
        },
      }),
      saveSubmission({
        userId: req.user._id,
        problem,
        code: sourceCode,
        mode: 'run',
        result,
      }),
    ]);

    // Finalize monitoring session if provided
    let monitoringSummary = null;
    if (monitoringSessionId) {
      try {
        const monitoringSession = await MonitoringSession.findOne({
          _id: monitoringSessionId,
          userId: req.user._id,
          sessionType: 'coding',
        });

        if (monitoringSession) {
          await finalizeSession(monitoringSession, {
            problemId: problem._id,
            topicId: problem.topicId,
            moduleId: problem.moduleId,
            browserMetrics: sessionData || {},
          });

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
        console.error('Monitoring session finalization failed (run):', monitoringErr);
      }
    }

    // Optional: proctor analysis if a frame was provided
    let proctorResult = null;
    try {
      if (sessionData && sessionData.proctorImage) {
        const proctorPayload = {
          imageData: sessionData.proctorImage,
          metadata: {
            userId: String(req.user._id),
            sessionType: 'coding',
            problemId: String(problem._id),
          },
        };
        proctorResult = await mlService.analyzeProctorFrame(proctorPayload);
      }
    } catch (e) {
      console.error('Proctor analysis (run) failed:', e?.message || e);
    }
    res.status(200).json({
      success: true,
      data: result,
      monitoring: monitoringSummary || (proctorResult ? { proctor: proctorResult } : undefined),
    });
  } catch (err) {
    next(err);
  }
};

const submitCodingProblem = async (req, res, next) => {
  try {
    const { code, monitoringSessionId, sessionData } = req.body;
    const problem = await CodingProblem.findOne({
      _id: req.params.problemId,
      isActive: true,
      hasCoding: { $ne: false },
    }).select('title topicId moduleId javaStarterCode timeLimit testCases');

    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found' });
    }

    const access = await buildAccessState(req.user, problem.topicId);
    if (!access.allowed) {
      return sendAccessError(res, access);
    }

    const sourceCode = String(code || '').trim() || problem.javaStarterCode || '';
    if (!sourceCode.trim()) {
      return res.status(400).json({ success: false, message: 'Code is required' });
    }

    const result = await judgeJavaSubmission({
      sourceCode,
      testCases: problem.testCases || [],
      mode: 'submit',
      timeLimitSeconds: problem.timeLimit || 30,
    });

    const accepted = result.verdict === 'Accepted';
    const existingWorkspace = await CodingWorkspace.findOne({
      userId: req.user._id,
      problemId: problem._id,
    })
      .select('solved')
      .lean();

    await Promise.all([
      upsertWorkspace({
        userId: req.user._id,
        problem,
        draftCode: sourceCode,
        solved: accepted,
        acceptedAt: accepted ? new Date() : null,
        lastRun: {
          verdict: result.verdict,
          runtimeOutput: result.runtimeOutput || '',
          compileOutput: result.compileOutput || '',
          executionTimeMs: result.executionTimeMs || 0,
          updatedAt: new Date(),
        },
      }),
      saveSubmission({
        userId: req.user._id,
        problem,
        code: sourceCode,
        mode: 'submit',
        result,
      }),
    ]);

    // Finalize monitoring session if provided
    let monitoringSummary = null;
    if (monitoringSessionId) {
      try {
        const monitoringSession = await MonitoringSession.findOne({
          _id: monitoringSessionId,
          userId: req.user._id,
          sessionType: 'coding',
        });

        if (monitoringSession) {
          await finalizeSession(monitoringSession, {
            problemId: problem._id,
            topicId: problem.topicId,
            moduleId: problem.moduleId,
            browserMetrics: sessionData || {},
          });

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
        console.error('Monitoring session finalization failed (submit):', monitoringErr);
      }
    }

    // Optional: proctor analysis for submission
    let proctorResult = null;
    try {
      if (sessionData && sessionData.proctorImage) {
        const proctorPayload = {
          imageData: sessionData.proctorImage,
          metadata: {
            userId: String(req.user._id),
            sessionType: 'coding_submit',
            problemId: String(problem._id),
          },
        };
        proctorResult = await mlService.analyzeProctorFrame(proctorPayload);
      }
    } catch (e) {
      console.error('Proctor analysis (submit) failed:', e?.message || e);
    }
    if (accepted) {
      await markAcceptedProgress(req.user, problem, !!existingWorkspace?.solved);
    }

    res.status(200).json({
      success: true,
      data: result,
      message: accepted ? 'Accepted' : result.verdict,
      monitoring: monitoringSummary || (proctorResult ? { proctor: proctorResult } : undefined),
    });
  } catch (err) {
    next(err);
  }
};

const getCodingSubmissions = async (req, res, next) => {
  try {
    const submissions = await CodingSubmission.find({
      userId: req.user._id,
      problemId: req.params.problemId,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        submissions: submissions.map(serializeSubmission),
      },
    });
  } catch (err) {
    next(err);
  }
};

const listCodingDiscussions = async (req, res, next) => {
  try {
    const { scope = 'public' } = req.query;
    const scopeError = ensureDiscussionScope(scope, req.user);
    if (scopeError) {
      return res.status(400).json({ success: false, message: scopeError });
    }

    const query = {
      problemId: req.params.problemId,
      scope,
    };

    if (scope === 'institution') {
      query.institutionId = req.user.institutionId;
    }

    const threads = await CodingDiscussionThread.find(query)
      .populate('authorUserId', 'name username email')
      .sort({ resolved: 1, updatedAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        threads: threads.map((thread) => ({
          _id: thread._id,
          title: thread.title,
          body: thread.body,
          tags: thread.tags || [],
          resolved: !!thread.resolved,
          replyCount: thread.replyCount || 0,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          scope: thread.scope,
          author: {
            _id: thread.authorUserId?._id,
            name: thread.authorUserId?.name || thread.authorUserId?.username || thread.authorUserId?.email,
          },
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

const createCodingDiscussion = async (req, res, next) => {
  try {
    const { scope = 'public', title, body, tags = [] } = req.body;
    const scopeError = ensureDiscussionScope(scope, req.user);
    if (scopeError) {
      return res.status(400).json({ success: false, message: scopeError });
    }
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'title and body are required' });
    }

    const thread = await CodingDiscussionThread.create({
      problemId: req.params.problemId,
      scope,
      institutionId: scope === 'institution' ? req.user.institutionId : null,
      authorUserId: req.user._id,
      title: String(title).trim(),
      body: String(body).trim(),
      tags: Array.isArray(tags) ? tags.slice(0, 5).map((tag) => String(tag).trim()).filter(Boolean) : [],
    });

    const populated = await loadDiscussionThread(thread._id);
    res.status(201).json({
      success: true,
      data: {
        thread: await serializeDiscussionThread(populated),
      },
    });
  } catch (err) {
    next(err);
  }
};

const getCodingDiscussionThread = async (req, res, next) => {
  try {
    const thread = await loadDiscussionThread(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }
    if (thread.scope === 'institution' && String(thread.institutionId) !== String(req.user.institutionId || '')) {
      return res.status(403).json({ success: false, message: 'This institution discussion is not available to you.' });
    }

    res.status(200).json({
      success: true,
      data: {
        thread: await serializeDiscussionThread(thread),
      },
    });
  } catch (err) {
    next(err);
  }
};

const addCodingDiscussionReply = async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body) {
      return res.status(400).json({ success: false, message: 'body is required' });
    }

    const thread = await CodingDiscussionThread.findById(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }
    if (thread.scope === 'institution' && String(thread.institutionId) !== String(req.user.institutionId || '')) {
      return res.status(403).json({ success: false, message: 'This institution discussion is not available to you.' });
    }

    await CodingDiscussionReply.create({
      threadId: thread._id,
      authorUserId: req.user._id,
      body: String(body).trim(),
    });

    thread.replyCount += 1;
    thread.updatedAt = new Date();
    await thread.save();

    const populated = await loadDiscussionThread(thread._id);
    res.status(201).json({
      success: true,
      data: {
        thread: await serializeDiscussionThread(populated),
      },
    });
  } catch (err) {
    next(err);
  }
};

const resolveCodingDiscussionThread = async (req, res, next) => {
  try {
    const thread = await CodingDiscussionThread.findById(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }
    if (String(thread.authorUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the thread author can resolve it.' });
    }

    thread.resolved = !thread.resolved;
    await thread.save();

    const populated = await loadDiscussionThread(thread._id);
    res.status(200).json({
      success: true,
      data: {
        thread: await serializeDiscussionThread(populated),
      },
    });
  } catch (err) {
    next(err);
  }
};

const deleteCodingDiscussionThread = async (req, res, next) => {
  try {
    const thread = await CodingDiscussionThread.findById(req.params.threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }
    if (String(thread.authorUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the thread author can delete it.' });
    }

    await CodingDiscussionReply.deleteMany({ threadId: thread._id });
    await CodingDiscussionThread.deleteOne({ _id: thread._id });

    res.status(200).json({ success: true, message: 'Discussion thread deleted' });
  } catch (err) {
    next(err);
  }
};

const deleteCodingDiscussionReply = async (req, res, next) => {
  try {
    const reply = await CodingDiscussionReply.findById(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ success: false, message: 'Discussion reply not found' });
    }
    if (String(reply.authorUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the reply author can delete it.' });
    }

    await CodingDiscussionReply.deleteOne({ _id: reply._id });
    await CodingDiscussionThread.findByIdAndUpdate(reply.threadId, {
      $inc: { replyCount: -1 },
      $set: { updatedAt: new Date() },
    });

    res.status(200).json({ success: true, message: 'Discussion reply deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCodingHub,
  getCodingProblemById,
  getCodingProblemByTopic,
  getCodingSubmissions,
  runCodingProblem,
  submitCodingProblem,
  updateWorkspaceDraft,
  listCodingDiscussions,
  createCodingDiscussion,
  getCodingDiscussionThread,
  addCodingDiscussionReply,
  resolveCodingDiscussionThread,
  deleteCodingDiscussionThread,
  deleteCodingDiscussionReply,
};
