import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import StudentLayout from '../../components/layout/StudentLayout';
import CameraMonitoringLayer from '../../components/common/CameraMonitoringLayer';
import MonitoringConsentModal from '../../components/common/MonitoringConsentModal';
import { LockScreen } from '../../components/malpractice/MalpracticeMonitor';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import usePracticeMonitoring from '../../hooks/usePracticeMonitoring';
import { isMonitoringStageReadyToProceed } from '../../hooks/usePracticeMonitoring.helpers';
import { getLatestMonitoringWarningMessage } from '../../utils/monitoringMessages';

const formatDuration = (lockedUntil) => {
  const remainingMs = Math.max(0, new Date(lockedUntil || 0).getTime() - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
};

const shellCard = {
  borderRadius: 24,
  border: '1px solid rgba(51,65,85,0.88)',
  background: 'linear-gradient(180deg, rgba(9,13,25,0.98), rgba(15,23,42,0.9))',
  boxShadow: '0 28px 60px rgba(2,6,23,0.35)',
};

const badgeStyle = (tone) => {
  if (tone === 'good') {
    return { background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.28)', color: '#86efac' };
  }
  if (tone === 'warn') {
    return { background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.28)', color: '#fcd34d' };
  }
  if (tone === 'bad') {
    return { background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5' };
  }
  return { background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.28)', color: '#c7d2fe' };
};

const verdictTone = (verdict) => {
  if (verdict === 'Accepted') return 'good';
  if (verdict === 'Wrong Answer') return 'warn';
  return 'bad';
};

const tabButtonStyle = (active) => ({
  padding: '0.75rem 1rem',
  borderRadius: 14,
  border: active ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(51,65,85,0.9)',
  background: active ? 'rgba(37,99,235,0.18)' : 'rgba(15,23,42,0.7)',
  color: active ? '#eff6ff' : '#94a3b8',
  fontWeight: 700,
  cursor: 'pointer',
});

export default function CodingPage() {
  const { problemId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [problem, setProblem] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [activeTab, setActiveTab] = useState('description');
  const [discussionScope, setDiscussionScope] = useState('public');
  const [discussionThreads, setDiscussionThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [threadForm, setThreadForm] = useState({ title: '', body: '', tags: '' });
  const [replyBody, setReplyBody] = useState('');
  const [discussionSubmitting, setDiscussionSubmitting] = useState(false);
  const [lockCheckLoading, setLockCheckLoading] = useState(true);
  const [isLockedByMalpractice, setIsLockedByMalpractice] = useState(false);
  const [lockInfo, setLockInfo] = useState(null);
  const [lockCountdown, setLockCountdown] = useState('');
  const [monitoringStarting, setMonitoringStarting] = useState(false);
  const [screen, setScreen] = useState('loading');

  const canUseInstitutionScope = !!user?.institutionId;
  const lastWarningCountRef = useRef(0);
  const lastIsLockedRef = useRef(false);
  const lastFinalFlaggedRef = useRef(false);

  const handleMonitoringStatusChange = useCallback((nextState) => {
    // Only handle lock state changes if we're on the editor screen
    // Ignore lock changes during initialization on intro screen
    if (screen === 'intro') {
      return;
    }

    const warningMessage = getLatestMonitoringWarningMessage(nextState, 'Monitoring warning detected.');
    const currentWarningCount = nextState?.warningCount || 0;
    const currentIsLocked = nextState?.isLocked || false;
    const currentFinalFlagged = nextState?.finalFlagged || false;

    if (currentIsLocked && !lastIsLockedRef.current) {
      setIsLockedByMalpractice(true);
      setLockInfo(nextState);
      lastIsLockedRef.current = true;
      // Defer toast to avoid updating state during render
      setTimeout(() => toast.error(warningMessage), 0);
      return;
    }

    if (currentFinalFlagged && !lastFinalFlaggedRef.current) {
      lastFinalFlaggedRef.current = true;
      setTimeout(() => toast.error(`${warningMessage} Warning ${currentWarningCount}/${nextState.warningLimit}.`), 0);
      return;
    }

    if (currentWarningCount > 0 && currentWarningCount !== lastWarningCountRef.current) {
      lastWarningCountRef.current = currentWarningCount;
      setTimeout(() => toast(`${warningMessage} Warning ${currentWarningCount}/${nextState.warningLimit}.`, {
        icon: '⚠️',
      }), 0);
    }
  }, [screen]);

  const {
    browserEventTrackingActive,
    browserMetrics,
    captureVideoRef,
    consentModal,
    error: monitoringError,
    finishMonitoring,
    isMonitoring,
    latestErrorRef,
    monitoringMode,
    monitoringReadiness,
    monitoringStage,
    sessionId,
    sessionIdRef,
    sessionState,
    startMonitoring,
    stream,
    trackBrowserEvent,
    visionState,
    faceMissingCountdown,
  } = usePracticeMonitoring({
    sessionType: 'coding',
    problemId,
    mode: 'full',
    allowBrowserOnlyFallback: true,
    institutionLinked: canUseInstitutionScope,
    sessionLabel: 'coding practice session',
    analysisEnabled: screen === 'editor',
    onStatusChange: handleMonitoringStatusChange,
    autoStart: false,
  });

  const loadProblem = async () => {
    const { data } = await api.get(`/coding/${problemId}`);
    if (!data.success) throw new Error(data.message || 'Failed to load coding problem.');
    setProblem(data.data.problem);
    setWorkspace(data.data.workspace);
    setSubmissions(data.data.recentSubmissions || []);
    setCode(data.data.workspace?.draftCode || data.data.problem?.javaStarterCode || '');
  };

  const resolveMonitoringSessionId = async (preferredSessionId = null, timeoutMs = 1500) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const activeSessionId = preferredSessionId
        || sessionIdRef.current
        || sessionId
        || sessionState?.monitoringSessionId;

      if (activeSessionId) {
        return activeSessionId;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    return preferredSessionId
      || sessionIdRef.current
      || sessionId
      || sessionState?.monitoringSessionId
      || null;
  };

  const startMonitoringAndShowEditor = async () => {
    if (monitoringStarting) return;
    setMonitoringStarting(true);

    try {
      const monitoringApproved = await startMonitoring();
      if (!monitoringApproved) {
        const message = latestErrorRef.current || monitoringError || 'Monitoring could not be started. Please try again.';
        toast.error(message);
        setMonitoringStarting(false);
        return;
      }

      const startedMonitoringSessionId = (
        monitoringApproved && typeof monitoringApproved === 'object'
          ? monitoringApproved.monitoringSessionId
          : null
      );
      const activeMonitoringSessionId = await resolveMonitoringSessionId(startedMonitoringSessionId);
      const browserOnlyMonitoring = monitoringMode === 'browser-only' && !activeMonitoringSessionId;

      if (!activeMonitoringSessionId && !browserOnlyMonitoring) {
        console.warn('[CodingPage] Monitoring session ID was not ready when the editor opened.');
      }

      if (browserOnlyMonitoring) {
        toast.success('Browser-only monitoring is active for this coding session.');
      }

      // Check lock after monitoring is ready (like diagnostic page does)
      const lockResponse = await api.get(`/malpractice/check-lock?sessionType=coding&problemId=${problemId}`);
      if (lockResponse.data?.isLocked) {
        setIsLockedByMalpractice(true);
        setLockInfo(lockResponse.data);
        setMonitoringStarting(false);
        setScreen('intro');
        // Clean up monitoring session if locked
        if (sessionIdRef.current || sessionId || sessionState?.monitoringSessionId) {
          finishMonitoring({ problemId }, { keepalive: true }).catch(() => null);
        }
        return;
      }

      setScreen('editor');
    } catch (error) {
      const message = error.message || 'Failed to start monitoring. Please try again.';
      toast.error(message);
      
      // Clean up monitoring session on error
      if (sessionIdRef.current || sessionId || sessionState?.monitoringSessionId) {
        finishMonitoring({ problemId }, { keepalive: true }).catch(() => null);
      }
      
      setScreen('intro');
    } finally {
      setMonitoringStarting(false);
    }
  };

  const loadDiscussions = async (scope = discussionScope) => {
    setDiscussionLoading(true);
    try {
      const { data } = await api.get(`/coding/${problemId}/discussions?scope=${scope}`);
      if (data.success) {
        const nextThreads = data.data.threads || [];
        setDiscussionThreads(nextThreads);
        if (selectedThread) {
          const exists = nextThreads.find((thread) => thread._id === selectedThread._id);
          if (!exists) setSelectedThread(null);
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load discussions.');
    } finally {
      setDiscussionLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const boot = async () => {
      try {
        await loadProblem();
        if (isMounted) {
          setScreen('intro');
        }
      } catch (err) {
        if (isMounted) {
          setError(err?.response?.data?.message || err.message || 'This coding challenge is unavailable right now.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    boot();

    return () => {
      isMounted = false;
    };
  }, [problemId]);

  useEffect(() => {
    let isMounted = true;

    const checkLock = async () => {
      try {
        const response = await api.get('/malpractice/check-lock?sessionType=coding');
        if (!isMounted) return;
        if (response.data?.isLocked) {
          setIsLockedByMalpractice(true);
          setLockInfo(response.data);
        }
      } catch (error) {
        console.error('Lock check failed:', error);
      } finally {
        if (isMounted) {
          setLockCheckLoading(false);
        }
      }
    };

    // Initial lock check on mount
    checkLock();

    // Re-check lock when page becomes visible (user returns from another tab)
    const handleVisibilityChange = () => {
      if (!document.hidden && isMounted && !isLockedByMalpractice) {
        setLockCheckLoading(true);
        checkLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      isMounted = false;
    };
  }, [isLockedByMalpractice]);

  useEffect(() => {
    if (activeTab === 'discussion' && problem) {
      loadDiscussions(discussionScope);
    }
  }, [activeTab, discussionScope, problem]);

  useEffect(() => {
    let copyThrottleTimer;

    const shouldMonitor = () => (
      browserEventTrackingActive
      && screen === 'editor'
      && isMonitoringStageReadyToProceed(monitoringStage)
    );

    const onVisibility = () => {
      if (document.hidden && shouldMonitor()) {
        trackBrowserEvent('tabSwitches');
        toast('Do not switch tabs during coding practice.', { icon: '⚠️' });
      }
    };

    const onCopy = () => {
      if (!shouldMonitor() || copyThrottleTimer) return;
      trackBrowserEvent('copyAttempts');
      copyThrottleTimer = window.setTimeout(() => {
        copyThrottleTimer = null;
      }, 1000);
    };

    const onBlur = () => {
      if (shouldMonitor()) {
        trackBrowserEvent('windowBlurCount');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', onCopy);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', onCopy);
      window.removeEventListener('blur', onBlur);
      if (copyThrottleTimer) window.clearTimeout(copyThrottleTimer);
    };
  }, [browserEventTrackingActive, monitoringStage, screen, trackBrowserEvent]);

  useEffect(() => {
    if (!sessionState?.isLocked) return;

    setIsLockedByMalpractice(true);
    setLockInfo((current) => current || sessionState);
    finishMonitoring(
      {
        problemId,
      },
      { keepalive: true }
    ).catch(() => null);
  }, [finishMonitoring, problemId, sessionState]);

  // Lock countdown timer - always called but only runs when locked
  useEffect(() => {
    if (!isLockedByMalpractice || !lockInfo?.lockedUntil) return;

    setLockCountdown(formatDuration(lockInfo.lockedUntil));

    const intervalId = setInterval(() => {
      const remaining = new Date(lockInfo.lockedUntil).getTime() - Date.now();
      if (remaining <= 0) {
        clearInterval(intervalId);
        setIsLockedByMalpractice(false);
        setLockInfo(null);
        setLockCountdown('');
        navigate('/coding', { replace: true });
        return;
      }
      setLockCountdown(formatDuration(lockInfo.lockedUntil));
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isLockedByMalpractice, lockInfo?.lockedUntil, navigate]);

  const visibleTests = useMemo(
    () => (problem?.testCases || []).filter((testCase) => !testCase.isHidden),
    [problem]
  );

  const saveDraft = async () => {
    if (!problem) return;
    setSavingDraft(true);
    try {
      const { data } = await api.put(`/coding/${problemId}/workspace`, {
        draftCode: code,
      });
      if (data.success) {
        setWorkspace(data.data.workspace);
        toast.success('Draft saved');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      const activeMonitoringSessionId = (
        sessionIdRef.current
        || sessionId
        || sessionState?.monitoringSessionId
      );
      const { data } = await api.post(`/coding/${problemId}/run`, {
        code,
        monitoringSessionId: activeMonitoringSessionId || undefined,
        sessionData: browserMetrics,
      });
      if (data.success) {
        setResult(data.data);
        toast.success(data.data.verdict || 'Sample run finished');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Run failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const activeMonitoringSessionId = (
        sessionIdRef.current
        || sessionId
        || sessionState?.monitoringSessionId
      );
      const { data } = await api.post(`/coding/${problemId}/submit`, {
        code,
        monitoringSessionId: activeMonitoringSessionId || undefined,
        sessionData: browserMetrics,
      });
      if (data.success) {
        setResult(data.data);
        toast.success(data.message || data.data.verdict || 'Submission complete');
        await loadProblem();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const openThread = async (threadId) => {
    try {
      const { data } = await api.get(`/coding/discussions/${threadId}`);
      if (data.success) {
        setSelectedThread(data.data.thread);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load thread.');
    }
  };

  const createThread = async () => {
    if (!threadForm.title.trim() || !threadForm.body.trim()) {
      toast.error('Add a title and your question first.');
      return;
    }

    setDiscussionSubmitting(true);
    try {
      const { data } = await api.post(`/coding/${problemId}/discussions`, {
        scope: discussionScope,
        title: threadForm.title,
        body: threadForm.body,
        tags: threadForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      if (data.success) {
        setThreadForm({ title: '', body: '', tags: '' });
        await loadDiscussions(discussionScope);
        setSelectedThread(data.data.thread);
        toast.success('Discussion posted');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to post discussion.');
    } finally {
      setDiscussionSubmitting(false);
    }
  };

  const replyToThread = async () => {
    if (!selectedThread || !replyBody.trim()) return;
    setDiscussionSubmitting(true);
    try {
      const { data } = await api.post(`/coding/discussions/${selectedThread._id}/replies`, {
        body: replyBody,
      });
      if (data.success) {
        setReplyBody('');
        setSelectedThread(data.data.thread);
        await loadDiscussions(discussionScope);
        toast.success('Reply added');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add reply.');
    } finally {
      setDiscussionSubmitting(false);
    }
  };

  const toggleResolveThread = async () => {
    if (!selectedThread) return;
    try {
      const { data } = await api.patch(`/coding/discussions/${selectedThread._id}/resolve`);
      if (data.success) {
        setSelectedThread(data.data.thread);
        await loadDiscussions(discussionScope);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update thread.');
    }
  };

  const monitoringWarningCount = Number(sessionState?.warningCount || 0);
  const monitoringWarningLimit = Number(sessionState?.warningLimit || 3);
  const latestMonitoringMessage = getLatestMonitoringWarningMessage(sessionState);
  const faceMissingNotice = faceMissingCountdown > 0
    ? `⚠️ Face missing! Return within ${faceMissingCountdown} seconds or test will be locked.`
    : '';
  const limitedCameraMonitoring = isMonitoring
    && monitoringMode !== 'browser-only'
    && (monitoringReadiness?.limitedDetection || !monitoringReadiness?.fullModelReady);
  const monitoringTone = sessionState?.isLocked || sessionState?.finalFlagged
    ? 'bad'
    : monitoringWarningCount > 0
    ? 'warn'
    : 'good';
  const monitoringFallbackText = sessionState?.finalFlagged
    ? 'Monitoring has flagged this coding session for review.'
    : monitoringMode === 'browser-only' && isMonitoring
    ? 'Browser-only malpractice monitoring is active.'
    : monitoringStage === 'warming_up'
    ? 'Camera monitoring is warming up.'
    : monitoringStage === 'checking_readiness'
      || monitoringStage === 'requesting_camera'
      || monitoringStage === 'awaiting_video'
      || monitoringStage === 'starting_session'
    ? 'Starting camera monitoring.'
    : monitoringStage === 'unavailable' || monitoringStage === 'error'
    ? 'Camera monitoring is unavailable.'
    : limitedCameraMonitoring
    ? 'Limited camera monitoring is active.'
    : isMonitoring
    ? 'Camera monitoring is active.'
    : 'Camera monitoring starts before coding begins.';
  const monitoringStatusText = sessionState?.isLocked
    ? `Coding locked due to: ${sessionState?.lockReason || 'repeated malpractice warnings'}. Unlocks in: ${formatDuration(sessionState?.lockedUntil)}`
    : latestMonitoringMessage
    ? `${latestMonitoringMessage}${faceMissingNotice ? ` ${faceMissingNotice}` : ''}`
    : faceMissingNotice || monitoringFallbackText;

  const monitoringBadge = (
    <span style={{ ...badgeStyle(monitoringTone), padding: '0.6rem 0.85rem', borderRadius: 999 }}>
      {monitoringStatusText} Warnings {monitoringWarningCount}/{monitoringWarningLimit}
    </span>
  );

  const monitoringUi = (stream || monitoringStage === 'requesting_camera' || monitoringStage === 'awaiting_video' || monitoringStage === 'starting_session' || monitoringStage === 'warming_up') ? (
    <CameraMonitoringLayer
      stream={stream}
      captureVideoRef={captureVideoRef}
      detections={visionState?.detections}
      frameSize={visionState?.frameSize}
      width={190}
      height={140}
    />
  ) : null;

  const monitoringModal = <MonitoringConsentModal {...consentModal} />;

  if (lockCheckLoading) {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ ...shellCard, padding: '1.5rem', color: '#cbd5e1' }}>
            Checking coding access...
          </div>
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  if (isLockedByMalpractice && lockInfo) {
    // Show lock overlay but allow navigation to other pages
    return (
      <StudentLayout>
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: '100vh',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.97) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
          }}>
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(248, 113, 113, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%)',
              border: '3px solid rgba(248, 113, 113, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '2rem',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              <span style={{ fontSize: '3rem' }}>🔒</span>
            </div>

            <h1 style={{
              color: '#f87171',
              fontSize: '2.5rem',
              marginBottom: '0.5rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}>
              Coding Locked
            </h1>

            <p style={{
              color: '#fbbf24',
              fontSize: '1.1rem',
              marginBottom: '2rem',
              maxWidth: '600px',
              lineHeight: 1.6,
              fontWeight: 500,
            }}>
              ⚠️ Violation detected: {lockInfo.lockReason || 'repeated malpractice warnings'}
            </p>

            <div style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
              border: '2px solid rgba(34, 197, 94, 0.4)',
              borderRadius: '1rem',
              padding: '1.5rem 2.5rem',
              marginBottom: '2rem',
              boxShadow: '0 8px 32px rgba(34, 197, 94, 0.2)',
            }}>
              <p style={{
                color: '#94a3b8',
                fontSize: '0.9rem',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 600,
              }}>
                Time Remaining
              </p>
              <div style={{
                color: '#22c55e',
                fontSize: '2.5rem',
                fontWeight: 800,
                letterSpacing: '0.02em',
                textShadow: '0 0 20px rgba(34, 197, 94, 0.5)',
              }}>
                {lockCountdown}
              </div>
            </div>

            <div style={{
              background: 'rgba(148, 163, 184, 0.1)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '0.75rem',
              padding: '1rem 1.5rem',
              marginBottom: '2rem',
              maxWidth: '500px',
            }}>
              <p style={{
                color: '#cbd5e1',
                fontSize: '0.95rem',
                lineHeight: 1.6,
                marginBottom: '0.5rem',
              }}>
                📌 You can navigate to other modules while waiting for the lock to expire.
              </p>
              {lockInfo.institutionId && (
                <p style={{
                  color: '#fbbf24',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}>
                  🏢 Your institution has been notified.
                </p>
              )}
            </div>

            <button
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: 'white',
                padding: '1rem 2.5rem',
                borderRadius: '0.75rem',
                fontSize: '1.1rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                marginBottom: '1.5rem',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
              }}
              onClick={() => navigate('/modules')}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 8px 30px rgba(59, 130, 246, 0.5)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.4)';
              }}
            >
              📚 Go to Modules
            </button>

            <p style={{
              color: '#64748b',
              fontSize: '0.85rem',
              marginTop: '1rem',
            }}>
              💡 Contact your instructor if this is an error
            </p>
          </div>
        </div>
      </StudentLayout>
    );
  }

  if (loading) {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem', color: '#94a3b8' }}>
          Loading coding workspace...
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  if (error || !problem) {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ ...shellCard, padding: '1.5rem', color: '#fca5a5' }}>
            <p style={{ marginTop: 0 }}>{error || 'Coding problem unavailable.'}</p>
            <button
              onClick={() => navigate('/coding')}
              style={{
                border: 'none',
                borderRadius: 14,
                padding: '0.9rem 1.1rem',
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Back to Coding Hub
            </button>
          </div>
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  // Intro screen - show problem info and start button
  if (screen === 'intro') {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ ...shellCard, padding: '2rem', display: 'grid', gap: '1.5rem' }}>
            <div>
              <button
                onClick={() => navigate('/coding')}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, marginBottom: '1rem', fontWeight: 700 }}
              >
                ← Back to Coding Hub
              </button>
              <h1 style={{ color: '#f8fafc', margin: 0, fontSize: '2rem' }}>{problem.title}</h1>
              <p style={{ color: '#94a3b8', margin: '0.55rem 0 0', fontSize: '0.95rem' }}>
                {problem.topicId?.title || 'Topic'} • {problem.moduleId?.title || 'Module'} • {problem.difficulty}
              </p>
            </div>

            <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
              <h2 style={{ color: '#f8fafc', marginTop: 0, marginBottom: '1rem' }}>Problem Statement</h2>
              <p style={{ color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {problem.problemStatement || problem.description}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Language</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>Java</div>
              </div>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time Limit</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>{problem.timeLimit}s</div>
              </div>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Points</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>{problem.points || 0}</div>
              </div>
              {workspace?.solved && (
                <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
                  <div style={{ color: '#22c55e', fontWeight: 800, marginTop: '0.35rem' }}>Solved</div>
                </div>
              )}
            </div>

            <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <h3 style={{ color: '#93c5fd', marginTop: 0, marginBottom: '0.5rem' }}>📹 Camera Monitoring Required</h3>
              <p style={{ color: '#cbd5e1', margin: 0, fontSize: '0.95rem' }}>
                This coding session requires camera monitoring to ensure integrity. Please keep your face visible and stay on this tab while coding.
              </p>
            </div>

            <button
              onClick={startMonitoringAndShowEditor}
              disabled={monitoringStarting}
              style={{
                background: monitoringStarting
                  ? 'rgba(59,130,246,0.5)'
                  : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: 'white',
                padding: '1rem 2.5rem',
                borderRadius: '0.75rem',
                fontSize: '1.1rem',
                fontWeight: 600,
                cursor: monitoringStarting ? 'not-allowed' : 'pointer',
                border: 'none',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
                opacity: monitoringStarting ? 0.7 : 1,
              }}
              onMouseOver={(e) => {
                if (!monitoringStarting) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 8px 30px rgba(59, 130, 246, 0.5)';
                }
              }}
              onMouseOut={(e) => {
                if (!monitoringStarting) {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.4)';
                }
              }}
            >
              {monitoringStarting ? 'Starting Camera...' : '🚀 Start Coding'}
            </button>
          </div>
        </div>
        {monitoringModal}
        {monitoringUi}
      </StudentLayout>
    );
  }

  if (isLockedByMalpractice && lockInfo) {
    // Show lock overlay but allow navigation to other pages
    return (
      <StudentLayout>
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: '100vh',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.97) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
          }}>
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(248, 113, 113, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%)',
              border: '3px solid rgba(248, 113, 113, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '2rem',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              <span style={{ fontSize: '3rem' }}>🔒</span>
            </div>
            
            <h1 style={{ 
              color: '#f87171', 
              fontSize: '2.5rem', 
              marginBottom: '0.5rem', 
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}>
              Coding Locked
            </h1>
            
            <p style={{ 
              color: '#fbbf24', 
              fontSize: '1.1rem', 
              marginBottom: '2rem', 
              maxWidth: '600px', 
              lineHeight: 1.6,
              fontWeight: 500,
            }}>
              ⚠️ Violation detected: {lockInfo.lockReason || 'repeated malpractice warnings'}
            </p>
            
            <div style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
              border: '2px solid rgba(34, 197, 94, 0.4)',
              borderRadius: '1rem',
              padding: '1.5rem 2.5rem',
              marginBottom: '2rem',
              boxShadow: '0 8px 32px rgba(34, 197, 94, 0.2)',
            }}>
              <p style={{ 
                color: '#94a3b8', 
                fontSize: '0.9rem', 
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 600,
              }}>
                Time Remaining
              </p>
              <div style={{
                color: '#22c55e',
                fontSize: '2.5rem',
                fontWeight: 800,
                letterSpacing: '0.02em',
                textShadow: '0 0 20px rgba(34, 197, 94, 0.5)',
              }}>
                {lockCountdown}
              </div>
            </div>
            
            <div style={{
              background: 'rgba(148, 163, 184, 0.1)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '0.75rem',
              padding: '1rem 1.5rem',
              marginBottom: '2rem',
              maxWidth: '500px',
            }}>
              <p style={{ 
                color: '#cbd5e1', 
                fontSize: '0.95rem', 
                lineHeight: 1.6,
                marginBottom: '0.5rem',
              }}>
                📌 You can navigate to other modules while waiting for the lock to expire.
              </p>
              {lockInfo.institutionId && (
                <p style={{ 
                  color: '#fbbf24', 
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}>
                  🏢 Your institution has been notified.
                </p>
              )}
            </div>
            
            <button
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: 'white',
                padding: '1rem 2.5rem',
                borderRadius: '0.75rem',
                fontSize: '1.1rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                marginBottom: '1.5rem',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
              }}
              onClick={() => navigate('/modules')}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 8px 30px rgba(59, 130, 246, 0.5)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.4)';
              }}
            >
              📚 Go to Modules
            </button>
            
            <p style={{ 
              color: '#64748b', 
              fontSize: '0.85rem',
              marginTop: '1rem',
            }}>
              💡 Contact your instructor if this is an error
            </p>
          </div>
        </div>
      </StudentLayout>
    );
  }

  if (loading) {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem', color: '#94a3b8' }}>
          Loading coding workspace...
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  if (error || !problem) {
    return (
      <StudentLayout>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ ...shellCard, padding: '1.5rem', color: '#fca5a5' }}>
            <p style={{ marginTop: 0 }}>{error || 'Coding problem unavailable.'}</p>
            <button
              onClick={() => navigate('/coding')}
              style={{
                border: 'none',
                borderRadius: 14,
                padding: '0.9rem 1.1rem',
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Back to Coding Hub
            </button>
          </div>
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  // Editor screen - show the actual coding interface
  if (screen === 'editor') {
    const statement = problem.problemStatement || problem.description;

    return (
      <StudentLayout>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1rem' }}>
          <header style={{ ...shellCard, padding: '1.25rem 1.35rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'start' }}>
              <div>
                <button
                  onClick={() => navigate('/coding')}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, marginBottom: '0.6rem', fontWeight: 700 }}
                >
                  Back to Coding Hub
                </button>
                <h1 style={{ color: '#f8fafc', margin: 0, fontSize: '2rem' }}>{problem.title}</h1>
                <p style={{ color: '#94a3b8', margin: '0.55rem 0 0', fontSize: '0.95rem' }}>
                  {problem.topicId?.title || 'Topic'} • {problem.moduleId?.title || 'Module'} • {problem.difficulty}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                <span style={{ ...badgeStyle('info'), padding: '0.6rem 0.85rem', borderRadius: 999 }}>{problem.timeLimit}s limit</span>
                <span style={{ ...badgeStyle('info'), padding: '0.6rem 0.85rem', borderRadius: 999 }}>{problem.points || 0} points</span>
                {workspace?.solved && <span style={{ ...badgeStyle('good'), padding: '0.6rem 0.85rem', borderRadius: 999 }}>Solved</span>}
                {monitoringBadge}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Language</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>Java</div>
              </div>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Samples</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>{visibleTests.length}</div>
              </div>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Runs</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>{submissions.length}</div>
              </div>
              <div style={{ padding: '0.95rem', borderRadius: 18, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Workspace</div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, marginTop: '0.35rem' }}>{workspace?.acceptedAt ? 'Accepted' : 'In Progress'}</div>
              </div>
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 0.94fr) minmax(460px, 1.06fr)', gap: '1rem', alignItems: 'start' }}>
            <section style={{ ...shellCard, padding: '1rem', display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                {[
                  ['description', 'Description'],
                  ['samples', 'Samples'],
                  ['hints', 'Hints'],
                  ['submissions', 'Submissions'],
                  ['discussion', 'Discussion'],
                ].map(([key, label]) => (
                  <button key={key} onClick={() => setActiveTab(key)} style={tabButtonStyle(activeTab === key)}>
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'description' && (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div>
                    <h2 style={{ color: '#f8fafc', marginTop: 0 }}>Problem Statement</h2>
                    <p style={{ color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 0 }}>{statement}</p>
                  </div>
                  {problem.constraints && (
                    <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                      <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Constraints</h3>
                      <pre style={{ margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{problem.constraints}</pre>
                    </div>
                  )}
                  {(problem.inputFormat || problem.outputFormat) && (
                    <div style={{ display: 'grid', gap: '0.8rem' }}>
                      {problem.inputFormat && (
                        <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                          <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Input Format</h3>
                          <pre style={{ margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{problem.inputFormat}</pre>
                        </div>
                      )}
                      {problem.outputFormat && (
                        <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                          <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Output Format</h3>
                          <pre style={{ margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{problem.outputFormat}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'samples' && (
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  {visibleTests.length === 0 ? (
                    <p style={{ color: '#94a3b8', margin: 0 }}>No visible sample tests available.</p>
                  ) : visibleTests.map((testCase, index) => (
                    <div key={`${index}-${testCase.input}`} style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: '0.65rem' }}>Sample Case {index + 1}</div>
                    <pre style={{ margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>
{`Input:
${testCase.input || '(empty)'}

Expected Output:
${testCase.expectedOutput || '(empty)'}`}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'hints' && (
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {(problem.hints || []).length === 0 ? (
                  <p style={{ color: '#94a3b8', margin: 0 }}>No hints are attached to this problem yet.</p>
                ) : problem.hints.map((hint, index) => (
                  <div key={hint} style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: '0.5rem' }}>Hint {index + 1}</div>
                    <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.65 }}>{hint}</p>
                  </div>
                ))}
                {(problem.solutionApproach || problem.timeComplexity || problem.spaceComplexity) && (
                  <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: '0.55rem' }}>Approach Notes</div>
                    {problem.solutionApproach && <p style={{ margin: '0 0 0.6rem', color: '#cbd5e1', lineHeight: 1.65 }}>{problem.solutionApproach}</p>}
                    {problem.timeComplexity && <p style={{ margin: '0 0 0.35rem', color: '#cbd5e1' }}>Time: {problem.timeComplexity}</p>}
                    {problem.spaceComplexity && <p style={{ margin: 0, color: '#cbd5e1' }}>Space: {problem.spaceComplexity}</p>}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'submissions' && (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {submissions.length === 0 ? (
                  <p style={{ color: '#94a3b8', margin: 0 }}>No submissions yet.</p>
                ) : submissions.map((submission) => (
                  <div key={submission._id} style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' }}>
                      <span style={{ ...badgeStyle(verdictTone(submission.verdict)), borderRadius: 999, padding: '0.35rem 0.7rem', fontWeight: 800 }}>
                        {submission.verdict}
                      </span>
                      <span style={{ color: '#94a3b8' }}>{new Date(submission.createdAt).toLocaleString()}</span>
                    </div>
                    <p style={{ color: '#cbd5e1', margin: '0.75rem 0 0' }}>
                      {submission.mode === 'submit' ? 'Hidden tests' : 'Visible tests'}: {submission.passedVisibleCount}/{submission.totalVisibleCount}
                      {submission.mode === 'submit' ? ` • Hidden ${submission.passedHiddenCount}/${submission.totalHiddenCount}` : ''}
                      {' '}• {submission.executionTimeMs || 0} ms
                    </p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'discussion' && (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button onClick={() => setDiscussionScope('public')} style={tabButtonStyle(discussionScope === 'public')}>Public Discussion</button>
                  {canUseInstitutionScope && (
                    <button onClick={() => setDiscussionScope('institution')} style={tabButtonStyle(discussionScope === 'institution')}>Institution Circle</button>
                  )}
                </div>

                <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)', display: 'grid', gap: '0.75rem' }}>
                  <div style={{ color: '#f8fafc', fontWeight: 800 }}>Ask a Question</div>
                  <input
                    value={threadForm.title}
                    onChange={(event) => setThreadForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Short thread title"
                    style={{ borderRadius: 14, border: '1px solid rgba(71,85,105,0.95)', background: '#020617', color: '#e2e8f0', padding: '0.85rem 0.95rem', outline: 'none' }}
                  />
                  <textarea
                    value={threadForm.body}
                    onChange={(event) => setThreadForm((prev) => ({ ...prev, body: event.target.value }))}
                    placeholder={discussionScope === 'institution' ? 'Only learners from your institution can see this thread.' : 'Describe the bug, idea, or doubt clearly.'}
                    style={{ minHeight: 110, resize: 'vertical', borderRadius: 14, border: '1px solid rgba(71,85,105,0.95)', background: '#020617', color: '#e2e8f0', padding: '0.85rem 0.95rem', outline: 'none' }}
                  />
                  <input
                    value={threadForm.tags}
                    onChange={(event) => setThreadForm((prev) => ({ ...prev, tags: event.target.value }))}
                    placeholder="Tags, comma separated"
                    style={{ borderRadius: 14, border: '1px solid rgba(71,85,105,0.95)', background: '#020617', color: '#e2e8f0', padding: '0.85rem 0.95rem', outline: 'none' }}
                  />
                  <button
                    onClick={createThread}
                    disabled={discussionSubmitting}
                    style={{ border: 'none', borderRadius: 14, padding: '0.85rem 1rem', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                  >
                    {discussionSubmitting ? 'Posting...' : 'Post Discussion'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.82fr) minmax(0, 1.18fr)', gap: '1rem' }}>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {discussionLoading ? (
                      <div style={{ color: '#94a3b8' }}>Loading discussions...</div>
                    ) : discussionThreads.length === 0 ? (
                      <div style={{ color: '#94a3b8' }}>No threads yet in this space.</div>
                    ) : discussionThreads.map((thread) => (
                      <button
                        key={thread._id}
                        onClick={() => openThread(thread._id)}
                        style={{
                          textAlign: 'left',
                          borderRadius: 16,
                          border: selectedThread?._id === thread._id ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(51,65,85,0.9)',
                          background: selectedThread?._id === thread._id ? 'rgba(30,64,175,0.16)' : 'rgba(15,23,42,0.78)',
                          color: '#e2e8f0',
                          padding: '0.95rem',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'start' }}>
                          <strong style={{ color: '#f8fafc' }}>{thread.title}</strong>
                          {thread.resolved && <span style={{ ...badgeStyle('good'), borderRadius: 999, padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}>Resolved</span>}
                        </div>
                        <p style={{ color: '#94a3b8', margin: '0.45rem 0 0', lineHeight: 1.5 }}>
                          {thread.body.slice(0, 120)}{thread.body.length > 120 ? '...' : ''}
                        </p>
                        <div style={{ color: '#64748b', marginTop: '0.55rem', fontSize: '0.82rem' }}>
                          {thread.author?.name} • {thread.replyCount} replies
                        </div>
                      </button>
                    ))}
                  </div>

                  <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(51,65,85,0.9)', minHeight: 260 }}>
                    {!selectedThread ? (
                      <div style={{ color: '#94a3b8' }}>Select a thread to read the discussion.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: '0.9rem' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <h3 style={{ color: '#f8fafc', margin: 0 }}>{selectedThread.title}</h3>
                            {String(selectedThread.author?._id) === String(user?._id) && (
                              <button onClick={toggleResolveThread} style={{ ...tabButtonStyle(false), color: '#e2e8f0' }}>
                                {selectedThread.resolved ? 'Mark Open' : 'Mark Resolved'}
                              </button>
                            )}
                          </div>
                          <p style={{ color: '#cbd5e1', lineHeight: 1.65 }}>{selectedThread.body}</p>
                          <p style={{ color: '#64748b', margin: 0 }}>{selectedThread.author?.name}</p>
                        </div>

                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                          {(selectedThread.replies || []).map((reply) => (
                            <div key={reply._id} style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(2,6,23,0.65)', border: '1px solid rgba(51,65,85,0.85)' }}>
                              <div style={{ color: '#f8fafc', fontWeight: 700 }}>{reply.author?.name}</div>
                              <p style={{ color: '#cbd5e1', margin: '0.45rem 0 0', lineHeight: 1.6 }}>{reply.body}</p>
                            </div>
                          ))}
                        </div>

                        <textarea
                          value={replyBody}
                          onChange={(event) => setReplyBody(event.target.value)}
                          placeholder="Share your suggestion or explanation"
                          style={{ minHeight: 90, resize: 'vertical', borderRadius: 14, border: '1px solid rgba(71,85,105,0.95)', background: '#020617', color: '#e2e8f0', padding: '0.85rem 0.95rem', outline: 'none' }}
                        />
                        <button
                          onClick={replyToThread}
                          disabled={discussionSubmitting || !replyBody.trim()}
                          style={{ border: 'none', borderRadius: 14, padding: '0.85rem 1rem', background: 'linear-gradient(135deg, #0f766e, #0d9488)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                        >
                          {discussionSubmitting ? 'Replying...' : 'Post Reply'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section style={{ display: 'grid', gap: '1rem', position: 'sticky', top: 16 }}>
            <div style={{ ...shellCard, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.85rem' }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Editor</div>
                  <h2 style={{ color: '#f8fafc', margin: '0.2rem 0 0' }}>Java Workspace</h2>
                </div>
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button onClick={saveDraft} disabled={savingDraft} style={{ ...tabButtonStyle(false), color: '#e2e8f0' }}>
                    {savingDraft ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button onClick={handleRun} disabled={running} style={{ border: 'none', borderRadius: 14, padding: '0.8rem 1rem', background: 'linear-gradient(135deg, #0f766e, #0d9488)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                    {running ? 'Running...' : 'Run'}
                  </button>
                  <button onClick={handleSubmit} disabled={submitting} style={{ border: 'none', borderRadius: 14, padding: '0.8rem 1rem', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                    {submitting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </div>

              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                disabled={false}
                style={{
                  width: '100%',
                  minHeight: 470,
                  resize: 'vertical',
                  borderRadius: 18,
                  border: '1px solid rgba(51,65,85,0.95)',
                  background: '#020617',
                  color: '#e2e8f0',
                  padding: '1rem',
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: '0.92rem',
                  lineHeight: 1.6,
                  outline: 'none',
                  opacity: 1,
                }}
              />
            </div>

            <div style={{ ...shellCard, padding: '1rem', display: 'grid', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <h2 style={{ color: '#f8fafc', margin: 0 }}>Verdict</h2>
                {result?.verdict && (
                  <span style={{ ...badgeStyle(verdictTone(result.verdict)), borderRadius: 999, padding: '0.4rem 0.7rem', fontWeight: 800 }}>
                    {result.verdict}
                  </span>
                )}
              </div>

              {!result ? (
                <p style={{ color: '#94a3b8', margin: 0 }}>
                  Run the visible sample cases first, then submit against the hidden test suite.
                </p>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.8rem' }}>
                    <div style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                      <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>Execution</div>
                      <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: '0.35rem' }}>{result.executionTimeMs || 0} ms</div>
                    </div>
                    <div style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                      <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>Visible</div>
                      <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: '0.35rem' }}>{result.passedVisibleCount || 0}/{result.totalVisibleCount || 0}</div>
                    </div>
                    <div style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                      <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>Hidden</div>
                      <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: '0.35rem' }}>{result.passedHiddenCount || 0}/{result.totalHiddenCount || 0}</div>
                    </div>
                  </div>

                  {result.compileOutput && (
                    <div style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: '0.45rem' }}>Compiler Output</div>
                      <pre style={{ margin: 0, color: '#fecaca', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{result.compileOutput}</pre>
                    </div>
                  )}

                  {result.runtimeOutput && (
                    <div style={{ padding: '0.9rem', borderRadius: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.9)' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: '0.45rem' }}>Runtime Output</div>
                      <pre style={{ margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{result.runtimeOutput}</pre>
                    </div>
                  )}

                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {(result.testResults || []).map((testCase, index) => (
                      <div key={`${index}-${testCase.runtimeMs || index}`} style={{ padding: '0.9rem', borderRadius: 16, background: testCase.passed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${testCase.passed ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <strong style={{ color: '#f8fafc' }}>Case {index + 1} {testCase.isHidden ? '(Hidden)' : '(Visible)'}</strong>
                          <span style={{ color: testCase.passed ? '#86efac' : '#fca5a5', fontWeight: 800 }}>{testCase.passed ? 'Passed' : 'Failed'}</span>
                        </div>
                        {!testCase.isHidden && (
                          <pre style={{ margin: '0.65rem 0 0', color: '#cbd5e1', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>
{`Input: ${testCase.input || '(empty)'}
Expected: ${testCase.expectedOutput || '(empty)'}
Actual: ${testCase.actualOutput || '(empty)'}`}
                          </pre>
                        )}
                        {testCase.error && <pre style={{ margin: '0.65rem 0 0', color: '#fecaca', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace' }}>{testCase.error}</pre>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
        {monitoringUi}
        {monitoringModal}
      </div>
    </StudentLayout>
    );
  }

  return null;
}



