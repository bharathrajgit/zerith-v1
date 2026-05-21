import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';

// ─── Constants ─────────────────────────────────────────────────────────────
const WARNING_LIMITS = {
  gaze_away: 3,
  multiple_faces: 3,
  mobile_detected: 3,
  tab_switch: 3,
  copy_attempt: 5,
  behavioral_anomaly: 3,
};

const LOCK_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Action Types ──────────────────────────────────────────────────────────
const ACTIONS = {
  INIT: 'INIT',
  INCREMENT_WARNING: 'INCREMENT_WARNING',
  SET_LOCKED: 'SET_LOCKED',
  CLEAR_LOCK: 'CLEAR_LOCK',
  RESET: 'RESET',
  SYNC_FROM_SERVER: 'SYNC_FROM_SERVER',
};

// ─── Initial State ─────────────────────────────────────────────────────────
const createInitialState = (sessionType) => ({
  sessionType: sessionType || 'assessment',
  warnings: {
    gaze_away: 0,
    multiple_faces: 0,
    mobile_detected: 0,
    tab_switch: 0,
    copy_attempt: 0,
    behavioral_anomaly: 0,
  },
  totalWarnings: 0,
  isLocked: false,
  lockedUntil: null,
  lockReason: '',
  lockCount: 0,
  lastSyncAt: null,
});

// ─── Storage Keys ──────────────────────────────────────────────────────────
const getStorageKey = (sessionType) => `malpractice_state_${sessionType || 'assessment'}`;

const loadFromStorage = (sessionType) => {
  try {
    const stored = sessionStorage.getItem(getStorageKey(sessionType));
    if (stored) {
      const parsed = JSON.parse(stored);
      // Check if lock has expired
      if (parsed.isLocked && parsed.lockedUntil) {
        const lockedUntilTime = new Date(parsed.lockedUntil).getTime();
        if (Date.now() >= lockedUntilTime) {
          // Lock expired - clear it
          parsed.isLocked = false;
          parsed.lockedUntil = null;
          parsed.lockReason = '';
        }
      }
      return { ...createInitialState(sessionType), ...parsed };
    }
  } catch {
    // Ignore storage errors
  }
  return createInitialState(sessionType);
};

