const MCQ = require('../models/MCQ');
const { markServed, isServed, getLockedAnswer, lockAnswer } = require('../services/mcqAnswerLocks');
const Module = require('../models/Module');
const {
  buildProgressionForUser,
  getTopicProgressionState,
} = require('../services/progressionService');

function shuffleOptions(options) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = indices.map((originalIdx) => options[originalIdx]);
  const originalOrder = indices;
  return { shuffled, originalOrder };
}

const shuffleItems = (items = []) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const difficultyFallbackOrder = {
  Basic: ['Basic', 'Medium', 'Hard'],
  Medium: ['Medium', 'Hard', 'Basic'],
  Hard: ['Hard', 'Medium', 'Basic'],
};

const selectTopicQuestions = (pool = [], level, targetCount = 5) => {
  const orderedLevels = difficultyFallbackOrder[level] || [level];
  const selected = [];
  const seenIds = new Set();

  orderedLevels.forEach((difficulty) => {
    if (selected.length >= targetCount) {
      return;
    }

    const matching = shuffleItems(
      pool.filter((mcq) => mcq.difficulty === difficulty)
    );

    matching.forEach((mcq) => {
      const id = String(mcq._id);
      if (selected.length >= targetCount || seenIds.has(id)) {
        return;
      }
      seenIds.add(id);
      selected.push(mcq);
    });
  });

  return selected;
};

const serializeQuestion = (mcq) => {
  const { shuffled, originalOrder } = shuffleOptions(mcq.options);
  return {
    _id: mcq._id,
    question: mcq.question,
    options: shuffled,
    originalOrder,
    timeLimit: mcq.timeLimit,
    points: mcq.points,
    difficulty: mcq.difficulty,
  };
};

// @desc    Get up to 5 MCQs for a topic and preferred difficulty (student view: no answers)
// @route   GET /api/mcq/topic/:topicId/:level
// @access  Private
const getMCQsByTopic = async (req, res, next) => {
  try {
    const { topicId, level } = req.params;
    const validLevels = ['Basic', 'Medium', 'Hard'];
    if (!validLevels.includes(level)) {
      return res.status(400).json({
        success: false,
        message: `Invalid level. Must be one of: ${validLevels.join(', ')}`,
      });
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

    const questionPool = await MCQ.find({
      topicId,
      isActive: true,
    }).lean();

    if (questionPool.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No MCQs found for this topic',
      });
    }

    const selectedMcqs = selectTopicQuestions(questionPool, level, 5);
    if (selectedMcqs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No MCQs found for this topic and level',
      });
    }

    const questions = selectedMcqs.map(serializeQuestion);
    markServed(req.user._id, selectedMcqs.map((mcq) => mcq._id));
    const fallbackUsed = selectedMcqs.some((mcq) => mcq.difficulty !== level);

    res.status(200).json({
      success: true,
      data: {
        questions,
        topicId,
        level,
        requestedCount: 5,
        actualCount: questions.length,
        fallbackUsed,
        timeLimit: selectedMcqs[0]?.timeLimit || 60,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get single MCQ without its answer or explanation
// @route   GET /api/mcq/:mcqId
// @access  Private
const getMCQById = async (req, res, next) => {
  try {
    const mcq = await MCQ.findById(req.params.mcqId).select('-correctAnswer -explanation');
    if (!mcq) {
      return res.status(404).json({
        success: false,
        message: 'MCQ not found',
      });
    }

    res.status(200).json({
      success: true,
      data: { mcq },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Check an answer; reveals the correct answer and explanation.
//          The first checked answer is locked for the assessment submission.
// @route   POST /api/mcq/:mcqId/check
// @access  Private
const checkMCQAnswer = async (req, res, next) => {
  try {
    const selectedAnswer = Number(req.body?.selectedAnswer);
    if (!Number.isInteger(selectedAnswer) || selectedAnswer < -1 || selectedAnswer > 3) {
      return res.status(400).json({
        success: false,
        message: 'selectedAnswer must be an integer from -1 to 3',
      });
    }

    const mcq = await MCQ.findById(req.params.mcqId).select('correctAnswer explanation');
    if (!mcq) {
      return res.status(404).json({
        success: false,
        message: 'MCQ not found',
      });
    }

    if (!isServed(req.user._id, mcq._id) && getLockedAnswer(req.user._id, mcq._id) === undefined) {
      return res.status(403).json({
        success: false,
        message: 'This question is not part of your current assessment',
      });
    }

    const lockedAnswer = lockAnswer(req.user._id, mcq._id, selectedAnswer);

    res.status(200).json({
      success: true,
      data: {
        selectedAnswer: lockedAnswer,
        isCorrect: lockedAnswer === mcq.correctAnswer,
        correctAnswer: mcq.correctAnswer,
        explanation: mcq.explanation || '',
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get 20 diagnostic MCQs (2 from each of first 10 modules)
// @route   GET /api/mcq/diagnostic
// @access  Private
const getDiagnosticMCQs = async (req, res, next) => {
  try {
    const modules = await Module.find({ order: { $gte: 1, $lte: 10 } })
      .sort({ order: 1 })
      .select('_id order');

    const diagnosticQuestions = [];

    for (const moduleDoc of modules) {
      const mcqs = await MCQ.aggregate([
        {
          $match: {
            moduleId: moduleDoc._id,
            difficulty: { $in: ['Basic', 'Medium'] },
            isActive: true,
          },
        },
        { $sample: { size: 2 } },
      ]);

      if (mcqs.length === 0) {
        return res.status(500).json({
          success: false,
          message: `Not enough MCQs in module ${moduleDoc.order} for diagnostic`,
        });
      }

      mcqs.forEach((mcq) => {
        diagnosticQuestions.push(serializeQuestion(mcq));
      });
    }

    res.status(200).json({
      success: true,
      data: { questions: diagnosticQuestions },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMCQsByTopic, getMCQById, checkMCQAnswer, getDiagnosticMCQs };
