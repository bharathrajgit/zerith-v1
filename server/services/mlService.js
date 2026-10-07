// server/services/mlService.js
// Connects Node.js backend to Python Flask ML service

const axios = require('axios');
const { ML_SERVICE_URL } = require('../config/env');
const { calculatePlacementReadiness } = require('./scoreCalculator');

const ML_URL = ML_SERVICE_URL;

// ── Timeout config ─────────────────────────────────────
const mlAxios = axios.create({
  baseURL: ML_URL,
  timeout: 15000, // 15 seconds
  headers: { 'Content-Type': 'application/json' }
});

const normalizeMonitoringSessionType = (sessionType = '') => {
  const normalized = String(sessionType || '').trim().toLowerCase();
  return ['assessment', 'coding', 'diagnostic'].includes(normalized)
    ? normalized
    : 'assessment';
};

const normalizeProctorHealth = (payload = {}, fallbackMessage = '') => {
  const data = payload?.data || payload || {};
  const fullModelReady = Boolean(
    data.fullModelReady == null
      ? (
        data.modelLoaded
        && data.modelFilePresent
        && data.onnxRuntimeAvailable
        && data.imageStackAvailable
      )
      : data.fullModelReady
  );
  const cameraMonitoringReady = Boolean(
    data.cameraMonitoringReady == null
      ? (
        data.supportsFallbackHeuristics
        || data.supportsCameraMonitoring
        || fullModelReady
      )
      : (data.cameraMonitoringReady || fullModelReady)
  );

  return {
    ready: cameraMonitoringReady,
    fullModelReady,
    cameraMonitoringReady,
    modelLoaded: Boolean(data.modelLoaded),
    modelFilePresent: Boolean(data.modelFilePresent),
    onnxRuntimeAvailable: Boolean(data.onnxRuntimeAvailable),
    imageStackAvailable: Boolean(data.imageStackAvailable),
    modelSource: data.modelSource || 'unknown',
    supportedLabels: Array.isArray(data.supportedLabels) ? data.supportedLabels : [],
    supportsCameraMonitoring: Boolean(data.supportsCameraMonitoring),
    supportsPhoneDetection: Boolean(data.supportsPhoneDetection),
    supportsExtraScreenDetection: Boolean(data.supportsExtraScreenDetection),
    supportsFallbackHeuristics: Boolean(data.supportsFallbackHeuristics),
    message: data.message || fallbackMessage || 'Live proctor monitoring is unavailable.',
  };
};

const buildMonitoringReadiness = (status = {}, sessionType = 'assessment') => {
  const normalizedSessionType = normalizeMonitoringSessionType(sessionType);
  const fullModelReady = Boolean(status.fullModelReady);
  const cameraMonitoringReady = Boolean(
    status.cameraMonitoringReady
    || status.supportsCameraMonitoring
    || status.supportsFallbackHeuristics
    || fullModelReady
  );
  // Heuristic camera monitoring is sufficient to start any monitored flow.
  // We still expose fullModelReady so the client can show reduced-capability UI
  // when the ONNX model is unavailable.
  const ready = cameraMonitoringReady;
  const limitedDetection = Boolean(ready && !fullModelReady);

  return {
    ...status,
    ready,
    fullModelReady,
    cameraMonitoringReady,
    limitedDetection,
    capability: fullModelReady ? 'full' : limitedDetection ? 'limited' : 'unavailable',
    sessionType: normalizedSessionType,
    message: status.message || 'Live proctor monitoring is unavailable.',
  };
};

// ── Fallback rule-based classifier ────────────────────
// Used when ML service is down
const fallbackClassify = (performanceData) => {
  const avg = (
    performanceData.round1_accuracy +
    performanceData.round2_accuracy +
    performanceData.round3_accuracy
  ) / 3;

  let level;
  if (avg >= 75) level = 'Placement-Ready';
  else if (avg >= 50) level = 'Intermediate';
  else level = 'Beginner';

  return {
    level,
    confidence:    0.7,
    probabilities: {},
    recommendation: `Rule-based: ${level}`,
    fallback:       true
  };
};

const canonicalizeLevel = (level) => {
  const raw = String(level || '').trim().toLowerCase();
  if (!raw) return 'Beginner';
  if (raw === 'placement-ready' || raw === 'placement ready' || raw === 'placement_ready') {
    return 'Placement-Ready';
  }
  if (raw === 'intermediate') return 'Intermediate';
  if (raw === 'beginner') return 'Beginner';
  return 'Beginner';
};

const normalizeLevelFromScore = (level, score) => {
  const roundedScore = Math.round(score || 0);
  if (roundedScore < 50) return 'Beginner';
  if (roundedScore < 70) return 'Intermediate';
  return 'Placement-Ready';
};

