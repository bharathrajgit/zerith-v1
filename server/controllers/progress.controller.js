const mongoose = require('mongoose');
const CodingProblem = require('../models/CodingProblem');
const PerformanceLog = require('../models/PerformanceLog');
const Progress = require('../models/Progress');
const Topic = require('../models/Topic');
const User = require('../models/User');
const { syncRoadmapForUser } = require('../services/roadmapGenerator');
const { inferPlacementReadiness, normalizeReadinessLevel } = require('../services/userReadinessService');
const { calculateMasteryScore } = require('../services/scoreCalculator');
const {
  buildProgressionForUser,
  getTopicProgressionState,
} = require('../services/progressionService');
const { logActivity } = require('../services/streakService');
const { markVideoCompleted } = require('../services/roadmapGenerator');

const VIDEO_PROGRESS_MAX_SPEED = 1.5;
const VIDEO_PROGRESS_TOLERANCE_SECONDS = 10;

const parseYouTubeTime = (value) => {
  if (!value) return 0;
  if (/^\d+$/.test(String(value))) return Number(value);
  const match = String(value).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return (Number(match[1] || 0) * 3600)
    + (Number(match[2] || 0) * 60)
    + Number(match[3] || 0);
};

const getConfiguredVideoRange = (topic) => {
  let startSeconds = Math.max(0, Number(topic?.videoStartSeconds ?? topic?.startSeconds ?? 0));
  let endSeconds = Math.max(0, Number(topic?.videoEndSeconds ?? topic?.endSeconds ?? 0));

  try {
    const videoUrl = new URL(topic?.videoUrl);
    if (!startSeconds) {
      startSeconds = parseYouTubeTime(videoUrl.searchParams.get('start') || videoUrl.searchParams.get('t'));
    }
    if (!endSeconds) endSeconds = parseYouTubeTime(videoUrl.searchParams.get('end'));
  } catch {
    // Topics may store a bare video ID instead of a URL.
  }

  return { startSeconds, endSeconds };
};

const getTrustedVideoDurationSeconds = (topic) => {
  const { startSeconds, endSeconds } = getConfiguredVideoRange(topic);
  if (endSeconds > startSeconds) return endSeconds - startSeconds;

  const primaryAsset = (topic?.learningAssets || []).find(
    (asset) => asset?.type === 'video' && asset?.videoId
  );
  const durationMinutes = Number(primaryAsset?.durationMinutes || topic?.videoDuration || 0);
  return durationMinutes > 0 ? durationMinutes * 60 : 0;
};

const calculateVideoProgress = ({ previousMax, currentTime, lastProgressAt, now, duration }) => {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safePreviousMax = Math.max(0, Math.min(Number(previousMax) || 0, safeDuration));
  const requestedTime = Math.max(0, Math.min(Number(currentTime) || 0, safeDuration));
  const elapsedSeconds = lastProgressAt
    ? Math.max(0, (now.getTime() - new Date(lastProgressAt).getTime()) / 1000)
    : 0;
  const allowedMax = Math.min(
    safeDuration,
    safePreviousMax + (elapsedSeconds * VIDEO_PROGRESS_MAX_SPEED) + VIDEO_PROGRESS_TOLERANCE_SECONDS
  );
  const acceptedTime = Math.min(requestedTime, Math.max(safePreviousMax, allowedMax));

  return {
    currentTime: acceptedTime,
    maxWatchedTime: Math.max(safePreviousMax, acceptedTime),
  };
};

const buildRecentPerformance = (logs = []) => {
  const today = new Date();
  const groupedByDate = new Map();

  logs.forEach((log) => {
    const key = new Date(log.sessionDate).toISOString().split('T')[0];
    if (!groupedByDate.has(key)) groupedByDate.set(key, []);
    groupedByDate.get(key).push(log);
  });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toISOString().split('T')[0];
    const dayLogs = groupedByDate.get(key) || [];

    if (dayLogs.length === 0) {
      return {
        date: key,
        mcqAccuracy: null,
        codingAccuracy: null,
        masteryScore: null,
      };
    }

    const average = (values) =>
      Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 100
      ) / 100;

    return {
      date: key,
      mcqAccuracy: average(dayLogs.map((log) => (log.round1Accuracy || 0) * 100)),
      codingAccuracy: average(dayLogs.map((log) => (log.codingAccuracy || 0) * 100)),
      masteryScore: average(dayLogs.map((log) => log.masteryScore || 0)),
    };
  });
};

