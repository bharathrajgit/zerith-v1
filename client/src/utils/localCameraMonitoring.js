const FACE_API_MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
const PHONE_CLASSES = new Set(['cell phone']);
const PHONE_MIN_SCORE = 0.55;
const FACE_MIN_SCORE = 0.5;
const EVIDENCE_MAX_WIDTH = 320;

let faceDetectorPromise = null;
let phoneDetectorPromise = null;

const loadFaceDetector = () => {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      if (typeof window !== 'undefined' && 'FaceDetector' in window) {
        try {
          const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
          return {
            detect: async (video) => {
              const faces = await detector.detect(video);
              return faces.map((face) => {
                const box = face.boundingBox || {};
                return {
                  x1: box.x,
                  y1: box.y,
                  x2: box.x + box.width,
                  y2: box.y + box.height,
                  confidence: 1,
                };
              });
            },
          };
        } catch {
          // Fall through to face-api.js when the native detector cannot be created.
        }
      }

      const faceapi = await import('face-api.js');
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL);
      const options = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: FACE_MIN_SCORE });
      return {
        detect: async (video) => {
          const faces = await faceapi.detectAllFaces(video, options);
          return faces.map((face) => ({
            x1: face.box.x,
            y1: face.box.y,
            x2: face.box.x + face.box.width,
            y2: face.box.y + face.box.height,
            confidence: Number(face.score || 0),
          }));
        },
      };
    })().catch((error) => {
      console.warn('[LocalMonitoring] Face detector unavailable:', error?.message || error);
      return null;
    });
  }
  return faceDetectorPromise;
};

const loadPhoneDetector = () => {
  if (!phoneDetectorPromise) {
    phoneDetectorPromise = (async () => {
      await import('@tensorflow/tfjs');
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      const model = await cocoSsd.load();
      return {
        detect: async (video) => {
          const predictions = await model.detect(video);
          return predictions
            .filter((prediction) => PHONE_CLASSES.has(prediction.class) && prediction.score >= PHONE_MIN_SCORE)
            .map((prediction) => {
              const [x, y, width, height] = prediction.bbox;
              return {
                x1: x,
                y1: y,
                x2: x + width,
                y2: y + height,
                confidence: Number(prediction.score || 0),
                label: prediction.class,
              };
            });
        },
      };
    })().catch((error) => {
      console.warn('[LocalMonitoring] Phone detector unavailable:', error?.message || error);
      return null;
    });
  }
  return phoneDetectorPromise;
};

const captureEvidenceImage = (video) => {
  try {
    const sourceWidth = video.videoWidth || 320;
    const sourceHeight = video.videoHeight || 240;
    const scale = sourceWidth > EVIDENCE_MAX_WIDTH ? EVIDENCE_MAX_WIDTH / sourceWidth : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return '';
  }
};

const safeDetect = async (detector, video) => {
  if (!detector) return null;
  try {
    return await detector.detect(video);
  } catch (error) {
    console.warn('[LocalMonitoring] Detection failed:', error?.message || error);
    return null;
  }
};

export const analyzeLocalMonitoringFrame = async (video) => {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const [faceDetector, phoneDetector] = await Promise.all([loadFaceDetector(), loadPhoneDetector()]);
  if (!faceDetector && !phoneDetector) return null;

  const [faceBoxes, phoneBoxes] = await Promise.all([
    safeDetect(faceDetector, video),
    safeDetect(phoneDetector, video),
  ]);

  const faceAnalysisAvailable = Array.isArray(faceBoxes);
  const phoneAnalysisAvailable = Array.isArray(phoneBoxes);
  if (!faceAnalysisAvailable && !phoneAnalysisAvailable) return null;

  const faces = faceBoxes || [];
  const phones = phoneBoxes || [];
  const faceCount = faceAnalysisAvailable ? faces.length : 1;

  const detections = {
    multipleFaces: faceAnalysisAvailable && faceCount > 1,
    headPoseAway: false,
    gazeAway: false,
    faceMissing: faceAnalysisAvailable && faceCount === 0,
    phoneVisible: phones.length > 0,
    extraScreenVisible: false,
    faceCount,
  };

  const alerts = [];
  const phoneConfidence = phones.reduce((max, box) => Math.max(max, box.confidence), 0);
  if (detections.phoneVisible) {
    alerts.push({
      code: 'PHONE_VISIBLE',
      type: 'mobile_detected',
      message: 'Phone detected in the camera frame.',
      severity: 'HIGH',
      confidence: phoneConfidence,
    });
  }
  if (detections.multipleFaces) {
    alerts.push({
      code: 'MULTIPLE_FACES',
      type: 'multiple_faces',
      message: 'Multiple faces detected in the camera frame.',
      severity: 'HIGH',
      confidence: Math.min(0.98, 0.6 + (faceCount * 0.15)),
    });
  }
  if (detections.faceMissing) {
    alerts.push({
      code: 'FACE_MISSING',
      type: 'face_missing',
      message: 'Face missing from the camera frame.',
      severity: 'MEDIUM',
      confidence: 0.75,
    });
  }

  const primaryAlert = alerts[0] || null;
  const primaryViolationType = primaryAlert?.type || '';
  const confidence = Number(primaryAlert?.confidence || 0);
  const riskLevel = primaryAlert ? primaryAlert.severity : 'NONE';

  const annotations = [
    ...faces.map((box, index) => ({
      type: 'face',
      label: faces.length > 1 ? `Face ${index + 1}` : 'Face',
      confidence: box.confidence,
      box: [box.x1, box.y1, box.x2, box.y2],
    })),
    ...phones.map((box) => ({
      type: 'phone',
      label: 'Phone',
      confidence: box.confidence,
      box: [box.x1, box.y1, box.x2, box.y2],
    })),
  ];

  const shouldCaptureEvidence = primaryViolationType === 'mobile_detected' || primaryViolationType === 'multiple_faces';

  return {
    detections,
    faceBoxes: faces.map((box) => ({ box: [box.x1, box.y1, box.x2, box.y2], confidence: box.confidence })),
    phoneBoxes: phones.map((box) => ({ box: [box.x1, box.y1, box.x2, box.y2], confidence: box.confidence })),
    annotations,
    alerts,
    signals: alerts.map((alert) => alert.code),
    confidence,
    riskLevel,
    frameSize: { width: video.videoWidth, height: video.videoHeight },
    primaryViolationType,
    detectedObject: primaryViolationType === 'mobile_detected' ? (phones[0]?.label || 'cell phone') : '',
    violationImage: shouldCaptureEvidence ? captureEvidenceImage(video) : '',
  };
};
