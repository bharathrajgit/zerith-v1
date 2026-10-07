// server/services/antiMalpractice.js
const crypto = require('crypto');
const MalpracticeLog = require('../models/MalpracticeLog');

class AntiMalpracticeService {

  /**
   * Layer 1 – Question selection.
   * Given a pool of question IDs, deterministically but uniquely select 5 per user/topic/day.
   * @param {Array} questionIds - array of question IDs (string or ObjectId)
   * @param {String} userId
   * @param {String} topicId
   * @returns {Array} 5 selected question IDs
   */
  shuffleQuestions(questionIds, userId, topicId) {
    // create seed from userId + topicId + today's date (YYYY‑MM‑DD)
    const today = new Date().toISOString().slice(0, 10);
    const seed = `${userId}_${topicId}_${today}`;
    const rng = this._seededRandom(seed);
    // copy and shuffle
    const pool = [...questionIds];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // pick first 5
    return pool.slice(0, 5);
  }

  /**
   * Layer 2 – Option order randomization.
   * @param {Object} question - MCQ document (with options array, correctAnswer index)
   * @param {String} userId
   * @returns {{ question, options, shuffledCorrectIndex, originalQuestionId }}
   */
  shuffleOptions(question, userId) {
    const seed = `${userId}_${question._id}`;
    const rng = this._seededRandom(seed);
    const options = [...question.options];
    const correctOriginal = question.correctAnswer;
    // shuffle
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    // find new index of the original correct answer
    const originalCorrectValue = question.options[correctOriginal];
    const newCorrectIndex = options.indexOf(originalCorrectValue);
    return {
      question: question.question,
      options: options,
      shuffledCorrectIndex: newCorrectIndex,   // NEVER sent to client
      originalQuestionId: question._id
    };
  }

  /**
   * Layer 5 – Decoy question injection.
   * Replaces 1 of the 5 questions with a decoy (common misconception trap).
   * The decoy is marked as isDecoy:true in the returned questions array.
   * @param {Array} questionsPool - array of MCQ documents
   * @param {String} userId - used for seed to choose which position to replace
   * @returns {Array} array of 5 question objects with isDecoy flag where applicable
   */
  addDecoyDetection(questionsPool, userId) {
    if (questionsPool.length < 5) return questionsPool; // not enough to inject
    const seed = `${userId}_decoy`;
    const rng = this._seededRandom(seed);
    const replaceIndex = Math.floor(rng() * 5);
    // Use a decoy question that looks like correct answer is 0 but actually is 1 (or whatever)
    // Here we use a hardcoded decoy question; you could pull from a separate collection.
    const decoyQuestion = {
      _id: 'decoy_' + userId,   // not a real ObjectId
      question: 'In Java, which collection allows duplicate elements?',
      options: ['Set', 'List', 'Map', 'Queue'],
      correctAnswer: 1, // List
      explanation: 'List allows duplicates; Set does not. Common mistake.',
      isDecoy: true
    };
    // Also need to adjust for the shuffle: we'll later shuffle options. To keep it simple, mark the decoy and treat it normally.
    const modifiedPool = [...questionsPool];
    // We'll replace one question with decoy, but we need to ensure the return format matches what's expected.
    // The controller expects the original questions structure, but for decoy we want the extra flag.
    // We'll store the decoy flag on the question object itself.
    // However, our shuffleOptions expects an MCQ document with options and correctAnswer. So we'll create a mock MCQ.
    const decoyMcq = {
      _id: 'decoy_' + userId,
      question: decoyQuestion.question,
      options: decoyQuestion.options,
      correctAnswer: decoyQuestion.correctAnswer,
      explanation: decoyQuestion.explanation,
      isDecoy: true
    };
    // Choose a random position to replace
    const pos = Math.floor(Math.random() * 5);
    modifiedPool[pos] = decoyMcq;
    return modifiedPool;
  }