const unlockNextFromTopic = async (user, topic) => {
  const userId = user?._id || user;
  const progression = await buildProgressionForUser(user);
  const topicState = getTopicProgressionState(progression, topic._id);

  if (!topicState?.module?.accessible || !topicState?.module?.sequentialUnlock) {
    return { unlockedTopic: null, scope: 'course' };
  }

  const currentDifficulty = topicState.module.difficulty || topicState.topic.courseLevel;
  const courseTopics = (progression.modules || [])
    .filter(
      (mod) =>
        mod.sequentialUnlock &&
        (mod.difficulty || 'Beginner') === currentDifficulty
    )
    .sort((a, b) => a.order - b.order)
    .flatMap((mod) =>
      (mod.topics || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((entry) => ({
          _id: entry._id,
          moduleId: mod._id,
        }))
    );

  const currentIndex = courseTopics.findIndex(
    (entry) => String(entry._id) === String(topic._id)
  );
  const nextCourseTopicRef =
    currentIndex >= 0 ? courseTopics[currentIndex + 1] : null;

  if (nextCourseTopicRef?._id) {
    const nextCourseTopic = await Topic.findById(nextCourseTopicRef._id);
    if (!nextCourseTopic) {
      return { unlockedTopic: null, scope: 'end' };
    }

    let nextProgress = await Progress.findOne({
      userId,
      topicId: nextCourseTopic._id,
    });

    if (!nextProgress) {
      nextProgress = await Progress.create({
        userId,
        topicId: nextCourseTopic._id,
        moduleId: nextCourseTopic.moduleId,
        status: 'Unlocked',
      });
    } else if (nextProgress.status === 'Locked') {
      nextProgress.status = 'Unlocked';
      await nextProgress.save();
    }

    return { unlockedTopic: nextCourseTopic, scope: 'topic' };
  }

  return { unlockedTopic: null, scope: 'end' };
};

const getUserProgress = async (req, res, next) => {
  try {
    const [progression, user, recentLogs] = await Promise.all([
      buildProgressionForUser(req.user),
      User.findById(req.user._id).select(
        'placementReadiness diagnosticCompleted currentLevel'
      ),
      PerformanceLog.find({
        userId: req.user._id,
        sessionDate: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      })
        .sort({ sessionDate: 1 })
        .lean(),
    ]);
    const moduleProgress = (progression.modules || []).map((mod) => ({
      module: {
        _id: mod._id,
        title: mod.title,
        order: mod.order,
        icon: mod.icon,
        difficulty: mod.difficulty,
        accessType: mod.accessType,
        accessible: mod.accessible,
        visible: mod.visible,
        unlocked: mod.unlocked,
        completed: mod.completed,
        status: mod.status,
      },
      completedTopics: mod.completedTopics,
      totalTopics: mod.totalTopics,
      percentage: mod.percentage,
      topics: (mod.topics || []).map((topic) => ({
        topic: {
          _id: topic._id,
          title: topic.title,
          order: topic.order,
          difficultyLevel: topic.difficultyLevel,
          courseLevel: topic.courseLevel,
          videoDuration: topic.videoDuration,
          estimatedMinutes: topic.estimatedMinutes || topic.videoDuration || 0,
          learningAssets: topic.learningAssets || [],
          accessible: topic.accessible,
          unlocked: topic.unlocked,
          completed: topic.completed,
          requiresCoding: topic.requiresCoding,
        },
        progress: {
          status: topic.status,
          masteryScore: topic.progress?.masteryScore || 0,
          round1Score: topic.progress?.round1Score || 0,
          round2Score: topic.progress?.round2Score || 0,
          round3Score: topic.progress?.round3Score || 0,
          codingScore: topic.progress?.codingScore || 0,
          totalAttempts: topic.progress?.totalAttempts || 0,
          hintsUsed: topic.progress?.hintsUsed || 0,
          timeSpentMinutes: topic.progress?.timeSpentMinutes || 0,
          lastAttemptAt: topic.progress?.lastAttemptAt || null,
          completedAt: topic.progress?.completedAt || null,
        },
      })),
    }));

    res.status(200).json({
      success: true,
      data: {
        overallProgress: progression.overview?.percentage || 0,
        placementReadiness: inferPlacementReadiness(user),
        diagnosticCompleted: !!user?.diagnosticCompleted,
        currentLevel: normalizeReadinessLevel(
          user?.currentLevel || req.user?.currentLevel || 'Beginner'
        ),
        courses: progression.courses || [],
        overview: progression.overview || {
          totalTopics: 0,
          completedTopics: 0,
          percentage: 0,
        },
        recentPerformance: buildRecentPerformance(recentLogs),
        moduleProgress,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getTopicProgress = async (req, res, next) => {
  try {
    const progress = await Progress.findOne({
      userId: req.user._id,
      topicId: req.params.topicId,
    })
      .populate('topicId', 'title order')
      .populate('moduleId', 'title order');

    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'No progress found for this topic',
      });
    }

    res.status(200).json({
      success: true,
      data: { progress },
    });
  } catch (err) {
    next(err);
  }
};

const updateVideoProgress = async (req, res, next) => {
  try {
    const { topicId } = req.params;
    const currentTime = Number(req.body?.currentTime);
    if (!mongoose.Types.ObjectId.isValid(topicId)) {
      return res.status(400).json({ success: false, message: 'Invalid topicId' });
    }
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      return res.status(400).json({ success: false, message: 'A valid currentTime is required' });
    }

    const topic = await Topic.findById(topicId).lean();
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    const progression = await buildProgressionForUser(req.user);
    const topicState = getTopicProgressionState(progression, topic._id);
    if (!topicState?.topic?.unlocked) {
      return res.status(403).json({
        success: false,
        message: 'This topic is locked for your current progression.',
      });
    }

    const duration = getTrustedVideoDurationSeconds(topic);
    if (!duration) {
      return res.status(422).json({
        success: false,
        message: 'A trusted video duration must be configured for this topic.',
      });
    }

    let progress = await Progress.findOne({
      userId: req.user._id,
      topicId: topic._id,
    });
    if (!progress) {
      progress = await Progress.create({
        userId: req.user._id,
        topicId: topic._id,
        moduleId: topic.moduleId,
        status: 'InProgress',
      });
    }

    const videoIds = new Set([String(topic._id)]);
    const parseVideoId = (value) => {
      const raw = String(value || '').trim();
      if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
      try {
        const parsed = new URL(raw);
        if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
        if (parsed.searchParams.has('v')) return parsed.searchParams.get('v');
        return parsed.pathname.match(/embed\/([A-Za-z0-9_-]{11})/)?.[1] || '';
      } catch {
        return '';
      }
    };
    const primaryVideoId = parseVideoId(topic.videoUrl);
    if (primaryVideoId) videoIds.add(primaryVideoId);
    (topic.learningAssets || []).forEach((asset) => {
      if (asset?.type === 'video' && asset.videoId) {
        videoIds.add(String(asset.videoId));
      }
    });
    const user = await User.findById(req.user._id).select('watchedVideos');
    const completedForLegacyUser = (user?.watchedVideos || [])
      .some((videoId) => videoIds.has(String(videoId)));

    const previousMax = Math.max(
      Number(progress.maxWatchedTime || 0),
      Number(progress.videoPosition || 0),
      Number(progress.currentTime || 0),
      Number(progress.watchPosition || 0)
    );
    const wasCompleted = Boolean(progress.videoCompleted || completedForLegacyUser);
    let completed = wasCompleted;

    if (!wasCompleted) {
      const now = new Date();
      const acceptedProgress = calculateVideoProgress({
        previousMax,
        currentTime,
        lastProgressAt: progress.lastProgressAt,
        now,
        duration,
      });

      progress.videoPosition = acceptedProgress.currentTime;
      progress.maxWatchedTime = acceptedProgress.maxWatchedTime;
      progress.lastProgressAt = now;
      completed = acceptedProgress.maxWatchedTime >= duration * 0.9;
      if (completed) {
        progress.videoCompleted = true;
      }
      if (progress.status === 'Locked' || progress.status === 'Unlocked') {
        progress.status = 'InProgress';
      }
      await progress.save();

      if (completed) {
        await markVideoCompleted(req.user._id, topic._id);
        await logActivity(req.user._id, 1, 15, [topic.title || 'Video Lesson']);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        currentTime: Number(progress.videoPosition || 0),
        maxWatchedTime: Math.max(previousMax, Number(progress.maxWatchedTime || 0)),
        completed,
        duration,
      },
      message: 'Video progress saved',
    });
  } catch (err) {
    next(err);
  }
};

const initializeProgress = async (userId, topicId, moduleId) => {
  let progress = await Progress.findOne({ userId, topicId });
  if (!progress) {
    progress = await Progress.create({
      userId,
      topicId,
      moduleId,
      status: 'Locked',
    });
  }
  return progress;
};

const updateTopicUnlock = async (req, res, next) => {
  try {
    const { topicId } = req.body;
    if (!topicId) {
      return res.status(400).json({
        success: false,
        message: 'topicId is required',
      });
    }

    const topic = await Topic.findById(topicId).populate('moduleId');
    if (!topic) {
      return res.status(404).json({
        success: false,
        message: 'Topic not found',
      });
    }

    const progression = await buildProgressionForUser(req.user);
    const topicState = getTopicProgressionState(progression, topic._id);
    if (!topicState?.topic?.unlocked) {
      return res.status(403).json({
        success: false,
        message: 'This topic is locked for your current progression.',
      });
    }

    const result = await unlockNextFromTopic(req.user, topic);
    await syncRoadmapForUser(req.user._id);

    res.status(200).json({
      success: true,
      message:
        result.scope === 'topic'
          ? 'Next topic unlocked'
          : result.scope === 'course'
            ? 'This course is already fully accessible for your level'
            : 'No next topic/module to unlock',
      data: { unlockedTopic: result.unlockedTopic, scope: result.scope },
    });
  } catch (err) {
    next(err);
  }
};

const completeCodingAndUnlock = async (req, res, next) => {
  try {
    const { topicId, score } = req.body;
    if (!topicId) {
      return res.status(400).json({
        success: false,
        message: 'topicId is required',
      });
    }

    const topic = await Topic.findById(topicId).populate('moduleId');
    if (!topic) {
      return res.status(404).json({
        success: false,
        message: 'Topic not found',
      });
    }

    const progression = await buildProgressionForUser(req.user);
    const topicState = getTopicProgressionState(progression, topic._id);
    if (!topicState?.topic?.unlocked) {
      return res.status(403).json({
        success: false,
        message: 'This topic is locked for your current progression.',
      });
    }

    let progress = await Progress.findOne({
      userId: req.user._id,
      topicId: topic._id,
    });
    if (!progress) {
      progress = await Progress.create({
        userId: req.user._id,
        topicId: topic._id,
        moduleId: topic.moduleId?._id || topic.moduleId,
        status: 'Unlocked',
      });
    }

    const newScore =
      typeof score === 'number' ? Math.max(0, Math.min(score, 100)) : 100;
    progress.codingScore = Math.max(progress.codingScore || 0, newScore);
    progress.masteryScore = calculateMasteryScore(
      progress.round1Score || 0,
      progress.codingScore || 0,
      progress.totalAttempts > 0
        ? (progress.hintsUsed || 0) / progress.totalAttempts
        : 0,
      Math.max(0, (progress.totalAttempts || 0) - 1)
    ).masteryScore;

    const hasCodingProblem = await CodingProblem.exists({
      topicId: topic._id,
      isActive: true,
      hasCoding: { $ne: false },
    });

    if (
      (progress.round1Score || 0) >= 80 &&
      (!hasCodingProblem || (progress.codingScore || 0) >= 80)
    ) {
      progress.status = 'Completed';
      progress.completedAt = new Date();
    } else {
      if (progress.status === 'Locked') progress.status = 'Unlocked';
      progress.completedAt = null;
    }

    await progress.save();
    await logActivity(req.user._id, 1, 10, [topic.title]);

    await PerformanceLog.create({
      userId: req.user._id,
      topicId: topic._id,
      moduleId: topic.moduleId?._id || topic.moduleId,
      sessionDate: new Date(),
      round1Accuracy: (progress.round1Score || 0) / 100,
      round2Accuracy: (progress.round1Score || 0) / 100,
      round3Accuracy: (progress.codingScore || 0) / 100,
      codingAccuracy: (progress.codingScore || 0) / 100,
      attemptCount: progress.totalAttempts || 0,
      masteryScore: progress.masteryScore || 0,
      weakFlag: false,
      weakType: null,
    });

    const result = await unlockNextFromTopic(req.user, topic);
    await syncRoadmapForUser(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Coding marked complete',
      data: {
        progress,
        unlockedTopic: result.unlockedTopic,
        scope: result.scope,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUserProgress,
  getTopicProgress,
  initializeProgress,
  updateTopicUnlock,
  completeCodingAndUnlock,
  updateVideoProgress,
  getTrustedVideoDurationSeconds,
  getTrustedVideoDurationSeconds,
  calculateVideoProgress,
};
