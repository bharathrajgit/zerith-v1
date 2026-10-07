const express = require('express');
const router = express.Router();
const { protectInstitution } = require('../middleware/institution.middleware');
const User = require('../models/User');
const mlService = require('../services/mlService');
const {
  getDashboardOverview,
  getDepartmentAnalytics,
  getStudentDetailReport,
  getAtRiskStudents,
  getMalpracticeEvidence,
  getMalpracticeReport,
  getPlacementPredictionReport,
  streamMalpracticeEvidenceImage,
  updateMalpracticeStatus,
} = require('../controllers/institution.analytics.controller');

router.use(protectInstitution);

router.get('/overview', getDashboardOverview);
router.get('/departments', getDepartmentAnalytics);
router.get('/student/:studentId', getStudentDetailReport);
router.get('/at-risk', getAtRiskStudents);
router.get('/malpractice', getMalpracticeReport);
router.get('/malpractice/:logId/evidence', getMalpracticeEvidence);
router.get('/malpractice/evidence/:evidenceId/image', streamMalpracticeEvidenceImage);
router.patch('/malpractice/:logId/status', updateMalpracticeStatus);
router.get('/placement-prediction', getPlacementPredictionReport);
router.get('/dropout-risk/:studentId', protectInstitution, async (req, res, next) => {
  try {
    // In a real scenario, you'd gather the 9 features from the student's data
    const student = await User.findById(req.params.studentId);
    if (!student || student.institutionId?.toString() !== req.institution._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    // Build features from student profile + progress
    const features = {
      num_prev_attempts: student.totalMCQAttempted || 0,
      studied_credits: student.placementReadiness || 0,
      avg_score: student.diagnosticScore || 0,
      engagement_score: student.currentStreak / 365.0,
      performance_score: student.placementReadiness / 100.0,
      risk_score: (student.mustResetPassword ? 0.8 : 0.2),
      days_active: student.totalStreakDays || 0,
      module_count: student.topicsMastered?.length || 0,
      consistency: 0.5, // you can compute from login patterns
    };
    const result = await mlService.getDropoutRisk(features);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