  /**
   * Layer 6 – Behavioral analysis.
   * @param {Object} sessionData - see prompt for structure
   * @returns {{ riskLevel, riskScore, flags, reasons }}
   */
  analyzeSession(sessionData) {
    const { answers, tabSwitches = 0, copyAttempts = 0, windowBlurCount = 0 } = sessionData;
    const flags = [];
    const reasons = [];
    let riskScore = 0;

    // Pattern 1: Speed anomaly – average answer time < 4 seconds
    if (answers && answers.length > 0) {
      const times = answers.map(a => a.timeToAnswer || 0).filter(t => t > 0);
      if (times.length > 0) {
        const avgTime = times.reduce((s, t) => s + t, 0) / times.length;
        if (avgTime < 4) {
          flags.push('SPEED');
          reasons.push(`Average answer time ${avgTime.toFixed(1)}s (< 4s) indicates rapid guessing`);
          riskScore += 0.25;
        }
        // Pattern 5: Timing consistency (stddev < 1.5s)
        if (times.length >= 2) {
          const mean = avgTime;
          const variance = times.reduce((s, t) => s + (t - mean) ** 2, 0) / times.length;
          const stdDev = Math.sqrt(variance);
          if (stdDev < 1.5) {
            flags.push('TIMING_ANOMALY');
            reasons.push('Answer times too consistent (possible automated script)');
            riskScore += 0.25;
          }
        }
        // Pattern 6: Fast-then-slow (first 3 fast, last 2 slow)
        if (times.length >= 5) {
          const first3 = times.slice(0, 3).reduce((s, t) => s + t, 0) / 3;
          const last2 = times.slice(-2).reduce((s, t) => s + t, 0) / 2;
          if (first3 < 5 && last2 > 20) {
            flags.push('PATTERN_SHIFT');
            reasons.push('Answer pattern shifted from very fast to slow – possible lookup');
            riskScore += 0.15;
          }
        }
      }
    }

    // Tab switches
    if (tabSwitches > 2) {
      flags.push('TAB_SWITCH');
      reasons.push(`Tab switched ${tabSwitches} times`);
      riskScore += 0.20;
    }

    // Copy attempts
    if (copyAttempts > 0) {
      flags.push('COPY_ATTEMPT');
      reasons.push(`Copy attempt detected (${copyAttempts})`);
      riskScore += 0.35;
    }

    // Window blur (losing focus)
    if (windowBlurCount > 3) {
      flags.push('WINDOW_BLUR');
      reasons.push(`Window lost focus ${windowBlurCount} times`);
      riskScore += 0.20;
    }

    // Cap risk score
    riskScore = Math.min(riskScore, 1.0);

    // Determine risk level
    let riskLevel = 'LOW';
    if (riskScore >= 0.6) riskLevel = 'HIGH';
    else if (riskScore >= 0.3) riskLevel = 'MEDIUM';

    return {
      riskLevel,
      riskScore: Math.round(riskScore * 100) / 100,
      flags,
      reasons
    };
  }

