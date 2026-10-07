/**
 * Calculate assessment score for a single round.
 * @param {Array} questions - Array of MCQ objects with correctAnswer
 * @param {Array} submissions - Array of { mcqId, selectedAnswer, timeTaken, hintsUsed }
 * @returns {Object} results
 */
const calculateAssessmentScore = (questions, submissions) => {
  const totalQuestions = questions.length;
  let correctAnswers = 0;

  const questionResults = submissions.map((submission) => {
    const question = questions.find(
      (q) => q._id.toString() === submission.mcqId.toString()
    );
    if (!question) {
      throw new Error(`MCQ ${submission.mcqId} not found in question set`);
    }
    const isCorrect = Number(submission.selectedAnswer) === question.correctAnswer;
    if (isCorrect) correctAnswers += 1;

    return {
      mcqId: submission.mcqId,
      isCorrect,
      selectedAnswer: submission.selectedAnswer,
      correctAnswer: question.correctAnswer,
      timeTaken: submission.timeTaken || 0,
    };
  });

  const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

  const totalTimeTaken = submissions.reduce((sum, submission) => sum + (submission.timeTaken || 0), 0);
  const averageTimeTaken = submissions.length > 0 ? totalTimeTaken / submissions.length : 0;

  return {
    correctAnswers,
    totalQuestions,
    accuracy: Math.round(accuracy * 100) / 100,
    averageTimeTaken: Math.round(averageTimeTaken * 100) / 100,
    passed: true, // will be overridden outside
    passCriteria: '',
    questionResults,
  };
};

const getRequiredCorrectAnswers = (round, totalQuestions) => {
  const criteria = {
    Basic: 0.8,
    Medium: 0.8,
    Hard: 0.6,
    Diagnostic: 0,
  };

  const requiredRatio = criteria[round] || 0;
  return round === 'Diagnostic'
    ? 0
    : Math.ceil(Math.max(Number(totalQuestions) || 0, 0) * requiredRatio);
};

/**
 * Determine pass/fail based on round difficulty and number correct.
 * @param {String} round - Basic/Medium/Hard/Diagnostic
 * @param {Number} correctAnswers - number of correct answers
 * @param {Number} totalQuestions - total questions in the round
 * @returns {Object} { passed, passCriteria }
 */
const evaluatePass = (round, correctAnswers, totalQuestions) => {
  const criteria = {
    Basic: 0.8,
    Medium: 0.8,
    Hard: 0.6,
    Diagnostic: 0,
  };
  const requiredRatio = criteria[round] || 0;
  const requiredCorrectAnswers = getRequiredCorrectAnswers(round, totalQuestions);
  const passed = round === 'Diagnostic'
    ? true
    : Number(correctAnswers || 0) >= requiredCorrectAnswers;

  return {
    passed,
    requiredCorrectAnswers,
    passCriteria:
      round === 'Diagnostic'
        ? 'Diagnostic test - no pass/fail'
        : `${Math.round(requiredRatio * 100)}% correct required (${requiredCorrectAnswers}/${totalQuestions})`,
  };
};

/**
 * Calculate mastery score from multiple round scores and behaviour.
 * @param {Number} mcqScore
 * @param {Number} codingScore
 * @param {Number} hintRate
 * @param {Number} retryRate
 * @returns {Object} { masteryScore, masteryLevel }
 */
const calculateMasteryScore = (mcqScore = 0, codingScore = 0, hintRate = 0, retryRate = 0) => {
  const hasCodingSignal = Number(codingScore) > 0;
  let score = hasCodingSignal
    ? mcqScore * 0.65 + codingScore * 0.35
    : mcqScore;

  score -= hintRate * 5;
  score -= retryRate * 3;

  score = Math.min(100, Math.max(0, Math.round(score)));

  let masteryLevel = 'Needs Revision';
  if (score >= 85) masteryLevel = 'Mastered';
  else if (score >= 70) masteryLevel = 'Proficient';
  else if (score >= 55) masteryLevel = 'Developing';

  return { masteryScore: score, masteryLevel };
};

