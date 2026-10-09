const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const User = require('../models/User');

const router = express.Router();

router.use(protect);

router.post('/watched', async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Videos can only be marked watched after verified playback.',
  });
});

router.get('/watched', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('watchedVideos');
    res.status(200).json({
      success: true,
      data: { watchedVideos: user?.watchedVideos || [] },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
