const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMonitoringReadiness } = require('../services/mlService');

const makeHealth = (overrides = {}) => ({
  ready: true,
  fullModelReady: false,
  cameraMonitoringReady: true,
  modelLoaded: false,
  modelFilePresent: true,
  onnxRuntimeAvailable: true,
  imageStackAvailable: true,
  modelSource: 'heuristic',
  supportedLabels: [],
  supportsCameraMonitoring: true,
  supportsPhoneDetection: false,
  supportsExtraScreenDetection: false,
  supportsFallbackHeuristics: true,
  message: 'Using heuristic camera monitoring with limited detection.',
  ...overrides,
});

test('diagnostic readiness remains available with heuristic fallback when the ONNX model file is missing', () => {
  const readiness = buildMonitoringReadiness(makeHealth({
    modelFilePresent: false,
    message: 'The proctor ONNX model file is missing. Using heuristic camera monitoring with limited detection.',
  }), 'diagnostic');

  assert.equal(readiness.ready, true);
  assert.equal(readiness.fullModelReady, false);
  assert.equal(readiness.limitedDetection, true);
  assert.equal(readiness.capability, 'limited');
  assert.match(readiness.message, /onnx model file is missing/i);
});

test('diagnostic readiness remains available with heuristic fallback when onnxruntime is unavailable', () => {
  const readiness = buildMonitoringReadiness(makeHealth({
    onnxRuntimeAvailable: false,
    message: 'onnxruntime is not available in the ML service environment. Using heuristic camera monitoring with limited detection.',
  }), 'diagnostic');

  assert.equal(readiness.ready, true);
  assert.equal(readiness.fullModelReady, false);
  assert.equal(readiness.limitedDetection, true);
  assert.match(readiness.message, /onnxruntime is not available/i);
});

test('diagnostic readiness remains available with heuristic fallback when the ONNX model cannot be loaded', () => {
  const readiness = buildMonitoringReadiness(makeHealth({
    modelLoaded: false,
    modelFilePresent: true,
    onnxRuntimeAvailable: true,
    imageStackAvailable: true,
    message: 'The proctor model could not be loaded. Using heuristic camera monitoring with limited detection.',
  }), 'diagnostic');

  assert.equal(readiness.ready, true);
  assert.equal(readiness.fullModelReady, false);
  assert.equal(readiness.capability, 'limited');
  assert.match(readiness.message, /could not be loaded/i);
});

test('non-diagnostic readiness can remain available with heuristic fallback', () => {
  const readiness = buildMonitoringReadiness(makeHealth({
    modelLoaded: false,
    fullModelReady: false,
    message: 'The proctor ONNX model file is missing. Using heuristic camera monitoring with limited detection.',
  }), 'assessment');

  assert.equal(readiness.ready, true);
  assert.equal(readiness.fullModelReady, false);
  assert.equal(readiness.cameraMonitoringReady, true);
  assert.equal(readiness.capability, 'limited');
});

test('full ONNX readiness reports full capability and object detection support', () => {
  const readiness = buildMonitoringReadiness(makeHealth({
    fullModelReady: true,
    modelLoaded: true,
    modelFilePresent: true,
    onnxRuntimeAvailable: true,
    supportsPhoneDetection: true,
    supportsExtraScreenDetection: true,
    modelSource: 'onnx',
    message: 'Live proctor model is ready.',
  }), 'assessment');

  assert.equal(readiness.ready, true);
  assert.equal(readiness.fullModelReady, true);
  assert.equal(readiness.limitedDetection, false);
  assert.equal(readiness.capability, 'full');
  assert.equal(readiness.supportsPhoneDetection, true);
  assert.equal(readiness.supportsExtraScreenDetection, true);
});