// Module-based weights based on actual curriculum structure (14 modules)
const READINESS_MODULE_WEIGHTS = {
  fundamentals: 0.08,      // 7 topics - foundation
  patterns: 0.04,          // 3 topics - basic practice
  arrays: 0.10,            // 3 topics - core data structure
  strings: 0.08,            // 3 topics - core data structure
  searching: 0.06,         // 3 topics - fundamental algorithm
  sorting: 0.06,           // 3 topics - fundamental algorithm
  recursion: 0.08,         // 3 topics - problem solving paradigm
  linked_lists: 0.08,      // 3 topics - core data structure
  stack_queue: 0.06,       // 3 topics - core data structures
  trees: 0.10,             // 3 topics - advanced data structure
  heaps_hashing: 0.08,     // 3 topics - advanced data structures
  graphs: 0.10,            // 3 topics - advanced data structure
  dp: 0.10,                // 3 topics - advanced algorithm
  advanced_dsa: 0.08,      // 4 topics - expert level
};

const TOPIC_COUNTS_BY_MODULE = {
  fundamentals: 7,
  patterns: 3,
  arrays: 3,
  strings: 3,
  searching: 3,
  sorting: 3,
  recursion: 3,
  linked_lists: 3,
  stack_queue: 3,
  trees: 3,
  heaps_hashing: 3,
  graphs: 3,
  dp: 3,
  advanced_dsa: 4,
};

const normalizeTopicToModule = (title) => {
  const t = String(title).toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
  
  // Module 1: Fundamentals
  if (t.includes('flowchart') || t.includes('pseudocode')) return 'fundamentals';
  if (t.includes('java') && (t.includes('architecture') || t.includes('setup'))) return 'fundamentals';
  if (t.includes('first') && t.includes('java')) return 'fundamentals';
  if (t.includes('conditional') || t.includes('loop')) return 'fundamentals';
  if (t.includes('function') || t.includes('method')) return 'fundamentals';
  if (t.includes('oop') || t.includes('object')) return 'fundamentals';
  if (t.includes('complexity') || t.includes('big_o')) return 'fundamentals';
  
  // Module 2: Patterns
  if (t.includes('pattern')) return 'patterns';
  
  // Module 3: Arrays
  if (t.includes('array') || t.includes('arraylist')) return 'arrays';
  if (t.includes('2d') || t.includes('matrix')) return 'arrays';
  if (t.includes('kadane') || t.includes('two_pointer') || t.includes('sliding_window')) return 'arrays';
  
  // Module 4: Strings
  if (t.includes('string')) return 'strings';
  if (t.includes('stringbuilder') || t.includes('stringbuffer')) return 'strings';
  if (t.includes('kmp') || t.includes('anagram') || t.includes('palindrome')) return 'strings';
  
  // Module 5: Searching
  if (t.includes('linear_search') || t.includes('sequential')) return 'searching';
  if (t.includes('binary_search')) return 'searching';
  
  // Module 6: Sorting
  if (t.includes('bubble') || t.includes('selection') || t.includes('insertion')) return 'sorting';
  if (t.includes('merge') || t.includes('quick')) return 'sorting';
  if (t.includes('counting') || t.includes('radix') || t.includes('cyclic')) return 'sorting';
  
  // Module 7: Recursion
  if (t.includes('recursion')) return 'recursion';
  if (t.includes('subset') || t.includes('permutation') || t.includes('dice')) return 'recursion';
  if (t.includes('n_queen') || t.includes('sudoku') || t.includes('backtrack')) return 'recursion';
  
  // Module 8: Linked Lists
  if (t.includes('linked') || t.includes('ll')) return 'linked_lists';
  if (t.includes('cycle') || t.includes('floyd')) return 'linked_lists';
  
  // Module 9: Stack & Queue
  if (t.includes('stack')) return 'stack_queue';
  if (t.includes('queue')) return 'stack_queue';
  if (t.includes('deque') || t.includes('priority')) return 'stack_queue';
  
  // Module 10: Trees
  if (t.includes('tree') || t.includes('bst')) return 'trees';
  if (t.includes('traversal') || t.includes('inorder') || t.includes('preorder')) return 'trees';
  
  // Module 11: Heaps & Hashing
  if (t.includes('heap')) return 'heaps_hashing';
  if (t.includes('hash') || t.includes('hashmap') || t.includes('hashset')) return 'heaps_hashing';
  if (t.includes('rabin') || t.includes('rolling')) return 'heaps_hashing';
  
  // Module 12: Graphs
  if (t.includes('graph') || t.includes('adjacency')) return 'graphs';
  if (t.includes('bfs') || t.includes('dfs')) return 'graphs';
  if (t.includes('dijkstra') || t.includes('shortest')) return 'graphs';
  
  // Module 13: DP
  if (t.includes('dp') || t.includes('dynamic')) return 'dp';
  if (t.includes('knapsack') || t.includes('subset_sum')) return 'dp';
  if (t.includes('lcs') || t.includes('edit') || t.includes('grid')) return 'dp';
  
  // Module 14: Advanced DSA
  if (t.includes('trie')) return 'advanced_dsa';
  if (t.includes('greedy')) return 'advanced_dsa';
  if (t.includes('segment')) return 'advanced_dsa';
  if (t.includes('mo') && t.includes('algorithm')) return 'advanced_dsa';
  
  return t;
};

