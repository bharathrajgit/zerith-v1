const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { protectInstitution } = require('../middleware/institution.middleware');
const {
  checkLockStatus,
  getInstitutionMalpracticeLogs,
  getInstitutionMalpracticeStats,
  reportViolation,
  unlockStudent,
  getLockedStudents,
} = require('../controllers/malpracticeController');

const studentRouter = express.Router();
studentRouter.use(protect);
studentRouter.get('/check-lock', checkLockStatus);
studentRouter.post('/report-violation', reportViolation);

const institutionRouter = express.Router();
institutionRouter.use(protectInstitution);
institutionRouter.get('/logs', getInstitutionMalpracticeLogs);
institutionRouter.get('/stats', getInstitutionMalpracticeStats);
institutionRouter.get('/locked-students', getLockedStudents);
institutionRouter.post('/unlock', unlockStudent);

module.exports = {
  studentRouter,
  institutionRouter,
};
