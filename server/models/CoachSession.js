const mongoose = require('mongoose');

const coachSessionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mode: {
      type: String,
      enum: ['resume', 'hr', 'dsa', 'communication', 'group'],
      required: true,
    },
    resumeText: {
      type: String,
      default: '',
    },
    questions: [
      {
        question: String,
        difficulty: {
          type: String,
          enum: ['easy', 'medium', 'hard'],
          default: null,
        },
        studentAnswer: String,
        scores: {
          clarity: Number,
          confidence: Number,
          structure: Number,
          relevance: Number,
          overall: Number,
          technicalCorrect: Boolean,
        },
        fillerWords: {
          count: Number,
          words: [String],
        },
        annotations: [
          {
            quote: String,
            type: String,
            note: String,
          },
        ],
        coachFeedback: String,
      },
    ],
    sessionSummary: {
      avgClarity: Number,
      avgConfidence: Number,
      avgStructure: Number,
      avgRelevance: Number,
      avgOverall: Number,
      totalFillerWords: Number,
      weakestArea: String,
      improvementTip: String,
    },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: Date,
  },
  { timestamps: false }
);

coachSessionSchema.index({ studentId: 1, createdAt: -1 });

module.exports = mongoose.model('CoachSession', coachSessionSchema);
