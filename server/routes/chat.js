// server/routes/chat.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const {
  getChatHistory,
  getChatServiceHealth,
  sendDashboardChatMessage,
  sendChatMessage,
} = require('../controllers/chatController');

router.get('/service-health', protect, getChatServiceHealth);
router.post('/assistant', protect, sendDashboardChatMessage);
router.get('/:problemId', protect, getChatHistory);
router.post('/:problemId', protect, sendChatMessage);

module.exports = router;
