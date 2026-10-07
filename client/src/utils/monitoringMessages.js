const getLastNonEmptyMessage = (entries = []) => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = String(entries[index]?.message || '').trim();
    if (message) {
      return message;
    }
  }

  return '';
};

export const getLatestMonitoringWarningMessage = (sessionState, fallback = '') => (
  getLastNonEmptyMessage(Array.isArray(sessionState?.warnings) ? sessionState.warnings : [])
  || getLastNonEmptyMessage(Array.isArray(sessionState?.alerts) ? sessionState.alerts : [])
  || fallback
);
