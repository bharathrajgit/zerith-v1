// server/models/ChatMessage.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    sources: [{
      source: { type: String, trim: true },
      chunkIndex: { type: Number, min: 0 },
      score: { type: Number },
    }],
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    problemType: {
      type: String,
      enum: ['practice', 'assignment', 'chunk'],
      required: true,
    },
    messages: [messageSchema],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

chatMessageSchema.index({ studentId: 1, problemId: 1 }, { unique: true });

chatMessageSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
