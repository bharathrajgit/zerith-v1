const axios = require('axios');
const User = require('../models/User');
const DiagnosticSession = require('../models/DiagnosticSession');
const MonitoringSession = require('../models/MonitoringSession');
const {
  generateRoadmap,
} = require('../services/roadmapGenerator');
const mlService = require('../services/mlService');
const {
  canonicalizeLevel,
  getCheatingRisk,
} = mlService;
const { logActivity } = require('../services/streakService');
const antiMalpractice = require('../services/antiMalpractice');
const { finalizeSession } = require('../services/monitoringService');
const {
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  QUESTION_TIME_LIMIT,
  SESSION_EXPIRY_MS,
  DIAGNOSTIC_POOL_INCOMPLETE,
  buildResults,
  service: adaptiveDiagnosticService,
} = require('../services/adaptiveDiagnosticService');
const diagnosticCodingPool = require('../data/diagnosticCodingPool');
const {
  runDiagnosticProblem,
  runDiagnosticProblemLocally,
} = require('../services/judge0Service');
const { ML_SERVICE_URL } = require('../config/env');

const ALLOWED_LEVELS = ['Beginner', 'Intermediate', 'Placement-Ready'];
const ML_URL = ML_SERVICE_URL;
const TOTAL_CODING_WEIGHT = 23;
const MCQ_COMBINED_WEIGHT = 0.3;
const CODING_COMBINED_WEIGHT = 0.7;
const DIFFICULTY_WEIGHT = {
  Basic: 1,
  Medium: 2,
  Hard: 3,
};
const PLAN_BY_LEVEL = {
  Beginner: '90-day',
  Intermediate: '60-day',
  'Placement-Ready': '30-day',
};
const DIAGNOSTIC_LOCK_RESPONSE_STATUS = 423;

const average = (values = []) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const computeStdDev = (values = []) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
};

const hashString = (input) =>
  Array.from(String(input || '')).reduce((hash, char) => {
    let next = (hash << 5) - hash + char.charCodeAt(0);
    next |= 0;
    return next;
  }, 0) >>> 0;

const mulberry32 = (seed) => () => {
  let next = (seed += 0x6d2b79f5);
  next = Math.imul(next ^ (next >>> 15), next | 1);
  next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
  return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
};

const seededShuffle = (items, rng) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const normalizeTopicLabel = (topic = '') =>
  String(topic)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toPlainTestCase = (testCase = {}) => ({
  input: String(
    typeof testCase?.input === 'string'
      ? testCase.input
      : testCase?.input ?? ''
  ),
  expectedOutput: String(
    typeof testCase?.expectedOutput === 'string'
      ? testCase.expectedOutput
      : testCase?.expectedOutput ?? ''
  ),
});

const stripHiddenProblemFields = (problem) => ({
  problemId: problem.problemId,
  title: problem.title,
  description: problem.description,
  difficulty: problem.difficulty,
  topic: problem.topic,
  timeLimit: problem.timeLimit,
  javaStarterCode: problem.javaStarterCode,
  visibleTestCases: (problem.visibleTestCases || []).map(toPlainTestCase),
  hints: problem.hints || [],
  hiddenTestCount: Array.isArray(problem.hiddenTestCases) ? problem.hiddenTestCases.length : 0,
  bestScore: Number(problem.bestScore || 0),
  attemptCount: Number(problem.attemptCount || 0),
  timeSpent: Number(problem.timeSpent || 0),
  startedAt: problem.startedAt || null,
});

const sanitizeVisibleResult = (testCase, result = {}) => ({
  input: testCase.input,
  expectedOutput: testCase.expectedOutput,
  actualOutput: result.stdout || '',
  passed: !!result.passed,
  stderr: result.stderr || '',
  status: result.status || '',
  time: Number(result.time || 0),
});

const buildCheatingPayload = (sessionData = {}, answers = [], diagnosticScore = 0) => {
  const answerTimes = answers.map((answer) => answer.timeTaken || 0).filter((time) => time > 0);
  const avgTime = average(answerTimes);
  const stdTime = computeStdDev(answerTimes);
  const fastAnswers = answerTimes.filter((time) => time <= 10).length;
  const slowAnswers = answerTimes.filter((time) => time >= 35).length;

  return {
    avg_time: avgTime,
    std_time: stdTime,
    fast_slow_ratio: slowAnswers > 0 ? fastAnswers / slowAnswers : fastAnswers,
    tab_switches: sessionData.tabSwitches || 0,
    copy_attempts: sessionData.copyAttempts || 0,
    window_blur: sessionData.windowBlurCount || 0,
    hint_rate: 0,
    changed_answers: sessionData.changedAnswers || 0,
    total_questions: answers.length,
    past_avg_accuracy: diagnosticScore,
  };
};

const getSeededCodingProblems = (sessionToken, userId) => {
  const dateKey = new Date().toISOString().slice(0, 10);
  const rng = mulberry32(hashString(`${userId}:${sessionToken}:${dateKey}`));

  const pickFromBucket = (bucket, count) =>
    seededShuffle(bucket, rng)
      .slice(0, count)
      .map((problem) => ({
        problemId: problem.problemId,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        topic: problem.topic,
        timeLimit: problem.timeLimit,
        javaStarterCode: problem.javaStarterCode,
        visibleTestCases: problem.visibleTestCases,
        hiddenTestCases: problem.hiddenTestCases,
        hints: problem.hints,
        submissions: [],
        bestScore: 0,
        attemptCount: 0,
        timeSpent: 0,
        startedAt: null,
        lastSubmittedAt: null,
      }));

  const selected = [
    ...pickFromBucket(diagnosticCodingPool.basic, 2),
    ...pickFromBucket(diagnosticCodingPool.medium, 3),
    ...pickFromBucket(diagnosticCodingPool.hard, 5),
  ];

  return seededShuffle(selected, rng);
};

const getSessionToken = (req) => req.body?.sessionToken || req.body?.token;

const formatLockDuration = (ms) => {
  const safeSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
};

