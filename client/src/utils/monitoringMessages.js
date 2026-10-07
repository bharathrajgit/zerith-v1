const LOCK_REASON_MESSAGES = {
  mobile_detected: 'A phone was detected in the camera frame.',
  multiple_faces: 'Multiple faces were detected in the camera frame.',
  face_missing: 'Your face was not visible in the camera frame.',
  gaze_away: 'You looked away from the screen repeatedly.',
  tab_switch: 'Tab switching was detected during the monitored session.',
  copy_attempt: 'Copy or selection activity was detected during the monitored session.',
  behavioral_anomaly: 'Window focus was lost repeatedly during the monitored session.',
};

const toMessage = (value) => (typeof value === 'string' ? value.trim() : '');

export const getLatestMonitoringWarningMessage = (state, fallback = '') => {
  if (!state || typeof state !== 'object') return fallback;

  const warnings = Array.isArray(state.warnings) ? state.warnings : [];
  for (let index = warnings.length - 1; index >= 0; index -= 1) {
    const message = toMessage(warnings[index]?.message);
    if (message) return message;
  }

  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  const alertMessage = alerts.map((alert) => toMessage(alert?.message)).find(Boolean);
  if (alertMessage) return alertMessage;

  if (state.isLocked && state.lockReason) {
    return LOCK_REASON_MESSAGES[state.lockReason] || toMessage(state.lockReason) || fallback;
  }

  return fallback;
};