/**
 * Calculate placement readiness from a map of topic mastery scores.
 * Uses module-based scoring based on actual curriculum structure (14 modules).
 * Missing modules count as zero so a learner cannot become placement-ready
 * after mastering only a small subset of the roadmap.
 *
 * @param {Object} topicMasteryMap - e.g., { "Flowcharts & Pseudocode": 85, "Arrays": 70 }
 * @returns {Object} { readinessScore, readinessLevel, completedModules, totalModules, missingModules }
 */
const calculatePlacementReadiness = (topicMasteryMap = {}) => {
  // Group topics by module and calculate module-level mastery
  const moduleMastery = {};
  const moduleTopicCounts = {};
  
  for (const [topicTitle, score] of Object.entries(topicMasteryMap)) {
    const module = normalizeTopicToModule(topicTitle);
    
    if (module && READINESS_MODULE_WEIGHTS[module]) {
      if (!moduleMastery[module]) {
        moduleMastery[module] = [];
      }
      moduleMastery[module].push(Number(score) || 0);
    }
  }
  
  // Calculate average mastery per module
  const moduleScores = {};
  for (const [module, scores] of Object.entries(moduleMastery)) {
    moduleScores[module] = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    moduleTopicCounts[module] = scores.length;
  }
  
  // Calculate weighted readiness score
  let weightedSum = 0;
  let totalWeight = 0;
  const missingModules = [];
  let completedModules = 0;
  const contributions = {};
  
  for (const [module, weight] of Object.entries(READINESS_MODULE_WEIGHTS)) {
    totalWeight += weight;
    const score = moduleScores[module] || 0;
    const topicCount = moduleTopicCounts[module] || 0;
    const totalTopics = TOPIC_COUNTS_BY_MODULE[module];
    
    // Module is considered completed if at least 50% of topics are mastered with score >= 70
    const moduleCompleted = topicCount > 0 && score >= 70 && (topicCount / totalTopics) >= 0.5;
    
    if (moduleCompleted) {
      completedModules += 1;
    } else {
      missingModules.push(module);
    }
    
    contributions[module] = {
      score: Math.round(score),
      weight,
      contribution: Math.round(score * weight * 100) / 100,
      topicsCompleted: `${topicCount}/${totalTopics}`,
    };
    
    weightedSum += score * weight;
  }
  
  const readinessScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const minModulesForPlacementReady = 10; // Require at least 10 out of 14 modules
  
  let readinessLevel = 'Beginner';
  if (readinessScore >= 80 && completedModules >= minModulesForPlacementReady) {
    readinessLevel = 'Placement Ready';
  } else if (readinessScore >= 60) {
    readinessLevel = 'Interview Practicing';
  } else if (readinessScore >= 40) {
    readinessLevel = 'Foundation Building';
  }
  
  return {
    readinessScore,
    readinessLevel,
    completedModules,
    totalModules: Object.keys(READINESS_MODULE_WEIGHTS).length,
    missingModules,
    moduleContributions: contributions,
  };
};

module.exports = {
  calculateAssessmentScore,
  evaluatePass,
  getRequiredCorrectAnswers,
  calculateMasteryScore,
  calculatePlacementReadiness,
  normalizeTopicToModule,
  READINESS_MODULE_WEIGHTS,
  TOPIC_COUNTS_BY_MODULE,
};
