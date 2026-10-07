const mongoose = require('mongoose');

const monitoringEventSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['browser', 'vision', 'combined'],
      default: 'browser',
    },
    type: {
      type: String,
      default: '',
    },
    riskLevel: {
      type: String,
      enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH'],
      default: 'LOW',
    },
    message: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const warningSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['browser', 'vision', 'combined'],
      default: 'combined',
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    message: {
      type: String,
      default: '',
    },
    signals: {
      type: [String],
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const monitoringSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      default: null,
    },
    sessionType: {
      type: String,
      enum: ['assessment', 'coding', 'diagnostic'],
      required: true,
    },
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      default: null,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      default: null,
    },
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CodingProblem',
      default: null,
    },
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'finished'],
      default: 'active',
    },
    finalStatus: {
      type: String,
      enum: ['clean', 'limited', 'warned', 'flagged', 'reviewed', 'dismissed', 'confirmed'],
      default: 'clean',
    },
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'unknown'],
      default: 'unknown',
    },
    previewEnabled: {
      type: Boolean,
      default: false,
    },
    warningCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    warningLimit: {
      type: Number,
      default: 3,
      min: 1,
    },
    finalFlagged: {
      type: Boolean,
      default: false,
    },
    riskLevel: {
      type: String,
      enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH'],
      default: 'NONE',
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    browserMetrics: {
      tabSwitches: { type: Number, default: 0 },
      copyAttempts: { type: Number, default: 0 },
      windowBlurCount: { type: Number, default: 0 },
    },
    sourceFlags: {
      type: [String],
      default: [],
    },
    signals: {
      type: [String],
      default: [],
    },
    visionFindings: {
      multipleFaces: { type: Boolean, default: false },
      headPoseAway: { type: Boolean, default: false },
      gazeAway: { type: Boolean, default: false },
      faceMissing: { type: Boolean, default: false },
      phoneVisible: { type: Boolean, default: false },
      extraScreenVisible: { type: Boolean, default: false },
      faceCount: { type: Number, default: 1 },
      confidence: { type: Number, default: 0 },
      latestDetections: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    visionAlertState: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    evidenceCaptureState: {
      type: Map,
      of: Date,
      default: {},
    },
    events: {
      type: [monitoringEventSchema],
      default: [],
    },
    warnings: {
      type: [warningSchema],
      default: [],
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
    lastAnalyzedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

monitoringSessionSchema.index({ userId: 1, status: 1, sessionType: 1 });

module.exports = mongoose.model('MonitoringSession', monitoringSessionSchema);
