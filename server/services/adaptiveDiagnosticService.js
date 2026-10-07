const { v4: uuidv4 } = require('uuid');
const Module = require('../models/Module');
const MCQ = require('../models/MCQ');
const Topic = require('../models/Topic');
const {
  classifyLevel,
  buildDiagnosticPerformanceData,
} = require('./mlService');

const TOPIC_MODULE_ORDERS = {
  arrays: 3,
  strings: 4,
  searching: 5,
  sorting: 6,
  recursion: 7,
  linked_lists: 8,
  stack_queue: 9,
  trees: 10,
  graphs: 12,
  dp: 13,
};
const MIN_QUESTIONS = 30;
const MAX_QUESTIONS = 50;
const CORE_QUESTIONS_PER_TOPIC = 3;
const ADAPTIVE_BLOCK_SIZE = 5;
const QUESTION_TIME_LIMIT = 45;
const SESSION_EXPIRY_MS = 60 * 60 * 1000;
const DIAGNOSTIC_POOL_INCOMPLETE = 'DIAGNOSTIC_POOL_INCOMPLETE';

const difficultyWeight = {
  Hard: 3,
  Medium: 2,
  Basic: 1,
};

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, rng) {
  const items = [...array];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function buildDiagnosticPoolError(message, meta = {}) {
  const error = new Error(message);
  error.code = DIAGNOSTIC_POOL_INCOMPLETE;
  error.meta = meta;
  return error;
}

function buildResults(answers = []) {
  const total = answers.length;
  const totalCorrect = answers.filter((answer) => answer.isCorrect).length;
  const totalScore = total > 0 ? (totalCorrect / total) * 100 : 0;
  const unansweredCount = answers.filter((answer) => answer.wasTimedOut).length;
  const topicBreakdown = {};

  answers.forEach((answer) => {
    if (!topicBreakdown[answer.topic]) {
      topicBreakdown[answer.topic] = {
        correct: 0,
        total: 0,
        hard: 0,
        medium: 0,
        basic: 0,
      };
    }

    const bucket = topicBreakdown[answer.topic];
    bucket.total += 1;
    if (answer.isCorrect) bucket.correct += 1;

    const normalizedDifficulty = String(answer.difficulty || 'Hard').toLowerCase();
    if (normalizedDifficulty === 'hard') bucket.hard += 1;
    else if (normalizedDifficulty === 'medium') bucket.medium += 1;
    else bucket.basic += 1;
  });

  const perTopicScores = Object.fromEntries(
    Object.entries(topicBreakdown).map(([topic, bucket]) => [
      topic,
      bucket.total > 0 ? (bucket.correct / bucket.total) * 100 : 0,
    ])
  );

  return {
    totalScore,
    totalCorrect,
    totalQuestions: total,
    perTopicScores,
    avgTimePerQuestion: total > 0
      ? answers.reduce((sum, answer) => sum + (answer.timeTaken || 0), 0) / total
      : 0,
    unansweredCount,
    topicBreakdown,
  };
}

class AdaptiveDiagnosticService {
  constructor() {
    this.activeSessions = new Map();
    this.topicKeys = Object.keys(TOPIC_MODULE_ORDERS);
  }

  async createSession(userId, options = {}) {
    const token = uuidv4();
    const seed = parseInt(token.replace(/-/g, '').slice(0, 8), 16) || Date.now();
    const rng = mulberry32(seed);
    const pools = await this._buildPools(rng);
    const poolBackups = Object.fromEntries(
      Object.entries(pools).map(([topic, items]) => [topic, items.map((item) => ({ ...item }))])
    );
    const plan = this._buildCorePlan(pools, rng);

    const session = {
      token,
      userId,
      institutionId: options.institutionId || null,
      currentStreak: options.currentStreak || 0,
      minQuestions: MIN_QUESTIONS,
      maxQuestions: MAX_QUESTIONS,
      timePerQuestion: QUESTION_TIME_LIMIT,
      plan,
      pools,
      poolBackups,
      answers: [],
      currentIndex: 0,
      currentQuestion: null,
      latestAdaptiveConfidence: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_EXPIRY_MS,
    };

    this.activeSessions.set(token, session);
    setTimeout(() => this.activeSessions.delete(token), SESSION_EXPIRY_MS);

    return {
      token,
      minQuestions: MIN_QUESTIONS,
      maxQuestions: MAX_QUESTIONS,
      totalQuestions: MIN_QUESTIONS,
      timePerQuestion: QUESTION_TIME_LIMIT,
      expiresIn: Math.round(SESSION_EXPIRY_MS / 1000),
      blueprintVersion: 'adaptive-v1',
    };
  }

  async generateNextQuestion(token) {
    const session = this._getSession(token);

    if (session.currentIndex >= session.plan.length) {
      throw new Error('All questions already answered');
    }

    const spec = session.plan[session.currentIndex];
    const optionSeed = this._seedFromString(
      `${token}_${session.currentIndex}_${spec.topic}_${spec.sourceId || spec.variantIndex || 'q'}`
    );
    const { shuffledOptions, newCorrectIndex } = this._shuffleOptions(
      spec.options,
      spec.correctAnswer,
      mulberry32(optionSeed)
    );

    session.currentQuestion = {
      topic: spec.topic,
      difficulty: spec.difficulty,
      sourceId: spec.sourceId || '',
      correctIndex: newCorrectIndex,
      timeLimit: QUESTION_TIME_LIMIT,
    };

    return {
      questionNumber: session.currentIndex + 1,
      currentTarget: session.plan.length,
      minQuestions: session.minQuestions,
      maxQuestions: session.maxQuestions,
      topic: spec.topic,
      difficulty: spec.difficulty,
      question: spec.question,
      options: shuffledOptions,
      timeLimit: QUESTION_TIME_LIMIT,
      phase: session.currentIndex + 1 > session.minQuestions ? 'adaptive' : 'core',
    };
  }

  async submitAnswer(token, selectedOption, timeTaken = 0) {
    const session = this._getSession(token);
    if (!session.currentQuestion) throw new Error('No question loaded');

    const answer = {
      topic: session.currentQuestion.topic,
      difficulty: session.currentQuestion.difficulty,
      isCorrect: selectedOption === session.currentQuestion.correctIndex,
      selectedOption,
      timeTaken,
      wasTimedOut: selectedOption === -1,
    };

    session.answers.push(answer);
    session.currentIndex += 1;
    session.currentQuestion = null;

    let confidence = session.latestAdaptiveConfidence || 0;
    let isComplete = false;

    if (session.currentIndex >= session.plan.length) {
      if (session.currentIndex >= session.maxQuestions) {
        isComplete = true;
      } else if (session.currentIndex >= session.minQuestions) {
        const interim = buildResults(session.answers);
        try {
          const perfData = buildDiagnosticPerformanceData(interim, session.currentStreak || 0);
          const mlResult = await classifyLevel(perfData);
          confidence = Number(mlResult?.confidence || 0);
        } catch (error) {
          confidence = this._fallbackConfidence(interim);
        }

        session.latestAdaptiveConfidence = confidence;

        if (confidence >= 0.82) {
          isComplete = true;
        } else {
          this._appendAdaptiveQuestions(session);
        }
      }
    }

    return {
      topic: answer.topic,
      difficulty: answer.difficulty,
      isCorrect: answer.isCorrect,
      selectedOption,
      timeTaken,
      confidence,
      currentTarget: session.plan.length,
      questionsLeft: isComplete ? 0 : session.plan.length - session.currentIndex,
      isComplete,
    };
  }

  completeSession(token) {
    const session = this.activeSessions.get(token);
    if (!session) throw new Error('Session not found');

    const results = buildResults(session.answers);
    this.activeSessions.delete(token);

    return {
      ...results,
      answers: [...session.answers],
      minQuestions: session.minQuestions,
      maxQuestions: session.maxQuestions,
      timePerQuestion: session.timePerQuestion,
      latestAdaptiveConfidence: session.latestAdaptiveConfidence || 0,
    };
  }

  _getSession(token) {
    const session = this.activeSessions.get(token);
    if (!session) throw new Error('Session not found');
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      throw new Error('Session expired');
    }
    return session;
  }

  async _buildPools(rng) {
    console.log('Building diagnostic pools...');
    const requiredModuleOrders = Object.values(TOPIC_MODULE_ORDERS);
    const moduleDocs = await Module.find({
      order: { $in: requiredModuleOrders },
      isActive: true,
    })
      .select('_id order title')
      .lean();

    console.log('Found diagnostic modules:', moduleDocs.length);
    console.log('Diagnostic modules:', moduleDocs.map((moduleDoc) => ({
      id: moduleDoc._id,
      order: moduleDoc.order,
      title: moduleDoc.title,
    })));

    const moduleIdByOrder = Object.fromEntries(
      moduleDocs.map((moduleDoc) => [moduleDoc.order, String(moduleDoc._id)])
    );
    const moduleIds = moduleDocs.map((moduleDoc) => moduleDoc._id);

    const topicDocs = await Topic.find({
      moduleId: { $in: moduleIds },
    })
      .select('_id moduleId title order')
      .lean();

    console.log('Found diagnostic topics:', topicDocs.length);

    const topicIdsByKey = {};
    const topicDebugByKey = {};
    this.topicKeys.forEach((topicKey) => {
      const moduleOrder = TOPIC_MODULE_ORDERS[topicKey];
      const moduleId = moduleIdByOrder[moduleOrder];
      const topicDocsForKey = topicDocs.filter((topicDoc) => String(topicDoc.moduleId) === String(moduleId));

      topicIdsByKey[topicKey] = topicDocsForKey.map((topicDoc) => topicDoc._id);
      topicDebugByKey[topicKey] = {
        moduleOrder,
        moduleId: moduleId || null,
        topics: topicDocsForKey.map((topicDoc) => ({
          id: String(topicDoc._id),
          title: topicDoc.title,
          order: topicDoc.order,
        })),
      };
    });

    console.log('Diagnostic topic mapping:', topicDebugByKey);

    const allMcqs = await MCQ.find({
      moduleId: { $in: moduleIds },
      isActive: true,
    })
      .select('question options correctAnswer explanation timeLimit difficulty topicId moduleId')
      .lean();

    console.log('Found MCQs:', allMcqs.length);

    const pools = {};

    this.topicKeys.forEach((topicKey) => {
      const moduleOrder = TOPIC_MODULE_ORDERS[topicKey];
      const moduleId = moduleIdByOrder[moduleOrder];
      const topicIds = new Set((topicIdsByKey[topicKey] || []).map(String));

      const topicMcqs = allMcqs
        .filter((mcq) => String(mcq.moduleId) === String(moduleId))
        .sort((left, right) => (difficultyWeight[right.difficulty] || 0) - (difficultyWeight[left.difficulty] || 0));
      const uniqueMcqTopicIds = [...new Set(topicMcqs.map((mcq) => String(mcq.topicId)))];

      console.log(`Found ${topicMcqs.length} MCQs for ${topicKey} (module ${moduleOrder})`);

      const shuffled = seededShuffle(topicMcqs, rng).map((mcq, index) => ({
        topic: topicKey,
        difficulty: mcq.difficulty || 'Hard',
        sourceId: String(mcq._id),
        question: mcq.question,
        options: mcq.options,
        correctAnswer: mcq.correctAnswer,
        explanation: mcq.explanation,
        timeLimit: QUESTION_TIME_LIMIT,
        variantIndex: index,
      }));

      if (shuffled.length === 0) {
        const debugPayload = {
          topicKey,
          moduleOrder,
          moduleId: moduleId || null,
          topicIds: Array.from(topicIds),
          topicTitles: (topicDebugByKey[topicKey]?.topics || []).map((topicDoc) => topicDoc.title),
          mcqCountForModule: topicMcqs.length,
          mcqTopicIdsForModule: uniqueMcqTopicIds,
          requiredModuleOrders,
          foundModuleOrders: moduleDocs.map((moduleDoc) => moduleDoc.order),
        };
        console.error('Diagnostic pool build failure:', debugPayload);
        throw buildDiagnosticPoolError(
          `No active MCQs found for diagnostic topic ${topicKey} (module ${moduleOrder})`,
          {
            topicKey,
            moduleOrder,
            moduleId: moduleId || null,
            foundModuleOrders: moduleDocs.map((moduleDoc) => moduleDoc.order),
          }
        );
      }

      pools[topicKey] = shuffled;
    });

    console.log('Pools built successfully');
    return pools;
  }

  _buildCorePlan(pools, rng) {
    const plan = [];
    for (let round = 0; round < CORE_QUESTIONS_PER_TOPIC; round += 1) {
      const roundTopics = seededShuffle(this.topicKeys, rng);
      roundTopics.forEach((topicKey) => {
        const question = this._takeQuestionFromPool({ pools }, topicKey);
        if (question) plan.push(question);
      });
    }
    return plan;
  }

  _appendAdaptiveQuestions(session) {
    if (session.plan.length >= session.maxQuestions) return;

    const metrics = this.topicKeys
      .map((topic) => {
        const attempts = session.answers.filter((answer) => answer.topic === topic);
        const total = attempts.length;
        const score = total > 0
          ? (attempts.filter((answer) => answer.isCorrect).length / total) * 100
          : 0;
        const timeouts = attempts.filter((answer) => answer.wasTimedOut).length;
        const advancedBonus = ['trees', 'graphs', 'dp', 'sorting', 'recursion'].includes(topic) ? 10 : 0;
        const uncertainty = total === 0
          ? 100 + advancedBonus
          : Math.abs(70 - score) + (timeouts * 8) + advancedBonus;
        return { topic, uncertainty };
      })
      .sort((left, right) => right.uncertainty - left.uncertainty);

    const nextQuestions = [];
    for (const metric of metrics) {
      if (nextQuestions.length >= ADAPTIVE_BLOCK_SIZE) break;
      const candidate = this._takeQuestionFromPool(session, metric.topic);
      if (candidate) nextQuestions.push(candidate);
    }

    session.plan.push(
      ...nextQuestions.slice(0, Math.max(0, session.maxQuestions - session.plan.length))
    );
  }

  _takeQuestionFromPool(container, topicKey) {
    const pool = container.pools?.[topicKey] || [];
    if (pool.length > 0) return pool.shift();

    const backupPool = container.poolBackups?.[topicKey] || [];
    if (backupPool.length > 0) {
      const recycled = backupPool[Math.floor(Math.random() * backupPool.length)];
      return {
        ...recycled,
        sourceId: `${recycled.sourceId || topicKey}-recycled-${Date.now()}`,
      };
    }
    return null;
  }

  _fallbackConfidence(results) {
    const answered = Math.max(results.totalQuestions || 1, 1);
    const score = results.totalScore || 0;
    const boundaryDistance = Math.max(Math.abs(score - 50), Math.abs(score - 70));
    return Math.max(
      0.55,
      Math.min(0.9, 0.52 + (boundaryDistance / 100) * 0.2 + Math.min(answered / MIN_QUESTIONS, 1) * 0.18)
    );
  }

  _shuffleOptions(options, correctAnswer, rng) {
    const mapped = options.map((option, index) => ({ option, index }));
    for (let current = mapped.length - 1; current > 0; current -= 1) {
      const swapIndex = Math.floor(rng() * (current + 1));
      [mapped[current], mapped[swapIndex]] = [mapped[swapIndex], mapped[current]];
    }

    return {
      shuffledOptions: mapped.map((entry) => entry.option),
      newCorrectIndex: mapped.findIndex((entry) => entry.index === correctAnswer),
    };
  }

  _seedFromString(input) {
    return Array.from(String(input)).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }
}

module.exports = {
  TOPIC_MODULE_ORDERS,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  QUESTION_TIME_LIMIT,
  SESSION_EXPIRY_MS,
  DIAGNOSTIC_POOL_INCOMPLETE,
  buildResults,
  service: new AdaptiveDiagnosticService(),
};
