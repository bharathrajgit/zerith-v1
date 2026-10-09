const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/coachController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'resume'));
    return callback(null, true);
  },
});

router.use(protect);
router.post('/session/start', ctrl.startSession);
router.post('/resume/upload', upload.single('resume'), ctrl.uploadResume);
router.post('/session/:sessionId/answer', ctrl.submitAnswer);
router.post('/session/:sessionId/group-discussion', ctrl.groupDiscussion);
router.post('/session/:sessionId/complete', ctrl.completeSession);
router.get('/sessions', ctrl.getSessionHistory);
router.get('/session/:sessionId', ctrl.getSession);

module.exports = router;
