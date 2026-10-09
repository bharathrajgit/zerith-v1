// server/models/Progress.js
const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      required: true,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
    },
    status: {
      type: String,
      enum: ['Locked', 'Unlocked', 'InProgress', 'Completed', 'Mastered'],
      default: 'Locked',
    },
    masteryScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    round1Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    round2Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    round3Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    codingScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    totalAttempts: {
      type: Number,
      default: 0,
    },
    hintsUsed: {
      type: Number,
      default: 0,
    },
    timeSpentMinutes: {
      type: Number,
      default: 0,
    },
    videoPosition: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxWatchedTime: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastProgressAt: {
      type: Date,
      default: null,
    },
    videoCompleted: {
      type: Boolean,
      default: false,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    weakAreas: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Ensure one progress document per user+topic combination
progressSchema.index({ userId: 1, topicId: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);