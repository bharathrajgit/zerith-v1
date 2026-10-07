const mongoose = require('mongoose');

const testCaseSchema = new mongoose.Schema(
  {
    input: String,
    expectedOutput: String,
  },
  { _id: false }
);

const codingSubmissionSchema = new mongoose.Schema(
  {
    code: String,
    judge0Result: mongoose.Schema.Types.Mixed,
    score: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    timeTaken: {
      type: Number,
      default: 0,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const codingProblemSchema = new mongoose.Schema(
  {
    problemId: String,
    title: String,
    description: String,
    difficulty: String,
    topic: String,
    timeLimit: Number,
    javaStarterCode: String,
    visibleTestCases: [testCaseSchema],
    hiddenTestCases: [testCaseSchema],
    hints: [String],
    submissions: [codingSubmissionSchema],
    bestScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
    timeSpent: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    lastSubmittedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const diagnosticSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    sessionToken: {
      type: String,
      required: [true, 'Session token is required'],
      unique: true,
    },
    monitoringSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MonitoringSession',
      default: null,
    },
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'expired'],
      default: 'in_progress',
    },
    topicsCovered: [
      {
        type: String,
      },
    ],
    minQuestions: {
      type: Number,
      default: 30,
    },
    maxQuestions: {
      type: Number,
      default: 50,
    },
    totalQuestions: {
      type: Number,
      default: 30,
    },
    timePerQuestion: {
      type: Number,
      default: 45,
    },
    answeredCount: {
      type: Number,
      default: 0,
    },
    blueprintVersion: {
      type: String,
      default: 'adaptive-v1',
    },
    questionPlan: [
      {
        topic: String,
        difficulty: String,
        source: String,
        sourceId: String,
        questionIndex: Number,
      },
    ],
    answers: [
      {
        topic: {
          type: String,
        },
        difficulty: {
          type: String,
          default: 'Hard',
        },
        isCorrect: {
          type: Boolean,
        },
        selectedOption: {
          type: Number,
        },
        wasTimedOut: {
          type: Boolean,
          default: false,
        },
        timeTaken: {
          type: Number,
        },
        answeredAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    result: {
      totalScore: Number,
      perTopicScores: {
        arrays: Number,
        strings: Number,
        searching: Number,
        sorting: Number,
        recursion: Number,
        linked_lists: Number,
        stack_queue: Number,
        trees: Number,
        graphs: Number,
        dp: Number,
      },
      avgTimePerQuestion: Number,
      assignedLevel: String,
      mlConfidence: Number,
      readinessScore: Number,
      unansweredCount: Number,
      malpractice: {
        riskLevel: String,
        riskScore: Number,
        cheatingProbability: Number,
      },
    },
    codingProblems: [codingProblemSchema],
    codingStartedAt: {
      type: Date,
      default: null,
    },
    codingCompletedAt: {
      type: Date,
      default: null,
    },
    mcqPhaseCompleted: {
      type: Boolean,
      default: false,
    },
    mcqScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    codingScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: MongoDB automatically deletes documents when expiresAt is reached
diagnosticSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const DiagnosticSession = mongoose.model('DiagnosticSession', diagnosticSessionSchema);
module.exports = DiagnosticSession;