const saveToStorage = (state) => {
  try {
    sessionStorage.setItem(getStorageKey(state.sessionType), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
};

// ─── Reducer ───────────────────────────────────────────────────────────────
function malpracticeReducer(state, action) {
  switch (action.type) {
    case ACTIONS.INIT:
      return { ...createInitialState(action.payload?.sessionType), ...action.payload };

    case ACTIONS.INCREMENT_WARNING: {
      const { violationType } = action.payload;
      const currentCount = state.warnings[violationType] || 0;
      const newCount = currentCount + 1;
      const limit = WARNING_LIMITS[violationType] || 3;
      const newTotalWarnings = state.totalWarnings + 1;

      const newState = {
        ...state,
        warnings: {
          ...state.warnings,
          [violationType]: newCount,
        },
        totalWarnings: newTotalWarnings,
        lastSyncAt: Date.now(),
      };

      saveToStorage(newState);
      return newState;
    }

    case ACTIONS.SET_LOCKED: {
      const { lockReason, lockedUntil, lockCount } = action.payload;
      const newState = {
        ...state,
        isLocked: true,
        lockedUntil: lockedUntil || new Date(Date.now() + LOCK_DURATION_MS).toISOString(),
        lockReason: lockReason || '',
        lockCount: lockCount || state.lockCount + 1,
        lastSyncAt: Date.now(),
      };
      saveToStorage(newState);
      return newState;
    }

    case ACTIONS.CLEAR_LOCK: {
      const newState = {
        ...state,
        isLocked: false,
        lockedUntil: null,
        lockReason: '',
        lastSyncAt: Date.now(),
      };
      saveToStorage(newState);
      return newState;
    }

    case ACTIONS.RESET: {
      const newState = createInitialState(action.payload?.sessionType || state.sessionType);
      saveToStorage(newState);
      return newState;
    }

    case ACTIONS.SYNC_FROM_SERVER: {
      const serverState = action.payload;
      const newState = {
        ...state,
        isLocked: serverState.isLocked || false,
        lockedUntil: serverState.lockedUntil || null,
        lockReason: serverState.lockReason || '',
        lockCount: serverState.lockCount || 0,
        lastSyncAt: Date.now(),
      };
      saveToStorage(newState);
      return newState;
    }

    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────
const MalpracticeContext = createContext(null);

// ─── Provider ──────────────────────────────────────────────────────────────
export function MalpracticeProvider({ children }) {
  const [sessions, dispatch] = useReducer(
    (state, action) => {
      switch (action.type) {
        case ACTIONS.INIT: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const existing = state[sessionType] || loadFromStorage(sessionType);
          return {
            ...state,
            [sessionType]: { ...existing, ...action.payload },
          };
        }
        case ACTIONS.INCREMENT_WARNING: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const existing = state[sessionType] || loadFromStorage(sessionType);
          const currentCount = existing.warnings[action.payload.violationType] || 0;
          const newCount = currentCount + 1;
          const limit = WARNING_LIMITS[action.payload.violationType] || 3;

          const newSessionState = {
            ...existing,
            warnings: {
              ...existing.warnings,
              [action.payload.violationType]: newCount,
            },
            totalWarnings: existing.totalWarnings + 1,
            lastSyncAt: Date.now(),
          };

          saveToStorage(newSessionState);
          return { ...state, [sessionType]: newSessionState };
        }
        case ACTIONS.SET_LOCKED: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const existing = state[sessionType] || loadFromStorage(sessionType);
          const newSessionState = {
            ...existing,
            isLocked: true,
            lockedUntil: action.payload.lockedUntil || new Date(Date.now() + LOCK_DURATION_MS).toISOString(),
            lockReason: action.payload.lockReason || '',
            lockCount: action.payload.lockCount || existing.lockCount + 1,
            lastSyncAt: Date.now(),
          };
          saveToStorage(newSessionState);
          return { ...state, [sessionType]: newSessionState };
        }
        case ACTIONS.CLEAR_LOCK: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const existing = state[sessionType] || loadFromStorage(sessionType);
          const newSessionState = {
            ...existing,
            isLocked: false,
            lockedUntil: null,
            lockReason: '',
            lastSyncAt: Date.now(),
          };
          saveToStorage(newSessionState);
          return { ...state, [sessionType]: newSessionState };
        }
        case ACTIONS.RESET: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const newState = createInitialState(sessionType);
          saveToStorage(newState);
          return { ...state, [sessionType]: newState };
        }
        case ACTIONS.SYNC_FROM_SERVER: {
          const sessionType = action.payload?.sessionType || 'assessment';
          const existing = state[sessionType] || loadFromStorage(sessionType);
          const serverData = action.payload;
          const newSessionState = {
            ...existing,
            isLocked: serverData.isLocked || false,
            lockedUntil: serverData.lockedUntil || null,
            lockReason: serverData.lockReason || '',
            lockCount: serverData.lockCount || 0,
            lastSyncAt: Date.now(),
          };
          saveToStorage(newSessionState);
          return { ...state, [sessionType]: newSessionState };
        }
        default:
          return state;
      }
    },
    {
      assessment: loadFromStorage('assessment'),
      diagnostic: loadFromStorage('diagnostic'),
    }
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  const getSessionState = useCallback((sessionType = 'assessment') => {
    return sessions[sessionType] || loadFromStorage(sessionType);
  }, [sessions]);

  const incrementWarning = useCallback((sessionType, violationType) => {
    dispatch({ type: ACTIONS.INCREMENT_WARNING, payload: { sessionType, violationType } });
  }, []);

  const setLocked = useCallback((sessionType, payload = {}) => {
    dispatch({ type: ACTIONS.SET_LOCKED, payload: { sessionType, ...payload } });
  }, []);

  const clearLock = useCallback((sessionType) => {
    dispatch({ type: ACTIONS.CLEAR_LOCK, payload: { sessionType } });
  }, []);

  const resetSession = useCallback((sessionType) => {
    dispatch({ type: ACTIONS.RESET, payload: { sessionType } });
  }, []);

  const syncFromServer = useCallback((sessionType, serverData) => {
    dispatch({ type: ACTIONS.SYNC_FROM_SERVER, payload: { sessionType, ...serverData } });
  }, []);

  const checkLockStatus = useCallback(async (sessionType = 'assessment') => {
    try {
      const response = await api.get(`/malpractice/check-lock?sessionType=${sessionType}`);
      if (response.data?.isLocked) {
        setLocked(sessionType, {
          lockedUntil: response.data.lockedUntil,
          lockReason: response.data.lockReason,
          lockCount: response.data.lockCount,
        });
        return { isLocked: true, ...response.data };
      }
      // Clear any stale local lock
      const localState = getSessionState(sessionType);
      if (localState.isLocked) {
        clearLock(sessionType);
      }
      return { isLocked: false };
    } catch (error) {
      console.error('[MalpracticeContext] Lock check failed:', error);
      return { isLocked: false, error: error.message };
    }
  }, [setLocked, clearLock, getSessionState]);

  const getWarningCount = useCallback((sessionType, violationType) => {
    const state = getSessionState(sessionType);
    if (violationType) {
      return state.warnings[violationType] || 0;
    }
    return state.totalWarnings;
  }, [getSessionState]);

  const getWarningLimit = useCallback((violationType) => {
    return WARNING_LIMITS[violationType] || 3;
  }, []);

  const shouldLock = useCallback((sessionType, violationType) => {
    const state = getSessionState(sessionType);
    const count = state.warnings[violationType] || 0;
    const limit = WARNING_LIMITS[violationType] || 3;
    return count >= limit;
  }, [getSessionState]);

  // ── Context Value ────────────────────────────────────────────────────────

  const contextValue = useMemo(() => ({
    sessions,
    getSessionState,
    incrementWarning,
    setLocked,
    clearLock,
    resetSession,
    syncFromServer,
    checkLockStatus,
    getWarningCount,
    getWarningLimit,
    shouldLock,
    WARNING_LIMITS,
  }), [
    sessions,
    getSessionState,
    incrementWarning,
    setLocked,
    clearLock,
    resetSession,
    syncFromServer,
    checkLockStatus,
    getWarningCount,
    getWarningLimit,
    shouldLock,
  ]);

  return (
    <MalpracticeContext.Provider value={contextValue}>
      {children}
    </MalpracticeContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useMalpractice(sessionType = 'assessment') {
  const context = useContext(MalpracticeContext);

  if (!context) {
    throw new Error('useMalpractice must be used within a MalpracticeProvider');
  }

  const state = context.getSessionState(sessionType);

  const incrementWarning = useCallback((violationType) => {
    context.incrementWarning(sessionType, violationType);
  }, [context, sessionType]);

  const setLocked = useCallback((payload) => {
    context.setLocked(sessionType, payload);
  }, [context, sessionType]);

  const clearLock = useCallback(() => {
    context.clearLock(sessionType);
  }, [context, sessionType]);

  const resetSession = useCallback(() => {
    context.resetSession(sessionType);
  }, [context, sessionType]);

  const checkLockStatus = useCallback(async () => {
    return context.checkLockStatus(sessionType);
  }, [context, sessionType]);

  const getWarningCount = useCallback((violationType) => {
    return context.getWarningCount(sessionType, violationType);
  }, [context, sessionType]);

  const shouldLock = useCallback((violationType) => {
    return context.shouldLock(sessionType, violationType);
  }, [context, sessionType]);

  return {
    ...state,
    incrementWarning,
    setLocked,
    clearLock,
    resetSession,
    checkLockStatus,
    getWarningCount,
    shouldLock,
    getWarningLimit: context.getWarningLimit,
    WARNING_LIMITS: context.WARNING_LIMITS,
  };
}

export default MalpracticeContext;