const buildDiagnosticLockState = (user, now = Date.now()) => {
  const lock = user?.diagnosticLock || {};
  const lockedUntilTime = lock.lockedUntil ? new Date(lock.lockedUntil).getTime() : 0;
  const isLocked = Boolean(lock.isLocked && lockedUntilTime > now);
  const timeRemainingMs = isLocked ? Math.max(0, lockedUntilTime - now) : 0;

  return {
    isLocked,
    lockedUntil: isLocked ? lock.lockedUntil : null,
    timeRemainingMs,
    timeRemainingFormatted: isLocked ? formatLockDuration(timeRemainingMs) : '0h 0m 0s',
    lockReason: isLocked ? (lock.lockReason || '') : '',
    lockCount: Number(lock.lockCount || 0),
    sessionType: 'diagnostic',
  };
};

const clearExpiredDiagnosticLock = async (user, now = Date.now()) => {
  const lockState = buildDiagnosticLockState(user, now);
  if (lockState.isLocked || !user?.diagnosticLock?.isLocked) {
    return lockState;
  }

  user.diagnosticLock = {
    isLocked: false,
    lockedUntil: null,
    lockReason: '',
    lockCount: Number(user?.diagnosticLock?.lockCount || 0),
  };
  await user.save();

  return buildDiagnosticLockState(user, now);
};

const respondWithDiagnosticLock = (res, lockState) =>
  res.status(DIAGNOSTIC_LOCK_RESPONSE_STATUS).json({
    success: false,
    message: 'Diagnostic access is locked because the malpractice warning limit was reached.',
    data: lockState,
  });

const enforceDiagnosticUnlocked = async (userId, res) => {
  const user = await User.findById(userId).select('diagnosticLock');
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }

  const lockState = await clearExpiredDiagnosticLock(user);
  if (lockState.isLocked) {
    respondWithDiagnosticLock(res, lockState);
    return null;
  }

  return user;
};

const expireInProgressDiagnosticSessions = async (userId) => {
  const activeDiagnosticSessions = await DiagnosticSession.find({
    userId,
    status: 'in_progress',
  }).select('_id sessionToken');

  if (!activeDiagnosticSessions.length) {
    return;
  }

  await DiagnosticSession.updateMany(
    {
      _id: { $in: activeDiagnosticSessions.map((session) => session._id) },
    },
    {
      $set: {
        status: 'expired',
        expiresAt: new Date(),
      },
    }
  );

  activeDiagnosticSessions.forEach((activeSession) => {
    if (activeSession.sessionToken) {
      adaptiveDiagnosticService.activeSessions.delete(activeSession.sessionToken);
    }
  });
};

const getSessionOrThrow = async ({ sessionToken, userId }) => {
  const session = await DiagnosticSession.findOne({
    sessionToken,
    userId,
  });

  if (!session) {
    throw new Error('Diagnostic session not found');
  }

  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    session.status = 'expired';
    await session.save();
    throw new Error('Diagnostic session expired');
  }

  return session;
};

const getCodingProblemFromSession = (session, problemId) => {
  const index = (session.codingProblems || []).findIndex((problem) => problem.problemId === problemId);
  if (index === -1) {
    return { index: -1, problem: null };
  }
  return {
    index,
    problem: session.codingProblems[index],
  };
};

const summarizeSubmission = (submission) => {
  const judge0Result = submission?.judge0Result || {};
  return {
    passedVisible: Number(judge0Result.passedVisible || 0),
    totalVisible: Number(judge0Result.totalVisible || 0),
    passedHidden: Number(judge0Result.passedHidden || 0),
    totalHidden: Number(judge0Result.totalHidden || 0),
    passedTotal: Number(judge0Result.passedCount || 0),
    totalCount: Number(judge0Result.totalCount || 0),
    visibleResults: Array.isArray(judge0Result.visibleResults) ? judge0Result.visibleResults : [],
    executionTime: Number(judge0Result.executionTime || 0),
    status: judge0Result.status || 'wrong_answer',
  };
};

const getBestSubmission = (problem) => {
  const submissions = Array.isArray(problem?.submissions) ? [...problem.submissions] : [];
  if (!submissions.length) return null;

  submissions.sort((left, right) => {
    const leftSummary = summarizeSubmission(left);
    const rightSummary = summarizeSubmission(right);

    if ((right.score || 0) !== (left.score || 0)) {
      return (right.score || 0) - (left.score || 0);
    }

    if (rightSummary.passedTotal !== leftSummary.passedTotal) {
      return rightSummary.passedTotal - leftSummary.passedTotal;
    }

    return new Date(right.submittedAt || 0) - new Date(left.submittedAt || 0);
  });

  return submissions[0];
};

const buildCodingBreakdown = (codingProblems = []) =>
  codingProblems.map((problem) => {
    const bestSubmission = getBestSubmission(problem);
    const summary = summarizeSubmission(bestSubmission);
    const totalVisible = Array.isArray(problem.visibleTestCases) ? problem.visibleTestCases.length : 0;
    const totalHidden = Array.isArray(problem.hiddenTestCases) ? problem.hiddenTestCases.length : 0;
    const hasSubmission = !!bestSubmission;

    return {
      problemId: problem.problemId,
      title: problem.title,
      difficulty: problem.difficulty,
      topic: problem.topic,
      score: Number(problem.bestScore || 0),
      attemptCount: Number(problem.attemptCount || 0),
      timeSpent: Number(problem.timeSpent || 0),
      passedVisible: summary.passedVisible,
      totalVisible: hasSubmission ? summary.totalVisible : totalVisible,
      passedHidden: summary.passedHidden,
      totalHidden: hasSubmission ? summary.totalHidden : totalHidden,
      passedTotal: summary.passedTotal,
      totalTests: hasSubmission ? summary.totalCount : totalVisible + totalHidden,
      status: hasSubmission ? summary.status : 'not_attempted',
      visibleResults: summary.visibleResults,
      executionTime: summary.executionTime,
    };
  });

