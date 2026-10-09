const User = require('../models/User');
const {
  generateRoadmap,
  isLegacyRoadmap,
  syncRoadmapForUser,
} = require('../services/roadmapGenerator');

const generateRoadmapHandler = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const {
      roadmap,
      recapModules = [],
    } = await generateRoadmap(user._id, user.currentLevel || 'Beginner');

    res.status(201).json({
      success: true,
      data: { roadmap, recapModules },
      message: 'Roadmap generated successfully',
    });
  } catch (err) {
    next(err);
  }
};

const getRoadmap = async (req, res, next) => {
  try {
    let user = await User.findById(req.user._id).populate('activeRoadmap');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.activeRoadmap) {
      await generateRoadmap(user._id, user.currentLevel || 'Beginner');
      user = await User.findById(req.user._id).populate('activeRoadmap');
    }

    let roadmap = user.activeRoadmap;
    if (!roadmap) {
      return res.status(404).json({
        success: false,
        message: 'No active roadmap found',
      });
    }

    const hasBrokenWeeks =
      !Array.isArray(roadmap.weeks) ||
      roadmap.weeks.length === 0 ||
      roadmap.weeks.some((week) => !Array.isArray(week.days)) ||
      isLegacyRoadmap(roadmap);

    if (hasBrokenWeeks) {
      await generateRoadmap(req.user._id, user.currentLevel || 'Beginner');
      user = await User.findById(req.user._id).populate('activeRoadmap');
      roadmap = user.activeRoadmap;
    }

    const synced = await syncRoadmapForUser(req.user._id);
    if (synced?.roadmap) {
      roadmap = synced.roadmap;
    }
    const recapModules = synced?.recapModules || [];

    const currentDay = roadmap.currentDay || 1;
    const currentWeekObj = roadmap.weeks.find((week) =>
      week.days.some((day) => day.dayNumber === currentDay)
    );
    const currentWeek = currentWeekObj?.weekNumber || 1;
    const todayTasks = currentWeekObj?.days.find(
      (day) => day.dayNumber === currentDay
    )?.tasks || [];

    res.status(200).json({
      success: true,
      data: {
        roadmap,
        currentWeek,
        currentDay,
        todayTasks,
        recapModules,
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateDayCompletion = async (req, res, next) => {
  return res.status(410).json({
    success: false,
    message: 'Video completion is recorded only after verified playback.',
  });
};

module.exports = {
  generateRoadmapHandler,
  getRoadmap,
  updateDayCompletion,
};
