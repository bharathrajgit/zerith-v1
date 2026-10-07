// server/routes/mcq.routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const {
  getMCQsByTopic,
  getMCQById,
  checkMCQAnswer,
  getDiagnosticMCQs,
} = require('../controllers/mcq.controller');

router.use(protect); // all routes below are protected

// IMPORTANT: fixed routes before parameterized
router.get('/diagnostic', getDiagnosticMCQs);
router.get('/topic/:topicId/:level', getMCQsByTopic);
router.get('/:mcqId', getMCQById);
router.post('/:mcqId/check', checkMCQAnswer);

module.exports = router;