// server/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    // ─── Basic Auth Fields ──────────────────────────
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },

    // ─── Role ───────────────────────────────────────
    role: {
      type: String,
      enum: ['student', 'admin', 'institution_admin'],
      default: 'student',
    },

    // 🔥 NEW – Institution Portal fields
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      default: null,
    },
    departmentCode: {
      type: String,
      default: '',
    },
    isFirstLogin: {
      type: Boolean,
      default: false,
    },
    mustResetPassword: {
      type: Boolean,
      default: false,
    },
    studentSource: {
      type: String,
      enum: ['institution_created', 'self_registered'],
      default: 'self_registered',
    },

    // ─── Profile Info ───────────────────────────────
    college: {
      type: String,
      trim: true,
      default: '',
    },
    targetGoal: {
      type: String,
      enum: ['Interview Prep', 'Academics', 'Both'],
      default: 'Interview Prep',
    },

    // ─── Skill Level (ML Assigned) ──────────────────
    currentLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Placement-Ready'],
      default: 'Beginner',
    },

    // ─── Onboarding State ───────────────────────────
    diagnosticCompleted: {
      type: Boolean,
      default: false,
    },
    diagnosticScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    isProfileComplete: {
      type: Boolean,
      default: false,
    },
    roadmapGenerated: {
      type: Boolean,
      default: false,
    },

    // ─── ML Scores ──────────────────────────────────
    placementReadiness: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // ─── Activity Tracking ──────────────────────────
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    totalStreakDays: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },

    // ─── Achievement Counters ───────────────────────
    totalProblemsSolved: {
      type: Number,
      default: 0,
    },
    totalMCQAttempted: {
      type: Number,
      default: 0,
    },
    totalMCQCorrect: {
      type: Number,
      default: 0,
    },

    // ─── Topics Mastered (refs) ─────────────────────
    topicsMastered: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Topic',
      },
    ],
    watchedVideos: {
      type: [String],
      default: [],
    },

    // ─── Roadmap Reference ──────────────────────────
    activeRoadmap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Roadmap',
      default: null,
    },

    assessmentLock: {
      isLocked: {
        type: Boolean,
        default: false,
      },
      lockedUntil: {
        type: Date,
        default: null,
      },
      lockReason: {
        type: String,
        default: '',
      },
      lockCount: {
        type: Number,
        default: 0,
      },
    },

    // Independent lock for the Diagnostic Test flow only.
    // Locking this does NOT affect MCQ Assessments.
    diagnosticLock: {
      isLocked: {
        type: Boolean,
        default: false,
      },
      lockedUntil: {
        type: Date,
        default: null,
      },
      lockReason: {
        type: String,
        default: '',
      },
      lockCount: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// ─── Hash password before save ───────────────────────
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Compare password method ─────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Update last active ──────────────────────────────
userSchema.methods.updateActivity = async function () {
  this.lastActiveAt = new Date();
  await this.save();
};

module.exports = mongoose.model('User', userSchema);