const buildDiagnosticPerformanceData = (
  diagnosticResult,
  currentStreak = 0
) => {
  const perTopicScores = diagnosticResult.perTopicScores || {};
  const topicBreakdown = diagnosticResult.topicBreakdown || {};
  const topicScore = (topic) => {
    return perTopicScores[topic] ?? perTopicScores[topic.replace(/_/g, ' ')] ?? 0;
  };

  const averageScore = (topics) => {
    const values = topics
      .map((topic) => topicScore(topic))
      .filter((v) => typeof v === 'number');
    return values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : 0;
  };

  const earlyAvg = averageScore(['arrays', 'strings', 'searching']);
  const midAvg = averageScore(['sorting', 'recursion', 'linked_lists', 'stack_queue']);
  const hardAvg = averageScore(['trees', 'graphs', 'dp']);
  const totalScore = diagnosticResult.totalScore || 0;
  const totalQuestions = diagnosticResult.totalQuestions || 0;
  const conceptualRate = averageScore(['arrays', 'strings', 'searching', 'sorting']) / 100;
  const applicationRate = averageScore(['recursion', 'linked_lists', 'stack_queue']) / 100;
  const reasoningRate = averageScore(['trees', 'graphs', 'dp']) / 100;
  const timedOutCount = Number(diagnosticResult.unansweredCount || 0);
  const answeredCounts = Object.values(topicBreakdown).reduce(
    (acc, entry) => {
      acc.total += entry?.total || 0;
      acc.hard += entry?.hard || 0;
      return acc;
    },
    { total: 0, hard: 0 }
  );

  return {
    round1_accuracy: earlyAvg,
    round2_accuracy: midAvg,
    round3_accuracy: hardAvg,
    coding_accuracy: Math.max(0, Math.min(Math.round(((hardAvg * 0.7) + (totalScore * 0.3)) * 100) / 100, 100)),
    avg_response_time: diagnosticResult.avgTimePerQuestion || 0,
    hint_usage_rate: 0,
    attempt_count: totalQuestions,
    streak_day: currentStreak || 0,
    skip_attempts: timedOutCount,
    topics_studied_count: Object.keys(perTopicScores).length,
    conceptual_error_rate: 1 - conceptualRate,
    application_error_rate: 1 - applicationRate,
    reasoning_error_rate: 1 - reasoningRate,
    hard_question_ratio: answeredCounts.total > 0 ? answeredCounts.hard / answeredCounts.total : 0,
    completion_rate: totalQuestions > 0
      ? (totalQuestions - timedOutCount) / totalQuestions
      : 0,
  };
};

// ── 1. Classify student level ──────────────────────────
const classifyLevel = async (performanceData) => {
  try {
    const res = await mlAxios.post(
      '/ml/classify-level',
      { performance_data: performanceData }
    );
    return res.data.data;

  } catch (error) {
    console.warn(
      'ML service unavailable, using fallback:',
      error.message
    );
    return fallbackClassify(performanceData);
  }
};

// ── 2. Detect weak areas ───────────────────────────────
const detectWeakAreas = async (topicPerformanceList) => {
  try {
    const res = await mlAxios.post(
      '/ml/detect-weak-areas',
      { topics: topicPerformanceList }
    );
    return res.data.data;

  } catch (error) {
    console.warn(
      'ML service unavailable for weak areas:',
      error.message
    );
    // Simple fallback
    const weak = topicPerformanceList
      .filter(t => t.round1_acc < 0.6)
      .map(t => ({
        topic_name:     t.topic_name,
        weak_type:      'conceptual_gap',
        severity:       'medium',
        recommendation: 'Review concept video',
        action:         'Redo Basic MCQs',
        priority:       1,
      }));

    return {
      weak_topics:            weak,
      strong_topics:          [],
      overall_weakness_score: 50,
      action_plan:            'ML service offline',
      fallback:               true,
    };
  }
};

// ── 3. Get readiness score ─────────────────────────────
const getReadinessScore = async (topicMasteryMap) => {
  try {
    const res = await mlAxios.post(
      '/ml/readiness-score',
      { mastery: topicMasteryMap }
    );
    return res.data.data;

  } catch (error) {
    console.warn(
      'ML service unavailable for readiness:',
      error.message
    );
    const fallback = calculatePlacementReadiness(topicMasteryMap);
    return {
      readiness_score: fallback.readinessScore,
      readiness_level: fallback.readinessLevel,
      completed_topics: fallback.completedTopics,
      total_topics: fallback.totalTopics,
      missing_topics: fallback.missingTopics,
      fallback: true,
    };
  }
};

