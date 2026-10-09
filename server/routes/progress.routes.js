// server/routes/progress.routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const {
  getUserProgress,
  getTopicProgress,
  updateTopicUnlock,
  completeCodingAndUnlock,
  updateVideoProgress,
} = require('../controllers/progress.controller');

router.use(protect);

// Static routes first
router.get('/', getUserProgress);
router.post('/unlock', updateTopicUnlock);   // ← specific path before :topicId
router.post('/coding-complete', completeCodingAndUnlock);
router.put('/:topicId/video-progress', updateVideoProgress);

// Parameterised route last
router.get('/:topicId', getTopicProgress);

module.exports = router;