const buildCodingTopicScores = (breakdown = []) => {
  const accumulator = breakdown.reduce((map, item) => {
    const key = normalizeTopicLabel(item.topic);
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(Number(item.score || 0) * 100);
    return map;
  }, {});

  return Object.fromEntries(
    Object.entries(accumulator).map(([topic, values]) => [topic, Math.round(average(values))])
  );
};

const buildMcqMetrics = (sessionResults, answers = []) => {
  const byDifficulty = {
    basic: [],
    medium: [],
    hard: [],
  };

  answers.forEach((answer) => {
    const key = String(answer.difficulty || 'Hard').toLowerCase();
    if (byDifficulty[key]) {
      byDifficulty[key].push(answer);
    }
  });

  const accuracy = (group = []) => (
    group.length ? group.filter((answer) => answer.isCorrect).length / group.length : 0
  );

  return {
    mcq_score: clamp(Number(sessionResults.totalCorrect || 0) / Math.max(Number(sessionResults.totalQuestions || 0), 1)),
    mcq_basic_accuracy: accuracy(byDifficulty.basic),
    mcq_medium_accuracy: accuracy(byDifficulty.medium),
    mcq_hard_accuracy: accuracy(byDifficulty.hard),
    mcq_avg_response_time: Number(sessionResults.avgTimePerQuestion || 0),
    mcq_hint_usage_rate: 0,
  };
};

const buildCodingMetrics = (codingProblems = [], breakdown = []) => {
  const scoreBucket = {
    Basic: [],
    Medium: [],
    Hard: [],
  };

  let weightedScore = 0;
  let totalAttempts = 0;
  let totalPassed = 0;
  let totalTests = 0;
  let attemptedProblems = 0;
  let efficiencyParts = [];

  codingProblems.forEach((problem) => {
    const score = Number(problem.bestScore || 0);
    const weight = DIFFICULTY_WEIGHT[problem.difficulty] || 1;
    scoreBucket[problem.difficulty]?.push(score);
    weightedScore += score * weight;
    totalAttempts += Number(problem.attemptCount || 0);

    if ((problem.attemptCount || 0) > 0) {
      attemptedProblems += 1;
      const used = Math.min(Number(problem.timeSpent || 0), Number(problem.timeLimit || 0));
      const allowed = Math.max(Number(problem.timeLimit || 1), 1);
      efficiencyParts.push(clamp(1 - (used / allowed)));
    }
  });

  breakdown.forEach((item) => {
    totalPassed += Number(item.passedTotal || 0);
    totalTests += Number(item.totalTests || 0);
  });

  const coding_score = clamp(weightedScore / TOTAL_CODING_WEIGHT);
  const basic_coding_score = clamp(average(scoreBucket.Basic));
  const medium_coding_score = clamp(average(scoreBucket.Medium));
  const hard_coding_score = clamp(average(scoreBucket.Hard));
  const coding_attempt_rate = Number((totalAttempts / Math.max(codingProblems.length, 1)).toFixed(2));
  const test_case_pass_rate = clamp(totalPassed / Math.max(totalTests, 1));
  const coding_time_efficiency = clamp(average(efficiencyParts));
  const coding_completion_rate = clamp(attemptedProblems / Math.max(codingProblems.length, 1));

  return {
    coding_score,
    basic_coding_score,
    medium_coding_score,
    hard_coding_score,
    coding_attempt_rate,
    test_case_pass_rate,
    coding_time_efficiency,
    coding_completion_rate,
  };
};

const buildCombinedFeatures = (mcqMetrics, codingMetrics) => {
  const combined_score = clamp(
    (mcqMetrics.mcq_score * MCQ_COMBINED_WEIGHT) + (codingMetrics.coding_score * CODING_COMBINED_WEIGHT)
  );
  const hard_performance_ratio = clamp(
    ((codingMetrics.hard_coding_score * 3) + mcqMetrics.mcq_hard_accuracy) / 4
  );
  const consistencyInputs = [
    mcqMetrics.mcq_score,
    codingMetrics.basic_coding_score,
    codingMetrics.medium_coding_score,
    codingMetrics.hard_coding_score,
  ];
  const consistency_score = clamp(1 - Math.min(computeStdDev(consistencyInputs) / 0.5, 1));

  return {
    combined_score,
    hard_performance_ratio,
    consistency_score,
  };
};

const deriveWeakAreas = ({ codingTopicScores = {}, mcqMetrics = {}, codingMetrics = {} }) => {
  const weak = [];
  const sortedTopics = Object.entries(codingTopicScores)
    .sort((left, right) => left[1] - right[1]);

  sortedTopics.slice(0, 2).forEach(([topic]) => {
    weak.push(topic);
  });

  if (codingMetrics.hard_coding_score < 0.45) {
    weak.push('Dynamic Programming');
    weak.push('Hard Graph Problems');
  }

  if (mcqMetrics.mcq_hard_accuracy < 0.45) {
    weak.push('Advanced Problem Solving');
  }

  return [...new Set(weak)].slice(0, 4);
};

const deriveStrongAreas = ({ codingTopicScores = {}, mcqMetrics = {}, codingMetrics = {} }) => {
  const strong = [];
  const sortedTopics = Object.entries(codingTopicScores)
    .sort((left, right) => right[1] - left[1]);

  sortedTopics.slice(0, 2).forEach(([topic]) => {
    strong.push(topic);
  });

  if (codingMetrics.basic_coding_score >= 0.75) {
    strong.push('Basic Algorithms');
  }

  if (mcqMetrics.mcq_basic_accuracy >= 0.75) {
    strong.push('Arrays');
    strong.push('Strings');
  }

  return [...new Set(strong)].slice(0, 4);
};