// ── 4. Get feature importance ──────────────────────────
const getFeatureImportance = async () => {
  try {
    const res = await mlAxios.get(
      '/ml/feature-importance'
    );
    return res.data.data;
  } catch (error) {
    console.warn('Cannot get feature importance:', 
      error.message);
    return null;
  }
};

// ── 5. Get training report ─────────────────────────────
const getTrainingReport = async () => {
  try {
    const res = await mlAxios.get('/ml/training-report');
    return res.data.data;
  } catch (error) {
    console.warn('Cannot get training report:', 
      error.message);
    return null;
  }
};

// ── 6. Health check ────────────────────────────────────
const checkMLHealth = async () => {
  try {
    const res = await mlAxios.get('/health');
    return { online: true, data: res.data };
  } catch (error) {
    return { online: false, error: error.message };
  }
};
const getDropoutRisk = async (studentData) => {
  try {
    const res = await axios.post(`${ML_URL}/ml/dropout/predict`, studentData);
    return res.data.data;
  } catch (err) {
    console.warn('Dropout prediction failed:', err.message);
    return { dropout_probability: 0.5, at_risk: false, fallback: true };
  }
};

const getCheatingRisk = async (sessionData) => {
  try {
    const res = await mlAxios.post('/ml/cheat/predict', sessionData);
    return res.data.data;
  } catch (err) {
    console.warn('Cheating prediction failed:', err.message);
    return {
      cheating_probability: 0,
      predicted_label: 0,
      fallback: true,
    };
  }
};

const analyzeProctorFrame = async (payload) => {
  try {
    const res = await mlAxios.post('/ml/proctor/analyze-frame', payload);
    return res.data.data;
  } catch (err) {
    console.warn('Proctor frame analysis failed:', err.message);
    return {
      riskScore: 0,
      riskLevel: 'LOW',
      alerts: [],
      detections: {
        multipleFaces: false,
        headPoseAway: false,
        gazeAway: false,
        faceMissing: false,
        phoneVisible: false,
        extraScreenVisible: false,
        faceCount: 1,
      },
      warningSuggested: false,
      confidence: 0,
      signals: [],
      fallback: true,
      metadata: {
        modelLoaded: false,
        modelSource: 'heuristic',
      },
    };
  }
};

const getProctorHealth = async () => {
  try {
    const res = await mlAxios.get('/ml/proctor/health');
    return normalizeProctorHealth(res.data);
  } catch (err) {
    const payload = err?.response?.data;
    if (payload?.data) {
      return normalizeProctorHealth(payload, payload?.data?.message || err.message);
    }

    return normalizeProctorHealth({}, 'Live proctor monitoring service is unreachable.');
  }
};

const analyzeMalpracticesFrame = async (payload) => {
  try {
    const res = await mlAxios.post('/ml/malpractices/analyze-frame', payload);
    return res.data.data;
  } catch (err) {
    console.warn('Malpractices frame analysis failed:', err.message);
    return {
      detections: {
        phoneVisible: false,
        headPoseAway: false,
        faceMissing: false,
        multipleFaces: false,
        extraScreenVisible: false,
        faceCount: 1,
      },
      alerts: [],
      signals: [],
      riskLevel: 'LOW',
      riskScore: 0,
      confidence: 0,
      metadata: {
        modelLoaded: false,
        modelSource: 'heuristic',
      },
      fallback: true,
    };
  }
};

const getMalpracticesHealth = async () => {
  try {
    const res = await mlAxios.get('/ml/malpractices/health');
    const status = res.data?.data || res.data || {};
    return {
      ready: Boolean(res.data?.success && (status.ready ?? true)),
      modelLoaded: status.modelLoaded || false,
      supportsPhoneDetection: status.supportsPhoneDetection || false,
      supportsHeadPoseDetection: status.supportsHeadPoseDetection || false,
      supportsFaceDetection: status.supportsFaceDetection || false,
      message: status.message || 'Malpractices pipeline unavailable',
    };
  } catch (err) {
    return {
      ready: false,
      modelLoaded: false,
      supportsPhoneDetection: false,
      supportsHeadPoseDetection: false,
      supportsFaceDetection: false,
      message: 'Malpractices pipeline service is unreachable.',
    };
  }
};

module.exports = {
  classifyLevel,
  detectWeakAreas,
  getReadinessScore,
  getFeatureImportance,
  getTrainingReport,
  checkMLHealth,
  getDropoutRisk,
  getCheatingRisk,
  analyzeProctorFrame,
  getProctorHealth,
  analyzeMalpracticesFrame,
  getMalpracticesHealth,
  buildMonitoringReadiness,
  normalizeLevelFromScore,
  buildDiagnosticPerformanceData,
  canonicalizeLevel,
};
