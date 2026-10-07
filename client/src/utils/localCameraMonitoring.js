const FACE_MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
const PHONE_CLASSES = new Set(['cell phone', 'mobile phone', 'phone']);

let faceApiImportPromise = null;
let faceApiModelsPromise = null;
let cocoSsdImportPromise = null;
let cocoModelPromise = null;

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toCoordinates = (source) => {
  if (Array.isArray(source) && source.length >= 4) {
    const [startX, startY, endX, endY] = source.map((value) => safeNumber(value, NaN));
    if ([startX, startY, endX, endY].some((value) => Number.isNaN(value))) return null;

    const x1 = Math.min(startX, endX);
    const y1 = Math.min(startY, endY);
    const x2 = Math.max(startX, endX);
    const y2 = Math.max(startY, endY);

    return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
  }

  const x = safeNumber(source?.x ?? source?.left ?? NaN, NaN);
  const y = safeNumber(source?.y ?? source?.top ?? NaN, NaN);
  const width = safeNumber(source?.width ?? source?.w ?? NaN, NaN);
  const height = safeNumber(source?.height ?? source?.h ?? NaN, NaN);

  if ([x, y, width, height].some((value) => Number.isNaN(value))) return null;

  const x2 = x + width;
  const y2 = y + height;
  return x2 > x && y2 > y ? [x, y, x2, y2] : null;
};

const loadFaceApiModule = async () => {
  if (!faceApiImportPromise) {
    faceApiImportPromise = import('face-api.js')
      .then((module) => module.default || module)
      .catch((error) => {
        faceApiImportPromise = null;
        throw error;
      });
  }

  return faceApiImportPromise;
};

const ensureFaceApiModels = async () => {
  if (!faceApiModelsPromise) {
    faceApiModelsPromise = (async () => {
      const faceapi = await loadFaceApiModule();
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
      return faceapi;
    })().catch((error) => {
      faceApiModelsPromise = null;
      throw error;
    });
  }

  return faceApiModelsPromise;
};

const loadCocoSsdModule = async () => {
  if (!cocoSsdImportPromise) {
    cocoSsdImportPromise = import('@tensorflow-models/coco-ssd')
      .then((module) => module.default || module)
      .catch((error) => {
        cocoSsdImportPromise = null;
        throw error;
      });
  }

  return cocoSsdImportPromise;
};

const ensureCocoModel = async () => {
  if (!cocoModelPromise) {
    cocoModelPromise = (async () => {
      const cocoSsd = await loadCocoSsdModule();
      return cocoSsd.load();
    })().catch((error) => {
      cocoModelPromise = null;
      throw error;
    });
  }

  return cocoModelPromise;
};

const detectFaces = async (video) => {
  console.log('[LocalCameraMonitoring] detectFaces called, video:', !!video, 'videoWidth:', video?.videoWidth, 'videoHeight:', video?.videoHeight);
  
  if (!video) {
    console.log('[LocalCameraMonitoring] No video provided for face detection');
    return { supported: false, boxes: [] };
  }

  if (typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      console.log('[LocalCameraMonitoring] Using native FaceDetector');
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
      const faces = await detector.detect(video);
      console.log('[LocalCameraMonitoring] Native FaceDetector detected faces:', faces.length);
      return {
        supported: true,
        boxes: faces
          .map((face, index) => {
            const coordinates = toCoordinates(face?.boundingBox);
            if (!coordinates) return null;

            return {
              type: 'face',
              label: faces.length > 1 ? `Face ${index + 1}` : 'Face',
              confidence: 0.9,
              coordinates,
            };
          })
          .filter(Boolean),
      };
    } catch (_error) {
      console.log('[LocalCameraMonitoring] Native FaceDetector failed, falling back to face-api.js:', _error);
      // Fall through to face-api.js.
    }
  }

  try {
    console.log('[LocalCameraMonitoring] Using face-api.js');
    const faceapi = await ensureFaceApiModels();
    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 320, // Reduced from 416 for faster detection
        scoreThreshold: 0.5, // Increased from 0.35 to reduce false positives and speed up
      })
    );
    console.log('[LocalCameraMonitoring] face-api.js detected faces:', detections.length);
    return {
      supported: true,
      boxes: detections
        .map((detection, index) => {
          const coordinates = toCoordinates(detection?.box || detection?.detection?.box || detection);
          if (!coordinates) return null;

          return {
            type: 'face',
            label: detections.length > 1 ? `Face ${index + 1}` : 'Face',
            confidence: safeNumber(detection?.score ?? detection?.detection?.score, 0.8),
            coordinates,
          };
        })
        .filter(Boolean),
    };
  } catch (_error) {
    console.log('[LocalCameraMonitoring] face-api.js failed:', _error);
    return { supported: false, boxes: [] };
  }
};