const buildFallbackMlResponse = (features, codingTopicScores) => {
  const combined = Number(features.combined_score || 0);
  let level = 'Beginner';

  if (combined >= 0.7) level = 'Placement-Ready';
  else if (combined >= 0.4) level = 'Intermediate';

  return {
    level,
    confidence: 0.65,
    probabilities: {
      Beginner: level === 'Beginner' ? 0.8 : 0.1,
      Intermediate: level === 'Intermediate' ? 0.8 : 0.1,
      'Placement-Ready': level === 'Placement-Ready' ? 0.8 : 0.1,
    },
    mcq_contribution: MCQ_COMBINED_WEIGHT,
    coding_contribution: CODING_COMBINED_WEIGHT,
    weak_areas: deriveWeakAreas({
      codingTopicScores,
      mcqMetrics: features,
      codingMetrics: features,
    }),
    strong_areas: deriveStrongAreas({
      codingTopicScores,
      mcqMetrics: features,
      codingMetrics: features,
    }),
    recommended_plan: PLAN_BY_LEVEL[level] || '90-day',
    confidence_explanation: `Lower confidence: the diagnostic sits close to the current level boundary, so the fallback rules treat it as a borderline ${level} profile.`,
    model_metadata: {
      source: 'node_fallback_rules',
      n_features: 17,
      sample_count: 0,
      kaggle_sample_count: 0,
      training_sources: {},
      cv_accuracy: 0,
    },
    fallback: true,
  };
};

const buildPersistedMcqResults = (session) => ({
  totalScore: Number(session.result?.totalScore || 0),
  totalQuestions: Number(session.totalQuestions || session.answers.length || 0),
  totalCorrect: Math.round(
    Number(session.mcqScore || 0) * Math.max(Number(session.totalQuestions || session.answers.length || 0), 0)
  ),
  perTopicScores: session.result?.perTopicScores || {},
  avgTimePerQuestion: Number(session.result?.avgTimePerQuestion || 0),
  unansweredCount: Number(session.result?.unansweredCount || 0),
});

const classifyDiagnosticWithMl = async (features, codingTopicScores) => {
  try {
    const response = await axios.post(`${ML_URL}/ml/classify-diagnostic`, features, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });

    const payload = response.data?.data || response.data;
    return {
      ...payload,
      level: canonicalizeLevel(payload?.level),
      recommended_plan: payload?.recommended_plan || PLAN_BY_LEVEL[canonicalizeLevel(payload?.level)] || '90-day',
      weak_areas: Array.isArray(payload?.weak_areas)
        ? payload.weak_areas
        : deriveWeakAreas({ codingTopicScores, mcqMetrics: features, codingMetrics: features }),
      strong_areas: Array.isArray(payload?.strong_areas)
        ? payload.strong_areas
        : deriveStrongAreas({ codingTopicScores, mcqMetrics: features, codingMetrics: features }),
      confidence_explanation: payload?.confidence_explanation || '',
      model_metadata: payload?.model_metadata || null,
    };
  } catch (error) {
    return buildFallbackMlResponse(features, codingTopicScores);
  }
};

const buildCompletedDiagnosticPayload = async (session) => {
  const persistedMcqResults = buildPersistedMcqResults(session);
  const breakdown = buildCodingBreakdown(session.codingProblems || []);
  const codingMetrics = buildCodingMetrics(session.codingProblems || [], breakdown);
  const mcqMetrics = buildMcqMetrics(persistedMcqResults, session.answers || []);
  const combinedFeatures = buildCombinedFeatures(mcqMetrics, codingMetrics);
  const features = {
    ...mcqMetrics,
    ...codingMetrics,
    ...combinedFeatures,
  };
  const codingTopicScores = buildCodingTopicScores(breakdown);
  const mlResult = await classifyDiagnosticWithMl(features, codingTopicScores);

  let level = canonicalizeLevel(mlResult.level || session.result?.assignedLevel);
  if (!ALLOWED_LEVELS.includes(level)) {
    level = buildFallbackMlResponse(features, codingTopicScores).level;
  }

  const combinedScorePercent = Math.round(combinedFeatures.combined_score * 100);

  return {
    level,
    mcqScore: Number((mcqMetrics.mcq_score * 50).toFixed(1)),
    mcqScoreRatio: Number(mcqMetrics.mcq_score.toFixed(4)),
    codingScore: Number((codingMetrics.coding_score * 10).toFixed(1)),
    codingScoreRatio: Number(codingMetrics.coding_score.toFixed(4)),
    combinedScore: combinedScorePercent,
    breakdown,
    confidence: Number(mlResult.confidence || session.result?.mlConfidence || 0),
    probabilities: mlResult.probabilities || {},
    confidenceExplanation: mlResult.confidence_explanation || '',
    weakAreas: mlResult.weak_areas || [],
    strongAreas: mlResult.strong_areas || [],
    recommendedPlan: mlResult.recommended_plan || PLAN_BY_LEVEL[level],
    modelMetadata: mlResult.model_metadata || null,
    codingTopicScores,
    perTopicScores: {
      ...(session.result?.perTopicScores || {}),
      ...codingTopicScores,
    },
    placementReadiness: Number(session.result?.readinessScore || combinedScorePercent),
    malpractice: session.result?.malpractice || null,
    completedAt: session.codingCompletedAt || session.updatedAt || session.createdAt,
  };
};