  /**
   * Layer 7 – Session similarity between two assessment sessions.
   * @param {Object} sessionA - { answers: [{questionId, selectedOption}], timing: [numbers] }
   * @param {Object} sessionB - same structure
   * @returns {{ similarityScore, isSuspicious }}
   */
  compareSessions(sessionA, sessionB) {
    if (!sessionA || !sessionB) return { similarityScore: 0, isSuspicious: false };
    const answersA = sessionA.answers || [];
    const answersB = sessionB.answers || [];
    // Find common question IDs
    const commonIds = answersA
      .map(a => a.questionId)
      .filter(id => answersB.some(b => b.questionId === id));
    if (commonIds.length === 0) return { similarityScore: 0, isSuspicious: false };

    // Matching answers on common questions
    let matchCount = 0;
    for (const id of commonIds) {
      const ansA = answersA.find(a => a.questionId === id);
      const ansB = answersB.find(b => b.questionId === id);
      if (ansA && ansB && ansA.selectedOption === ansB.selectedOption) {
        matchCount++;
      }
    }
    const matchRate = matchCount / commonIds.length;

    // Timing correlation (simple: compare average times)
    const timesA = (sessionA.timings || []).slice(0, commonIds.length);
    const timesB = (sessionB.timings || []).slice(0, commonIds.length);
    let timingCorr = 0;
    if (timesA.length === timesB.length && timesA.length > 1) {
      let cov = 0, varA = 0, varB = 0;
      const meanA = timesA.reduce((s, t) => s + t, 0) / timesA.length;
      const meanB = timesB.reduce((s, t) => s + t, 0) / timesB.length;
      for (let i = 0; i < timesA.length; i++) {
        cov += (timesA[i] - meanA) * (timesB[i] - meanB);
        varA += (timesA[i] - meanA) ** 2;
        varB += (timesB[i] - meanB) ** 2;
      }
      if (varA > 0 && varB > 0) {
        timingCorr = cov / Math.sqrt(varA * varB);
        timingCorr = Math.abs(timingCorr); // we care about similarity, not direction
      }
    }

    const similarityScore = (matchRate * 0.7) + (timingCorr * 0.3);
    const isSuspicious = similarityScore > 0.8;

    return {
      similarityScore: Math.round(similarityScore * 100) / 100,
      isSuspicious
    };
  }

  /**
   * Save a MalpracticeLog if risk level is MEDIUM or HIGH.
   * @param {Object} analysisResult - from analyzeSession
   * @param {String} userId
   * @param {String} assessmentId
   * @param {String|null} institutionId
   * @param {Object} sessionData - original session data for detailed fields
   * @returns {{ saved: Boolean, logId: String|null }}
   */
  async saveIfSuspicious(
    analysisResult,
    userId,
    assessmentId,
    institutionId,
    sessionData = {},
    mlResult = {}
  ) {
    if (
      analysisResult.riskLevel === 'LOW' &&
      Number(mlResult?.cheating_probability || 0) < 0.55
    ) {
      return { saved: false, logId: null };
    }

    try {
      const log = await MalpracticeLog.create({
        userId,
        assessmentId,
        institutionId: institutionId || null,
        sessionType: sessionData?.sessionType || 'assessment',
        riskLevel: analysisResult.riskLevel,
        riskScore: analysisResult.riskScore,
        flags: analysisResult.flags,
        reasons: analysisResult.reasons,
        sessionData: {
          ipAddress: sessionData.ipAddress || '',
          tabSwitches: sessionData.tabSwitches || 0,
          copyAttempts: sessionData.copyAttempts || 0,
          windowBlurCount: sessionData.windowBlurCount || 0,
          avgAnswerTime: sessionData.answers ? sessionData.answers.reduce((s, a) => s + (a.timeToAnswer || 0), 0) / sessionData.answers.length : 0,
          totalQuestions: sessionData.answers?.length || 0,
          changedAnswers: sessionData.changedAnswers || 0,
          timingStdDev: (() => {
            const times = (sessionData.answers || []).map(a => a.timeToAnswer).filter(t => t > 0);
            if (times.length < 2) return 0;
            const mean = times.reduce((s, t) => s + t, 0) / times.length;
            const variance = times.reduce((s, t) => s + (t - mean) ** 2, 0) / times.length;
            return Math.sqrt(variance);
          })()
        },
        mlCheatingProbability: Number(mlResult?.cheating_probability || 0),
        mlCheatingLabel: Number(mlResult?.predicted_label || 0),
        mlCheatingFallback: !!mlResult?.fallback,
        monitoringSessionId: null,
      });
      return { saved: true, logId: log._id };
    } catch (err) {
      console.error('Failed to save malpractice log:', err);
      return { saved: false, logId: null };
    }
  }

  /* Private seeded random generator (consistent across calls) */
  _seededRandom(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return () => {
      hash ^= hash << 13;
      hash ^= hash >> 17;
      hash ^= hash << 5;
      return (hash < 0 ? ~hash + 1 : hash) / 0x7fffffff;
    };
  }
}

module.exports = new AntiMalpracticeService();