const detectPhones = async (video) => {
  console.log('[LocalCameraMonitoring] detectPhones called, video:', !!video);
  
  if (!video) {
    console.log('[LocalCameraMonitoring] No video provided for phone detection');
    return { supported: false, boxes: [] };
  }

  // Phone detection is handled server-side using trained YOLO model
  // Client-side coco-ssd is disabled due to tensorflow compatibility issues
  console.log('[LocalCameraMonitoring] Phone detection handled server-side using trained model');
  return { supported: false, boxes: [] };
};

const getLocalRiskLevel = (primaryViolationType, confidence, faceCount, phoneCount) => {
  if (!primaryViolationType) return 'NONE';

  if (primaryViolationType === 'mobile_detected') {
    return phoneCount > 1 || confidence >= 0.85 ? 'HIGH' : 'MEDIUM';
  }

  if (primaryViolationType === 'multiple_faces') {
    return faceCount > 2 || confidence >= 0.8 ? 'HIGH' : 'MEDIUM';
  }

  if (primaryViolationType === 'face_missing') {
    return confidence >= 0.7 ? 'MEDIUM' : 'LOW';
  }

  return 'LOW';
};

export const analyzeLocalMonitoringFrame = async (video) => {
  console.log('[LocalCameraMonitoring] analyzeLocalMonitoringFrame called, video:', !!video, 'videoWidth:', video?.videoWidth, 'videoHeight:', video?.videoHeight);
  
  if (!video?.videoWidth || !video?.videoHeight) {
    console.log('[LocalCameraMonitoring] Video not ready, returning null');
    return null;
  }

  const [faceDetection, phoneDetection] = await Promise.all([
    detectFaces(video),
    detectPhones(video),
  ]);

  console.log('[LocalCameraMonitoring] faceDetection supported:', faceDetection.supported, 'phoneDetection supported:', phoneDetection.supported);

  if (!faceDetection.supported && !phoneDetection.supported) {
    console.log('[LocalCameraMonitoring] Neither detection supported, returning null');
    return null;
  }

  const faceBoxes = Array.isArray(faceDetection.boxes) ? faceDetection.boxes : [];
  const phoneBoxes = Array.isArray(phoneDetection.boxes) ? phoneDetection.boxes : [];
  const faceSupported = faceDetection.supported;
  const phoneSupported = phoneDetection.supported;
  const faceCount = faceSupported ? faceBoxes.length : 0;
  const phoneCount = phoneSupported ? phoneBoxes.length : 0;
  const phoneVisible = phoneSupported && phoneCount > 0;
  const multipleFaces = faceSupported && faceCount > 1;
  const faceMissing = faceSupported && faceCount === 0;
  
  console.log('[LocalCameraMonitoring] Detection results:', {
    faceSupported,
    faceCount,
    faceMissing,
    phoneSupported,
    phoneCount,
    phoneVisible,
    multipleFaces,
  });
  const primaryViolationType = phoneVisible
    ? 'mobile_detected'
    : multipleFaces
      ? 'multiple_faces'
      : faceMissing
        ? 'face_missing'
        : '';
  const confidence = phoneVisible
    ? Math.max(...phoneBoxes.map((box) => safeNumber(box?.confidence, 0)), 0)
    : multipleFaces
      ? Math.max(...faceBoxes.map((box) => safeNumber(box?.confidence, 0)), 0.72)
      : faceMissing
        ? 0.58
        : 0;

  const detections = {
    multipleFaces,
    headPoseAway: false,
    gazeAway: false,
    faceMissing,
    faceCount,
    phoneVisible,
    extraScreenVisible: false,
  };
  const annotations = [...faceBoxes, ...phoneBoxes].map((box) => ({
    ...box,
  }));
  const alerts = primaryViolationType
    ? [{
      type: primaryViolationType,
      message:
        primaryViolationType === 'mobile_detected'
          ? 'Phone detected in the camera frame.'
          : primaryViolationType === 'multiple_faces'
            ? 'Multiple faces detected in the camera frame.'
            : 'Face missing from the camera frame.',
      confidence,
    }]
    : [];

  return {
    detections,
    faceBoxes,
    phoneBoxes,
    annotations,
    alerts,
    signals: primaryViolationType
      ? [primaryViolationType === 'mobile_detected'
        ? 'PHONE_VISIBLE'
        : primaryViolationType === 'multiple_faces'
          ? 'MULTIPLE_FACES'
          : 'FACE_MISSING']
      : [],
    confidence,
    riskLevel: getLocalRiskLevel(primaryViolationType, confidence, faceCount, phoneCount),
    frameSize: {
      width: video.videoWidth,
      height: video.videoHeight,
    },
    primaryViolationType,
    fallback: true,
    metadata: {
      modelLoaded: faceSupported || phoneSupported,
      modelSource: 'browser',
    },
  };
};
