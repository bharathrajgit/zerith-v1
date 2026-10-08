// server/routes/chat.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { getChatHistory, sendChatMessage } = require('../controllers/chatController');

router.get('/:problemId', protect, getChatHistory);
router.post('/:problemId', protect, sendChatMessage);

module.exports = router;