const getLatestDiagnosticSummary = async (req, res) => {
  try {
    const session = await DiagnosticSession.findOne({
      userId: req.user._id,
      status: 'completed',
    }).sort({ codingCompletedAt: -1, updatedAt: -1, createdAt: -1 });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'No completed diagnostic summary found',
      });
    }

    const payload = await buildCompletedDiagnosticPayload(session);

    return res.json({
      success: true,
      data: payload,
      message: 'Diagnostic summary loaded',
    });
  } catch (error) {
    console.error('Diagnostic summary error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const finalizeMonitoringIfNeeded = async ({
  req,
  session,
  sessionData,
  monitoringSessionId,
  user,
  combinedScorePercent,
  answers,
}) => {
  let malpracticeSummary = null;
  const resolvedMonitoringSessionId = monitoringSessionId || session?.monitoringSessionId;

  if (resolvedMonitoringSessionId) {
    try {
      const monitoringSession = await MonitoringSession.findOne({
        _id: resolvedMonitoringSessionId,
        userId: req.user._id,
        sessionType: 'diagnostic',
      });

      if (monitoringSession) {
        await finalizeSession(monitoringSession, {
          browserMetrics: sessionData || {},
        });

        malpracticeSummary = {
          monitoringSessionId: monitoringSession._id,
          warningCount: monitoringSession.warningCount || 0,
          warningLimit: monitoringSession.warningLimit || 0,
          finalFlagged: !!monitoringSession.finalFlagged,
          riskLevel: monitoringSession.riskLevel || 'NONE',
          signals: monitoringSession.signals || [],
        };
      }
    } catch (monitoringError) {
      console.error('Diagnostic monitoring finalization failed:', monitoringError);
    }
  } else if (user?.institutionId) {
    const heuristicResult = antiMalpractice.analyzeSession({
      answers: (answers || []).map((answer) => ({
        questionId: answer.questionId || answer.topic,
        selectedOption: answer.selectedOption,
        timeToAnswer: answer.timeTaken,
      })),
      tabSwitches: sessionData.tabSwitches || 0,
      copyAttempts: sessionData.copyAttempts || 0,
      windowBlurCount: sessionData.windowBlurCount || 0,
      changedAnswers: sessionData.changedAnswers || 0,
      ipAddress: req.ip,
    });
    const mlCheating = await getCheatingRisk(buildCheatingPayload(sessionData, answers, combinedScorePercent));

    const saved = await antiMalpractice.saveIfSuspicious(
      heuristicResult,
      req.user._id,
      session?._id,
      user.institutionId,
      {
        ...sessionData,
        answers: (answers || []).map((answer) => ({
          timeToAnswer: answer.timeTaken,
          selectedOption: answer.selectedOption,
        })),
        ipAddress: req.ip,
      },
      mlCheating
    );

    malpracticeSummary = {
      riskLevel: heuristicResult.riskLevel,
      riskScore: heuristicResult.riskScore,
      cheatingProbability: Number(mlCheating?.cheating_probability || 0),
      saved: saved.saved,
    };
  }

  // Optionally run proctor frame analysis if front-end provided an image
  try {
    if (sessionData && sessionData.proctorImage) {
      const proctorPayload = {
        imageData: sessionData.proctorImage,
        metadata: {
          userId: String(req.user._id),
          sessionType: 'diagnostic',
        },
      };
      const proctor = await require('../services/mlService').analyzeProctorFrame(proctorPayload);
      malpracticeSummary = malpracticeSummary || {};
      malpracticeSummary.proctor = proctor;
    }
  } catch (proErr) {
    console.error('Diagnostic proctor analysis failed:', proErr?.message || proErr);
  }

  return malpracticeSummary;
};

