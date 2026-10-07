const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  analyzeMonitoringFrame,
  finishMonitoringSession,
  getMonitoringReadiness,
  recordMonitoringEvents,
  startMonitoringSession,
} = require('../controllers/monitoring.controller');

const router = express.Router();

router.use(protect);

router.get('/readiness', getMonitoringReadiness);
router.post('/sessions/start', startMonitoringSession);
router.post('/sessions/:id/events', recordMonitoringEvents);
router.post('/sessions/:id/analyze-frame', analyzeMonitoringFrame);
router.post('/sessions/:id/finish', finishMonitoringSession);

module.exports = router;
