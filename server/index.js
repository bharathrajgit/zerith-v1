// server/index.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Import route files
const authRoutes = require('./routes/auth.routes');
const moduleRoutes = require('./routes/module.routes');
const mcqRoutes = require('./routes/mcq.routes');
const assessmentRoutes = require('./routes/assessment.routes');
const progressRoutes = require('./routes/progress.routes');
const streakRoutes = require('./routes/streak.routes');
const roadmapRoutes = require('./routes/roadmap.routes');
const mlRoutes = require('./routes/ml.routes');
const institutionRoutes = require('./routes/institution.auth.routes');
const institutionStudentRoutes = require('./routes/institution.student.routes');
const institutionAnalyticsRoutes = require('./routes/institution.analytics.routes');
const diagnosticRoutes = require('./routes/diagnostic.routes');
const departmentRoutes = require('./routes/department.routes');
const codingRoutes = require('./routes/coding.routes');
const progressionRoutes = require('./routes/progression.routes');
const videoRoutes = require('./routes/video.routes');
const monitoringRoutes = require('./routes/monitoring.routes');
const malpracticeRoutes = require('./routes/malpractice');

const app = express();

// ─────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', moduleRoutes);
app.use('/api/mcq', mcqRoutes);
app.use('/api/assessment', assessmentRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/streak', streakRoutes);
app.use('/api/roadmap', roadmapRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/institution/auth', institutionRoutes);
app.use('/api/institution/students', institutionStudentRoutes);
app.use('/api/institution/analytics', institutionAnalyticsRoutes);
app.use('/api/diagnostic', diagnosticRoutes);
app.use('/api/institution/departments', departmentRoutes);
app.use('/api/coding', codingRoutes);
app.use('/api/progression', progressionRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/malpractice', malpracticeRoutes.studentRouter);
app.use('/api/institution/malpractice', malpracticeRoutes.institutionRouter);

// Global error handler – prints ANY error value
app.use((err, req, res, next) => {
  // Force log the raw error, whatever it is
  console.error('❌ GLOBAL ERROR HANDLER CAUGHT:');
  console.error(err);

  if (err.stack) console.error(err.stack);

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? err.message || String(err) : undefined,
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});


// ─────────────────────────────────────────────────
// Database connection & server start
// ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dsa-platform';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