const startDiagnostic = async (req, res) => {
  try {
    const { monitoringSessionId } = req.body || {};
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.diagnosticCompleted) {
      return res.status(400).json({
        success: false,
        message: 'Diagnostic already completed',
        data: {
          diagnosticScore: user.diagnosticScore,
          currentLevel: user.currentLevel,
        },
      });
    }

    const lockState = await clearExpiredDiagnosticLock(user);
    if (lockState.isLocked) {
      return respondWithDiagnosticLock(res, lockState);
    }

    const monitoringSessionQuery = {
      userId: req.user._id,
      sessionType: 'diagnostic',
      status: 'active',
    };

    if (monitoringSessionId) {
      monitoringSessionQuery._id = monitoringSessionId;
    }

    // Trust an already-created active monitoring session instead of re-checking
    // ML readiness here. The readiness gate is enforced when the session starts,
    // and re-checking it during diagnostic launch can block valid sessions if the
    // health endpoint is temporarily slow or inconsistent.
    let monitoringSessionLookup = MonitoringSession.findOne(monitoringSessionQuery);
    if (!monitoringSessionId) {
      monitoringSessionLookup = monitoringSessionLookup.sort({ startedAt: -1, createdAt: -1 });
    }

    const monitoringSession = await monitoringSessionLookup
      .select('_id finalFlagged status sessionType');

    if (!monitoringSession) {
      return res.status(400).json({
        success: false,
        message: 'A live diagnostic monitoring session is required before the diagnostic can start.',
      });
    }

    if (monitoringSession.finalFlagged) {
      const refreshedUser = await User.findById(req.user._id).select('diagnosticLock');
      const monitoringLockState = buildDiagnosticLockState(refreshedUser);

      if (monitoringLockState.isLocked) {
        return respondWithDiagnosticLock(res, monitoringLockState);
      }

      return res.status(400).json({
        success: false,
        message: 'The current diagnostic monitoring session is already flagged and cannot be reused.',
      });
    }

    await expireInProgressDiagnosticSessions(user._id);

    const sessionInfo = await adaptiveDiagnosticService.createSession(user._id.toString(), {
      institutionId: user.institutionId ? String(user.institutionId) : null,
      currentStreak: user.currentStreak || 0,
    });
    const activeSession = adaptiveDiagnosticService.activeSessions.get(sessionInfo.token);

    await DiagnosticSession.create({
      userId: user._id,
      sessionToken: sessionInfo.token,
      monitoringSessionId: monitoringSession._id,
      totalQuestions: sessionInfo.totalQuestions,
      minQuestions: sessionInfo.minQuestions,
      maxQuestions: sessionInfo.maxQuestions,
      timePerQuestion: sessionInfo.timePerQuestion,
      answeredCount: 0,
      topicsCovered: [...new Set(activeSession.plan.map((item) => item.topic))],
      questionPlan: activeSession.plan.map((item) => ({
        topic: item.topic,
        difficulty: item.difficulty,
        source: item.sourceId ? 'db' : 'pool',
        sourceId: item.sourceId || '',
        questionIndex: item.variantIndex || 0,
      })),
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_MS),
    });

    return res.json({
      success: true,
      data: {
        token: sessionInfo.token,
        minQuestions: sessionInfo.minQuestions,
        maxQuestions: sessionInfo.maxQuestions,
        totalQuestions: sessionInfo.totalQuestions,
        timePerQuestion: sessionInfo.timePerQuestion,
        expiresIn: sessionInfo.expiresIn,
      },
      message: 'Diagnostic session started',
    });
  } catch (error) {
    if (error?.code === DIAGNOSTIC_POOL_INCOMPLETE) {
      return res.status(503).json({
        success: false,
        code: DIAGNOSTIC_POOL_INCOMPLETE,
        message: `Diagnostic question bank is incomplete for ${error?.meta?.topicKey || 'the requested topic'}.`,
        data: error.meta || {},
      });
    }

    console.error('Diagnostic start error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getQuestion = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const question = await adaptiveDiagnosticService.generateNextQuestion(token);
    return res.json({
      success: true,
      data: question,
      message: 'Next question retrieved',
    });
  } catch (error) {
    if (['Session not found', 'Session expired', 'All questions already answered'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic question error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const submitAnswer = async (req, res) => {
  try {
    const { token, selectedOption, timeTaken } = req.body;
    if (!token || selectedOption === undefined) {
      return res.status(400).json({ success: false, message: 'Token and selectedOption are required' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const result = await adaptiveDiagnosticService.submitAnswer(token, selectedOption, timeTaken || 0);
    const activeSession = adaptiveDiagnosticService.activeSessions.get(token);

    await DiagnosticSession.findOneAndUpdate(
      { sessionToken: token },
      {
        $set: {
          totalQuestions: activeSession?.plan?.length || MIN_QUESTIONS,
        },
        $inc: { answeredCount: 1 },
        $push: {
          answers: {
            topic: result.topic,
            difficulty: result.difficulty,
            isCorrect: result.isCorrect,
            selectedOption: result.selectedOption,
            timeTaken: result.timeTaken,
            wasTimedOut: result.selectedOption === -1,
          },
        },
      }
    );

    return res.json({
      success: true,
      data: result,
      message: 'Answer submitted',
    });
  } catch (error) {
    if (['Session not found', 'Session expired', 'No question loaded'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic answer error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const completeDiagnostic = async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const persistedSession = await getSessionOrThrow({
      sessionToken: token,
      userId: req.user._id,
    });

    if (persistedSession.mcqPhaseCompleted && Array.isArray(persistedSession.codingProblems) && persistedSession.codingProblems.length) {
      return res.json({
        success: true,
        data: {
          mcqPhaseComplete: true,
          codingProblems: persistedSession.codingProblems.map(stripHiddenProblemFields),
          totalProblems: persistedSession.codingProblems.length,
          mcqScore: Number(((persistedSession.mcqScore || 0) * 50).toFixed(1)),
        },
        message: 'Coding phase ready',
      });
    }

    let sessionResults;
    try {
      sessionResults = adaptiveDiagnosticService.completeSession(token);
    } catch (completeError) {
      if (!['Session not found', 'Session expired'].includes(completeError.message)) {
        throw completeError;
      }

      if (!persistedSession.answers?.length) {
        throw completeError;
      }

      sessionResults = {
        ...buildResults(persistedSession.answers),
        answers: persistedSession.answers,
      };
    }

    const mcqScore = clamp(Number(sessionResults.totalCorrect || 0) / Math.max(Number(sessionResults.totalQuestions || 0), 1));
    const selectedProblems = getSeededCodingProblems(token, req.user._id.toString());

    persistedSession.mcqPhaseCompleted = true;
    persistedSession.mcqScore = mcqScore;
    persistedSession.codingStartedAt = new Date();
    persistedSession.codingProblems = selectedProblems;
    persistedSession.totalQuestions = sessionResults.totalQuestions;
    persistedSession.result = {
      totalScore: sessionResults.totalScore,
      perTopicScores: sessionResults.perTopicScores,
      avgTimePerQuestion: sessionResults.avgTimePerQuestion,
      assignedLevel: null,
      mlConfidence: 0,
      readinessScore: 0,
      unansweredCount: sessionResults.unansweredCount,
      malpractice: {
        riskLevel: 'NONE',
        riskScore: 0,
        cheatingProbability: 0,
      },
    };
    await persistedSession.save();

    return res.json({
      success: true,
      data: {
        mcqPhaseComplete: true,
        mcqScore: Number((mcqScore * 50).toFixed(1)),
        codingProblems: selectedProblems.map(stripHiddenProblemFields),
        totalProblems: selectedProblems.length,
      },
      message: 'MCQ phase completed',
    });
  } catch (error) {
    if (['Diagnostic session not found', 'Diagnostic session expired', 'Session not found', 'Session expired'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic MCQ completion error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const openCodingProblem = async (req, res) => {
  try {
    const sessionToken = getSessionToken(req);
    const { problemId } = req.body;

    if (!sessionToken || !problemId) {
      return res.status(400).json({ success: false, message: 'sessionToken and problemId are required' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const session = await getSessionOrThrow({
      sessionToken,
      userId: req.user._id,
    });

    if (!session.mcqPhaseCompleted) {
      return res.status(400).json({ success: false, message: 'Complete the MCQ phase before opening coding problems' });
    }

    const { index, problem } = getCodingProblemFromSession(session, problemId);
    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found in this diagnostic session' });
    }

    if (!problem.startedAt) {
      session.codingProblems[index].startedAt = new Date();
      session.markModified('codingProblems');
      await session.save();
    }

    const startedAt = session.codingProblems[index].startedAt;
    const elapsedSeconds = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
    const remainingSeconds = Math.max(0, Math.ceil(Number(problem.timeLimit || 0) - elapsedSeconds));
    const locked = elapsedSeconds > Number(problem.timeLimit || 0) + 30 || Number(problem.attemptCount || 0) >= 3;

    return res.json({
      success: true,
      data: {
        problemId,
        startedAt,
        remainingSeconds,
        locked,
      },
    });
  } catch (error) {
    if (['Diagnostic session not found', 'Diagnostic session expired'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic coding open error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const submitCodingProblem = async (req, res) => {
  try {
    const sessionToken = getSessionToken(req);
    const { problemId, code, language } = req.body;

    if (!sessionToken || !problemId || !code || !language) {
      return res.status(400).json({
        success: false,
        message: 'sessionToken, problemId, code, and language are required',
      });
    }

    if (String(language).toLowerCase() !== 'java') {
      return res.status(400).json({ success: false, message: 'Only Java submissions are supported for this diagnostic' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const session = await getSessionOrThrow({
      sessionToken,
      userId: req.user._id,
    });

    const { index, problem } = getCodingProblemFromSession(session, problemId);
    if (!problem) {
      return res.status(404).json({ success: false, message: 'Coding problem not found in this diagnostic session' });
    }

    if (Number(problem.attemptCount || 0) >= 3) {
      return res.status(400).json({ success: false, message: 'Maximum submission attempts reached for this problem' });
    }

    if (!session.codingProblems[index].startedAt) {
      session.codingProblems[index].startedAt = new Date();
    }

    const startedAt = new Date(session.codingProblems[index].startedAt).getTime();
    const submittedAt = new Date();
    const elapsedSeconds = Number(((submittedAt.getTime() - startedAt) / 1000).toFixed(2));
    const graceLimit = Number(problem.timeLimit || 0) + 30;

    if (elapsedSeconds > graceLimit) {
      session.codingProblems[index].timeSpent = Math.max(Number(problem.timeSpent || 0), graceLimit);
      session.markModified('codingProblems');
      await session.save();
      return res.status(400).json({ success: false, message: 'Time limit exceeded for this problem' });
    }

    const testCases = [
      ...(problem.visibleTestCases || []).map((testCase) => ({
        ...toPlainTestCase(testCase),
        isHidden: false,
      })),
      ...(problem.hiddenTestCases || []).map((testCase) => ({
        ...toPlainTestCase(testCase),
        isHidden: true,
      })),
    ];

    const remoteResult = await runDiagnosticProblem(problemId, code, testCases);
    let submissionPayload;

    if (remoteResult.serviceUnavailable) {
      const visibleOnlyCases = (problem.visibleTestCases || []).map((testCase) => ({
        ...toPlainTestCase(testCase),
        isHidden: false,
      }));
      const fallbackResult = await runDiagnosticProblemLocally(problemId, code, visibleOnlyCases);
      const actualVisibleScore = Number(fallbackResult.passedCount || 0) / Math.max(Number(fallbackResult.totalCount || 0), 1);
      const scaledScore = Number((actualVisibleScore * 0.5).toFixed(4));
      const visibleResults = visibleOnlyCases.map((testCase, resultIndex) =>
        sanitizeVisibleResult(testCase, fallbackResult.results[resultIndex])
      );

      submissionPayload = {
        score: scaledScore,
        passedVisible: Number(fallbackResult.passedCount || 0),
        totalVisible: Number(fallbackResult.totalCount || 0),
        passedHidden: 0,
        totalHidden: (problem.hiddenTestCases || []).length,
        status: fallbackResult.overallStatus,
        executionTime: Math.max(...fallbackResult.results.map((item) => Number(item.time || 0)), 0),
        visibleResults,
        judge0Result: {
          mode: 'fallback_visible_only',
          passedCount: Number(fallbackResult.passedCount || 0),
          totalCount: Number(fallbackResult.totalCount || 0),
          passedVisible: Number(fallbackResult.passedCount || 0),
          totalVisible: Number(fallbackResult.totalCount || 0),
          passedHidden: 0,
          totalHidden: (problem.hiddenTestCases || []).length,
          status: fallbackResult.overallStatus,
          executionTime: Math.max(...fallbackResult.results.map((item) => Number(item.time || 0)), 0),
          visibleResults,
          error: remoteResult.error || '',
          fallbackUsed: true,
        },
      };
    } else {
      const visibleResults = (problem.visibleTestCases || []).map((testCase, resultIndex) =>
        sanitizeVisibleResult(testCase, remoteResult.results[resultIndex])
      );
      const passedVisible = remoteResult.results.filter((result) => !result.isHidden && result.passed).length;
      const totalVisible = remoteResult.results.filter((result) => !result.isHidden).length;
      const passedHidden = remoteResult.results.filter((result) => result.isHidden && result.passed).length;
      const totalHidden = remoteResult.results.filter((result) => result.isHidden).length;
      const score = Number((Number(remoteResult.passedCount || 0) / Math.max(Number(remoteResult.totalCount || 0), 1)).toFixed(4));

      submissionPayload = {
        score,
        passedVisible,
        totalVisible,
        passedHidden,
        totalHidden,
        status: remoteResult.overallStatus,
        executionTime: Math.max(...remoteResult.results.map((item) => Number(item.time || 0)), 0),
        visibleResults,
        judge0Result: {
          mode: remoteResult.executionMode || 'judge0',
          passedCount: Number(remoteResult.passedCount || 0),
          totalCount: Number(remoteResult.totalCount || 0),
          passedVisible,
          totalVisible,
          passedHidden,
          totalHidden,
          status: remoteResult.overallStatus,
          executionTime: Math.max(...remoteResult.results.map((item) => Number(item.time || 0)), 0),
          visibleResults,
          fallbackUsed: false,
        },
      };
    }

    const nextAttemptCount = Number(problem.attemptCount || 0) + 1;
    const previousBest = Number(problem.bestScore || 0);
    const nextBest = Math.max(previousBest, submissionPayload.score);

    session.codingProblems[index].submissions.push({
      code: String(code),
      judge0Result: submissionPayload.judge0Result,
      score: submissionPayload.score,
      timeTaken: elapsedSeconds,
      submittedAt,
    });
    session.codingProblems[index].attemptCount = nextAttemptCount;
    session.codingProblems[index].bestScore = nextBest;
    session.codingProblems[index].timeSpent = Math.max(Number(problem.timeSpent || 0), Math.min(elapsedSeconds, graceLimit));
    session.codingProblems[index].lastSubmittedAt = submittedAt;
    session.markModified('codingProblems');
    await session.save();

    return res.json({
      success: true,
      data: {
        score: submissionPayload.score,
        passedVisible: submissionPayload.passedVisible,
        totalVisible: submissionPayload.totalVisible,
        passedHidden: submissionPayload.passedHidden,
        totalHidden: submissionPayload.totalHidden,
        status: submissionPayload.status,
        attemptsLeft: 3 - nextAttemptCount,
        executionTime: submissionPayload.executionTime,
        visibleResults: submissionPayload.visibleResults,
        bestScore: nextBest,
      },
      message: 'Coding submission processed',
    });
  } catch (error) {
    if (['Diagnostic session not found', 'Diagnostic session expired'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic coding submit error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const completeCodingPhase = async (req, res) => {
  try {
    const sessionToken = getSessionToken(req);
    const { sessionData = {}, monitoringSessionId } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ success: false, message: 'sessionToken is required' });
    }

    const unlockedUser = await enforceDiagnosticUnlocked(req.user._id, res);
    if (!unlockedUser) {
      return;
    }

    const session = await getSessionOrThrow({
      sessionToken,
      userId: req.user._id,
    });

    if (!session.mcqPhaseCompleted) {
      return res.status(400).json({ success: false, message: 'MCQ phase is not complete yet' });
    }

    const persistedMcqResults = buildPersistedMcqResults(session);
    const breakdown = buildCodingBreakdown(session.codingProblems || []);
    const codingMetrics = buildCodingMetrics(session.codingProblems || [], breakdown);
    const attemptedProblems = (session.codingProblems || []).filter(
      (problem) => Number(problem.attemptCount || 0) > 0
    ).length;


    const mcqMetrics = buildMcqMetrics(persistedMcqResults, session.answers || []);
    const combinedFeatures = buildCombinedFeatures(mcqMetrics, codingMetrics);
    const features = {
      ...mcqMetrics,
      ...codingMetrics,
      ...combinedFeatures,
    };
    const codingTopicScores = buildCodingTopicScores(breakdown);
    const mlResult = await classifyDiagnosticWithMl(features, codingTopicScores);

    let level = canonicalizeLevel(mlResult.level);
    if (!ALLOWED_LEVELS.includes(level)) {
      level = buildFallbackMlResponse(features, codingTopicScores).level;
    }

    const combinedScorePercent = Math.round(combinedFeatures.combined_score * 100);
    const placementReadiness = combinedScorePercent;
    const malpracticeSummary = await finalizeMonitoringIfNeeded({
      req,
      session,
      sessionData,
      monitoringSessionId,
      user: req.user,
      combinedScorePercent,
      answers: session.answers || [],
    });

    session.status = 'completed';
    session.codingCompletedAt = new Date();
    session.codingScore = codingMetrics.coding_score;
    session.result = {
      totalScore: combinedScorePercent,
      perTopicScores: {
        ...(session.result?.perTopicScores || {}),
        ...codingTopicScores,
      },
      avgTimePerQuestion: persistedMcqResults.avgTimePerQuestion,
      assignedLevel: level,
      mlConfidence: Number(mlResult.confidence || 0),
      readinessScore: placementReadiness,
      unansweredCount: persistedMcqResults.unansweredCount,
      malpractice: {
        riskLevel: malpracticeSummary?.riskLevel
          || (malpracticeSummary?.finalFlagged ? 'HIGH' : 'NONE'),
        riskScore: Number(malpracticeSummary?.riskScore || 0),
        cheatingProbability: Number(malpracticeSummary?.cheatingProbability || 0),
      },
    };
    await session.save();

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        diagnosticCompleted: true,
        diagnosticScore: combinedScorePercent,
        currentLevel: level,
        placementReadiness,
        isProfileComplete: true,
      },
      { new: true }
    );

    let roadmap = null;
    let roadmapCreated = false;
    try {
      const roadmapResult = await generateRoadmap(req.user._id, level);
      roadmap = {
        id: roadmapResult.roadmap._id,
        planType: roadmapResult.roadmap.planType,
        totalDays: roadmapResult.roadmap.totalDays,
        currentDay: roadmapResult.roadmap.currentDay,
      };
      roadmapCreated = true;
    } catch (roadmapError) {
      console.error('Roadmap generation failed:', roadmapError.message);
    }

    const totalCodingMinutes = Math.round(
      (session.codingProblems || []).reduce((sum, problem) => sum + Number(problem.timeSpent || 0), 0) / 60
    );
    const totalMcqMinutes = Math.round(
      (persistedMcqResults.avgTimePerQuestion * Math.max(persistedMcqResults.totalQuestions, 0)) / 60
    );

    await logActivity(
      req.user._id,
      1,
      Math.max(1, totalCodingMinutes + totalMcqMinutes),
      ['Diagnostic', 'Diagnostic Coding']
    );

    return res.json({
      success: true,
      data: {
        level,
        roadmap,
        roadmapCreated,
        mcqScore: Number((mcqMetrics.mcq_score * 50).toFixed(1)),
        mcqScoreRatio: Number(mcqMetrics.mcq_score.toFixed(4)),
        codingScore: Number((codingMetrics.coding_score * 10).toFixed(1)),
        codingScoreRatio: Number(codingMetrics.coding_score.toFixed(4)),
        combinedScore: combinedScorePercent,
        breakdown,
        confidence: Number(mlResult.confidence || 0),
        probabilities: mlResult.probabilities || {},
        confidenceExplanation: mlResult.confidence_explanation || '',
        weakAreas: mlResult.weak_areas || [],
        strongAreas: mlResult.strong_areas || [],
        recommendedPlan: mlResult.recommended_plan || PLAN_BY_LEVEL[level],
        modelMetadata: mlResult.model_metadata || null,
        codingTopicScores,
        perTopicScores: {
          ...(session.result?.perTopicScores || {}),
          ...codingTopicScores,
        },
        placementReadiness,
        malpractice: malpracticeSummary,
      },
      message: 'Diagnostic completed',
    });
  } catch (error) {
    if (['Diagnostic session not found', 'Diagnostic session expired'].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Diagnostic coding complete error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

module.exports = {
  startDiagnostic,
  getQuestion,
  submitAnswer,
  completeDiagnostic,
  getLatestDiagnosticSummary,
  openCodingProblem,
  submitCodingProblem,
  completeCodingPhase,
  __test__: {
    finalizeMonitoringIfNeeded,
  },
};
