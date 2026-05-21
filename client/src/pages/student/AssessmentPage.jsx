// client/src/pages/student/AssessmentPage.jsx
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import StudentLayout from '../../components/layout/StudentLayout';
import api from '../../services/api';
import { getHint } from '../../services/geminiService';
import { useAuth } from '../../context/AuthContext';
import usePracticeMonitoring from '../../hooks/usePracticeMonitoring';
import { LockScreen } from '../../components/malpractice/MalpracticeMonitor';
import MonitoringConsentModal from '../../components/common/MonitoringConsentModal';
import CameraMonitoringLayer from '../../components/common/CameraMonitoringLayer';
import {
  Clock, Check, X, Lightbulb, AlertTriangle,
  ChevronRight, RotateCcw, Trophy, Target
} from 'lucide-react';
import toast from 'react-hot-toast';
import styles from './AssessmentPage.module.css';

/* ================================================================
   Round configuration
   ================================================================ */
const ROUND_CONFIG = {
  Basic: {
    label: 'MCQ Round',
    color: '#22c55e',
    bgClass: styles.roundBasic,
    passRatio: 0.8,
    timePerQ: 60,
  },
  Medium: {
    label: 'Round 2: Medium',
    color: '#f59e0b',
    bgClass: styles.roundMedium,
    passRatio: 0.8,
    timePerQ: 90,
  },
  Hard: {
    label: 'Round 3: Hard',
    color: '#ef4444',
    bgClass: styles.roundHard,
    passRatio: 0.6,
    timePerQ: 120,
  },
};

const getRequiredCorrectAnswers = (round, totalQuestions) => {
  const ratio = ROUND_CONFIG[round]?.passRatio || 0;
  return Math.ceil(Math.max(Number(totalQuestions) || 0, 0) * ratio);
};

const formatSignal = (signal = '') =>
  String(signal || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());

/* ================================================================
   Timer Display Component (Memoized for performance)
   ================================================================ */
const TimerDisplay = memo(({ timeLeft, totalTime }) => {
  const percent = (timeLeft / totalTime) * 100;
  const color = percent > 60 ? '#6366f1' : percent > 30 ? '#f59e0b' : '#ef4444';
  
  return (
    <>
      <div className={styles.timerWrapper}>
        <Clock size={16} className={styles.timerIcon} style={{ color }} />
        <span className={styles.timerText} style={{ color }}>
          {Math.ceil(timeLeft)}s
        </span>
      </div>
      <div className={styles.timerBar}>
        <div
          className={styles.timerBarFill}
          style={{
            width: `${percent}%`,
            backgroundColor: color,
            transition: 'width 1s linear, background-color 0.3s ease',
          }}
        />
      </div>
    </>
  );
});

TimerDisplay.displayName = 'TimerDisplay';

/* ================================================================
   Progress Dots Component (Memoized)
   ================================================================ */
const ProgressDots = memo(({ total, current }) => (
  <div className={styles.progressDots}>
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={`${styles.dot} ${
          i < current
            ? styles.dotDone
            : i === current
            ? styles.dotCurrent
            : ''
        } ${i < current ? styles.dotPopIn : ''}`}
        style={{
          animationDelay: `${i * 0.1}s`,
        }}
      />
    ))}
  </div>
));

ProgressDots.displayName = 'ProgressDots';

/* ================================================================
   Main Component
   ================================================================ */
export default function AssessmentPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ─── Screen state ──────────────────────────────────────────
  const [screen, setScreen] = useState('loading');
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [currentExplanation, setCurrentExplanation] = useState('');
  const [currentCorrectAnswer, setCurrentCorrectAnswer] = useState(null);
  const [isCorrect, setIsCorrect] = useState(false);
  const [results, setResults] = useState(null);
  const [moduleId, setModuleId] = useState(null);
  const [topicName, setTopicName] = useState('');
  const [hintText, setHintText] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideDirection, setSlideDirection] = useState('right');
  const [lockCheckLoading, setLockCheckLoading] = useState(true);
  const [isLockedByMalpractice, setIsLockedByMalpractice] = useState(false);
  const [lockInfo, setLockInfo] = useState(null);

  // ─── Anti‑malpractice session data ─────────────────────────
  // ─── All answers collected ─────────────────────────────────
  const answersRef = useRef([]);
  const timerRef = useRef(null);
  const questionCardRef = useRef(null);
  const isSubmittingAnswerRef = useRef(false);
  
  // Single-round assessment flow: always use Basic MCQs.
  const resolvedRound = 'Basic';
  const config = ROUND_CONFIG[resolvedRound];
  const totalQuestions = questions.length;
  const requiredCorrectAnswers = getRequiredCorrectAnswers(resolvedRound, totalQuestions);

  const handleMonitoringStatusChange = useCallback((nextState) => {
    const topAlert = Array.isArray(nextState?.alerts) ? nextState.alerts[0] : null;
    const alertMessage = topAlert?.message || 'Monitoring warning';

    if (nextState.finalFlagged) {
      toast.error(`${alertMessage}. Warning ${nextState.warningCount}/${nextState.warningLimit}.`);
      return;
    }

    if ((nextState.warningCount || 0) > 0) {
      toast(`${alertMessage}. Warning ${nextState.warningCount}/${nextState.warningLimit}`, {
        icon: '!',
      });
    }
  }, []);


  const {
    browserMetrics,
    captureVideoRef,
    consentModal,
    finishMonitoring,
    isMobile,
    isMonitoring,
    sessionId,
    sessionState,
    startMonitoring,
    stream,
    trackBrowserEvent,
    visionState,
  } = usePracticeMonitoring({
    sessionType: 'assessment',
    topicId,
    moduleId,
    institutionLinked: !!user?.institutionId,
    sessionLabel: 'MCQ practice session',
    onStatusChange: handleMonitoringStatusChange,
  });

  // ─── Anti‑malpractice listeners ────────────────────────────
  useEffect(() => {
    let copyThrottleTimer;
    
    const onVisibility = () => {
      if (document.hidden && screen === 'question') {
        trackBrowserEvent('tabSwitches');
        toast('Do not switch tabs during the MCQ test. Warnings are being tracked.', {
          icon: '⚠️',
        });
      }
    };
    
    const onCopy = () => {
      if (screen === 'question' && !copyThrottleTimer) {
        trackBrowserEvent('copyAttempts');
        copyThrottleTimer = setTimeout(() => {
          copyThrottleTimer = null;
        }, 1000);
      }
    };
    
    const onBlur = () => {
      if (screen === 'question') {
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
      if (copyThrottleTimer) clearTimeout(copyThrottleTimer);
    };
  }, [screen, trackBrowserEvent]);

  useEffect(() => {
    let isMounted = true;

    const checkLock = async () => {
      try {
        const response = await api.get('/malpractice/check-lock?sessionType=assessment');
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

    checkLock();

    return () => {
      isMounted = false;
    };
  }, []);

  // ─── Fetch questions on mount ──────────────────────────────
  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const [mcqRes, topicRes] = await Promise.all([
          api.get(`/mcq/topic/${topicId}/${resolvedRound}`),
          api.get(`/topics/${topicId}`),
        ]);
        if (mcqRes.data.success) {
          setQuestions(mcqRes.data.data.questions || []);
        }
        if (topicRes.data.success) {
          setModuleId(topicRes.data.data.topic.moduleId?._id || topicRes.data.data.topic.moduleId);
          setTopicName(topicRes.data.data.topic.title || '');
        }
        setScreen('intro');
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Failed to load assessment questions');
        navigate(-1);
      }
    };
    fetchQuestions();
  }, [topicId, resolvedRound, navigate]);

  useEffect(() => () => {
    if (sessionId) {
      finishMonitoring(
        {
          topicId,
          moduleId,
        },
        { keepalive: true }
      );
    }
  }, [finishMonitoring, moduleId, sessionId, topicId]);

  // ─── Timer logic ───────────────────────────────────────────
  useEffect(() => {
    if (screen === 'question' && timeLeft > 0 && !submitted) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            // Use requestAnimationFrame to ensure state consistency
            requestAnimationFrame(() => {
              handleSubmit(-1);
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }
  }, [screen, timeLeft, submitted]);

  // ─── Start the question round ──────────────────────────────
  const startRound = async () => {
    if (!moduleId) {
      toast.error('Assessment setup is still loading. Please try again in a moment.');
      return;
    }

    const monitoringApproved = await startMonitoring();
    if (!monitoringApproved) {
      return;
    }

    setCurrentIndex(0);
    setTimeLeft(config.timePerQ);
    setSelectedOption(null);
    setSubmitted(false);
    setShowExplanation(false);
    setCurrentExplanation('');
    setCurrentCorrectAnswer(null);
    setHintText(null);
    setIsCorrect(false);
    isSubmittingAnswerRef.current = false;
    answersRef.current = [];
    setScreen('question');
  };

  // ─── Handle answer submission ──────────────────────────────
  const handleSubmit = useCallback(
    async (optionIndex) => {
      if (submitted || isSubmittingAnswerRef.current) return;
      isSubmittingAnswerRef.current = true;

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      const actualSelection = optionIndex === -1 ? null : optionIndex;
      setSelectedOption(actualSelection);
      setSubmitted(true);

      const currentQ = questions[currentIndex];
      if (!currentQ) {
        isSubmittingAnswerRef.current = false;
        return;
      }

      // Fetch correct answer to determine isCorrect
      let correctAnswerValue = null;
      try {
        const { data } = await api.get(`/mcq/${currentQ._id}`);
        if (data.success) {
          correctAnswerValue = data.data.mcq.correctAnswer;
          setCurrentCorrectAnswer(correctAnswerValue);
          setCurrentExplanation(data.data.mcq.explanation || '');
          setShowExplanation(true);

          // Determine correctness using originalOrder mapping
          const mapping = currentQ.originalOrder;
          const realSelection = actualSelection !== null ? mapping[actualSelection] : -1;
          const isAnswerCorrect = realSelection === correctAnswerValue;
          setIsCorrect(isAnswerCorrect);
          
          // Play sound effect based on correctness
          if (isAnswerCorrect) {
            playCorrectSound();
          } else {
            playIncorrectSound();
          }
        }
      } catch {
        setCurrentExplanation('Unable to verify answer.');
        setShowExplanation(true);
        setIsCorrect(false);
      }

      // Record answer
      answersRef.current.push({
        mcqId: currentQ._id,
        selectedAnswer: actualSelection !== null ? currentQ.originalOrder[actualSelection] : -1,
        timeTaken: config.timePerQ - timeLeft,
        hintsUsed: hintText ? 1 : 0,
      });
      isSubmittingAnswerRef.current = false;
    },
    [submitted, questions, currentIndex, timeLeft, config.timePerQ, hintText]
  );

  // ─── Sound effects (using Web Audio API for better compatibility) ───
  const playCorrectSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
      oscillator.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2); // G5
      
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      // Silently fail if audio is not supported
    }
  }, []);

  const playIncorrectSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
      oscillator.frequency.setValueAtTime(250, audioCtx.currentTime + 0.15);
      
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      // Silently fail if audio is not supported
    }
  }, []);

  // ─── Get AI hint ───────────────────────────────────────────
  const handleGetHint = async () => {
    if (hintLoading || hintText) return;
    setHintLoading(true);
    try {
      const currentQ = questions[currentIndex];
      const hint = await getHint(
        currentQ?.question || '',
        topicName,
        attemptNumber
      );
      if (hint) setHintText(hint);
      else setHintText('Try to recall the concept — you got this!');
    } catch {
      setHintText('Hint unavailable. Review the topic material.');
    } finally {
      setHintLoading(false);
    }
  };

  // ─── Move to next question with animation ─────────────────
  const goToNext = () => {
    if (currentIndex < questions.length - 1) {
      setIsTransitioning(true);
      setSlideDirection('left');
      
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        setTimeLeft(config.timePerQ);
        setSelectedOption(null);
        setSubmitted(false);
        setShowExplanation(false);
        setCurrentExplanation('');
        setCurrentCorrectAnswer(null);
        setHintText(null);
        setIsCorrect(false);
        isSubmittingAnswerRef.current = false;
        setIsTransitioning(false);
        setSlideDirection('right');
        
        // Trigger card entrance animation
        if (questionCardRef.current) {
          questionCardRef.current.classList.remove(styles.cardEnter);
          void questionCardRef.current.offsetWidth; // Force reflow
          questionCardRef.current.classList.add(styles.cardEnter);
        }
      }, 300);
    } else {
      submitAssessment();
    }
  };

  // ─── Submit full assessment ────────────────────────────────
  const submitAssessment = async () => {
    setScreen('loading');
    try {
      if (sessionId) {
        await finishMonitoring(
          {
            topicId,
            moduleId,
          },
          { keepalive: false }
        ).catch(() => null);
      }

      const { data } = await api.post('/assessment/submit', {
        topicId,
        moduleId,
        round: resolvedRound,
        submissions: answersRef.current,
        sessionData: browserMetrics,
        monitoringSessionId: sessionId || undefined,
      });
      if (data.success) {
        setResults(data.data);
        // Add a small delay for smooth transition
        setTimeout(() => {
          setScreen('result');
        }, 500);
      } else {
        throw new Error(data.message || 'Submission failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit assessment');
      setScreen('question');
    }
  };

  // ─── Loading state ─────────────────────────────────────────
  const activeMonitoringAlert = Array.isArray(visionState?.alerts) ? visionState.alerts[0] : null;
  const monitoringRiskLevel = sessionState?.riskLevel || visionState?.riskLevel || 'NONE';
  const monitoringWarningCount = Number(sessionState?.warningCount || 0);
  const monitoringWarningLimit = Number(sessionState?.warningLimit || (user?.institutionId ? 2 : 3));
  const monitoringSignals = Array.isArray(sessionState?.signals) ? sessionState.signals : [];
  const monitoringStatusClass =
    sessionState?.finalFlagged || monitoringRiskLevel === 'HIGH'
      ? styles.monitoringDanger
      : monitoringWarningCount > 0 || monitoringRiskLevel === 'MEDIUM'
      ? styles.monitoringWarn
      : styles.monitoringSafe;
  const monitoringStatusLabel = sessionState?.finalFlagged
    ? 'Flagged for review'
    : isMonitoring
    ? 'Live monitoring active'
    : 'Monitoring starts with the round';

  const monitoringUi = isMonitoring ? (
    <CameraMonitoringLayer
      stream={stream}
      captureVideoRef={captureVideoRef}
      hidden={isMobile}
      width={190}
      height={140}
    />
  ) : null;

  const monitoringModal = <MonitoringConsentModal {...consentModal} />;

  const monitoringBadge = (
    <div className={`${styles.monitoringPanel} ${monitoringStatusClass}`}>
      <div className={styles.monitoringPanelHeader}>
        <div>
          <p className={styles.monitoringEyebrow}>Assessment integrity</p>
          <h3 className={styles.monitoringTitle}>{monitoringStatusLabel}</h3>
        </div>
        <span className={styles.monitoringRiskPill}>{monitoringRiskLevel}</span>
      </div>
      <div className={styles.monitoringStats}>
        <div className={styles.monitoringStat}>
          <span className={styles.monitoringStatLabel}>Warnings</span>
          <strong className={styles.monitoringStatValue}>
            {monitoringWarningCount}/{monitoringWarningLimit}
          </strong>
        </div>
        <div className={styles.monitoringStat}>
          <span className={styles.monitoringStatLabel}>Evidence</span>
          <strong className={styles.monitoringStatValue}>
            {Number(visionState?.evidenceCount || 0)}
          </strong>
        </div>
        <div className={styles.monitoringStat}>
          <span className={styles.monitoringStatLabel}>Last scan</span>
          <strong className={styles.monitoringStatValue}>
            {visionState?.updatedAt ? 'Just now' : 'Pending'}
          </strong>
        </div>
      </div>
      {monitoringSignals.length > 0 ? (
        <div className={styles.monitoringSignalRow}>
          {monitoringSignals.slice(0, 3).map((signal) => (
            <span key={signal} className={styles.monitoringSignalChip}>
              {formatSignal(signal)}
            </span>
          ))}
        </div>
      ) : (
        <p className={styles.monitoringHint}>
          Keep your face visible and stay on this tab until the round is complete.
        </p>
      )}
    </div>
  );

  const monitoringLiveAlert = activeMonitoringAlert || monitoringWarningCount > 0 || sessionState?.finalFlagged ? (
    <div className={`${styles.monitoringAlert} ${monitoringStatusClass}`}>
      <div className={styles.monitoringAlertHeader}>
        <AlertTriangle size={16} />
        <span>
          {activeMonitoringAlert?.message
            || (sessionState?.finalFlagged
              ? 'This assessment has been flagged for review.'
              : `Warnings recorded: ${monitoringWarningCount}/${monitoringWarningLimit}`)}
        </span>
      </div>
      <p className={styles.monitoringAlertMeta}>
        Confidence: {Math.round(Number(visionState?.confidence || activeMonitoringAlert?.confidence || 0) * 100)}%
        {' '}| Risk level: {monitoringRiskLevel}
      </p>
    </div>
  ) : null;

  if (lockCheckLoading) {
    return (
      <StudentLayout>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}>
            <div className={styles.spinnerRing} />
          </div>
          <p className={styles.loadingText}>Checking assessment access...</p>
          <div className={styles.loadingDots}>
            <span className={styles.loadingDot} style={{ animationDelay: '0s' }} />
            <span className={styles.loadingDot} style={{ animationDelay: '0.2s' }} />
            <span className={styles.loadingDot} style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  if (isLockedByMalpractice && lockInfo) {
    return (
      <LockScreen
        lockInfo={lockInfo}
        onUnlock={() => {
          // Lock expired: send student back to the assessment intro.
          // Previous progress is not restored — they must start fresh.
          setIsLockedByMalpractice(false);
          setLockInfo(null);
          setScreen('intro');
          setCurrentIndex(0);
          setSelectedOption(null);
          setSubmitted(false);
          setShowExplanation(false);
          setResults(null);
        }}
      />
    );
  }

  if (screen === 'loading') {
    return (
      <StudentLayout>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}>
            <div className={styles.spinnerRing} />
          </div>
          <p className={styles.loadingText}>Preparing your assessment...</p>
          <div className={styles.loadingDots}>
            <span className={styles.loadingDot} style={{ animationDelay: '0s' }} />
            <span className={styles.loadingDot} style={{ animationDelay: '0.2s' }} />
            <span className={styles.loadingDot} style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
        {monitoringModal}
      </StudentLayout>
    );
  }

  // ─── Intro screen ──────────────────────────────────────────
  if (screen === 'intro') {
    return (
      <StudentLayout>
        <div className={styles.page}>
          <div className={`${styles.introCard} ${config.bgClass} ${styles.fadeInUp}`}>
            <div className={styles.roundBadge} style={{ borderColor: config.color, color: config.color }}>
              <Target className={styles.iconPulse} />
              <span>{config.label}</span>
            </div>
            <h1 className={styles.introTitle}>{topicName}</h1>
            <div className={styles.introInfo}>
              {[
                { value: String(totalQuestions), label: 'Questions' },
                { value: `${config.timePerQ}s`, label: 'Per Question' },
                { value: `${requiredCorrectAnswers}/${totalQuestions || 1}`, label: 'To Pass' },
              ].map((item, i) => (
                <div 
                  key={i} 
                  className={styles.infoItem}
                  style={{ animationDelay: `${i * 0.2}s` }}
                >
                  <span className={styles.infoValue}>{item.value}</span>
                  <span className={styles.infoLabel}>{item.label}</span>
                </div>
              ))}
            </div>
            <p className={styles.introNote}>
              You must get at least {requiredCorrectAnswers} out of {totalQuestions}
              to unlock the next step.
            </p>
            <p className={styles.introNote}>
              Do not switch tabs during the MCQ test. Warnings will be recorded for this session.
            </p>
            {monitoringBadge}
            <button 
              className={styles.beginBtn} 
              onClick={startRound}
            >
              Begin Round 
              <ChevronRight size={18} className={styles.btnIcon} />
            </button>
          </div>
        </div>
        {monitoringUi}
        {monitoringModal}
      </StudentLayout>
    );
  }

  // ─── Question screen ──────────────────────────────────────
  if (screen === 'question' && questions.length > 0) {
    const currentQ = questions[currentIndex];
    
    // Safety check
    if (!currentQ || !currentQ.options || !currentQ.originalOrder) {
      return (
        <StudentLayout>
          <div className={styles.page}>
            <div className={styles.errorCard}>
              <AlertTriangle size={48} className={styles.errorIcon} />
              <h2>Question Error</h2>
              <p>Unable to load this question. Please try again.</p>
              <button 
                className={styles.beginBtn}
                onClick={() => navigate(-1)}
              >
                Go Back
              </button>
            </div>
          </div>
          {monitoringModal}
        </StudentLayout>
      );
    }

    return (
      <StudentLayout>
        <div className={styles.page}>
          {/* Top bar */}
          <div className={styles.topBar}>
            <span className={`${styles.roundBadgeSmall} ${styles.slideInLeft}`} style={{ color: config.color }}>
              MCQ
            </span>
            <span className={`${styles.questionCount} ${styles.fadeIn}`}>
              Q {currentIndex + 1} of {totalQuestions}
            </span>
            <TimerDisplay timeLeft={timeLeft} totalTime={config.timePerQ} />
          </div>
          <div style={{ marginBottom: '0.85rem' }}>
            {monitoringBadge}
          </div>
          {monitoringLiveAlert}

          {/* Question card with animation */}
          <div 
            ref={questionCardRef}
            className={`${styles.questionCard} ${
              isTransitioning 
                ? slideDirection === 'left' 
                  ? styles.slideOutLeft 
                  : styles.slideInRight
                : styles.cardEnter
            }`}
          >
            <span className={styles.questionBadge}>
              Q{currentIndex + 1}
            </span>
            <p className={styles.questionText}>{currentQ.question}</p>
          </div>

          {/* Options with staggered animation */}
          <div className={styles.optionsList}>
            {currentQ.options.map((opt, idx) => {
              let optClass = styles.optionDefault;
              const mapping = currentQ.originalOrder;
              const realIdx = mapping ? mapping[idx] : idx;

              if (submitted && currentCorrectAnswer !== null) {
                if (realIdx === currentCorrectAnswer) {
                  optClass = styles.optionCorrect;
                } else if (idx === selectedOption && !isCorrect) {
                  optClass = styles.optionIncorrect;
                }
              } else if (idx === selectedOption) {
                optClass = styles.optionSelected;
              }

              const labels = ['A', 'B', 'C', 'D'];

              return (
                <button
                  key={idx}
                  className={`${styles.optionBtn} ${optClass} ${
                    isTransitioning 
                      ? styles.slideOutDown 
                      : styles.slideInUp
                  }`}
                  style={{ animationDelay: `${idx * 0.1}s` }}
                  disabled={submitted}
                  onClick={() => setSelectedOption(idx)}
                >
                  <span className={`${styles.optionLetter} ${
                    idx === selectedOption ? styles.letterActive : ''
                  } ${submitted && realIdx === currentCorrectAnswer ? styles.letterCorrect : ''}`}>
                    {labels[idx]}
                  </span>
                  <span className={styles.optionText}>{opt}</span>
                  {submitted && realIdx === currentCorrectAnswer && (
                    <Check className={`${styles.optionIcon} ${styles.iconPopIn}`} color="#22c55e" />
                  )}
                  {submitted && idx === selectedOption && realIdx !== currentCorrectAnswer && (
                    <X className={`${styles.optionIcon} ${styles.iconPopIn}`} color="#ef4444" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Submit / Next / Hint area with animations */}
          <div className={styles.actionArea}>
            {!submitted ? (
              <button
                className={`${styles.submitBtn} ${
                  selectedOption !== null ? styles.submitBtnActive : ''
                }`}
                disabled={selectedOption === null}
                onClick={() => handleSubmit(selectedOption)}
              >
                Submit Answer
              </button>
            ) : (
              <>
                {showExplanation && (
                  <div className={`${styles.feedbackBox} ${
                    isCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect
                  } ${styles.slideInUp}`}>
                    <div className={styles.feedbackHeader}>
                      <span className={styles.feedbackIcon}>
                        {isCorrect ? '🎉' : '💡'}
                      </span>
                      <p className={styles.feedbackTitle}>
                        {isCorrect ? 'Correct!' : 'Incorrect'}
                      </p>
                    </div>
                    <p className={styles.feedbackExplanation}>
                      {currentExplanation}
                    </p>
                  </div>
                )}

                {!isCorrect && !hintText && (
                  <button
                    className={`${styles.hintBtn} ${styles.slideInUp}`}
                    style={{ animationDelay: '0.2s' }}
                    disabled={hintLoading}
                    onClick={handleGetHint}
                  >
                    <Lightbulb size={16} className={hintLoading ? styles.iconSpin : ''} />
                    {hintLoading ? 'Getting Hint...' : 'Get AI Hint'}
                  </button>
                )}

                {hintText && (
                  <div className={`${styles.hintBox} ${styles.slideInUp}`} style={{ animationDelay: '0.3s' }}>
                    <Lightbulb size={14} className={styles.hintIcon} />
                    <p>{hintText}</p>
                  </div>
                )}

                <button 
                  className={`${styles.nextBtn} ${styles.slideInUp}`} 
                  style={{ animationDelay: '0.4s' }}
                  onClick={goToNext}
                >
                  {currentIndex < questions.length - 1
                    ? 'Next Question'
                    : 'See Results'}
                  <ChevronRight size={18} className={styles.btnIcon} />
                </button>
              </>
            )}
          </div>

          {/* Progress dots */}
          <ProgressDots total={totalQuestions} current={currentIndex} />
        </div>
        {monitoringUi}
        {monitoringModal}
      </StudentLayout>
    );
  }

  // ─── Result screen ────────────────────────────────────────
  if (screen === 'result' && results) {
    const resultQuestionCount = results.totalQuestions || results.results?.length || totalQuestions || 0;
    const correct = results.results
      ? results.results.filter((r) => r.isCorrect).length
      : 0;
    const accuracy = results.results
      ? Math.round(
          (results.results.filter((r) => r.isCorrect).length / Math.max(resultQuestionCount, 1)) * 100
        )
      : 0;
    const avgTime =
      results.results && results.results.length > 0
        ? Math.round(
            results.results.reduce((s, r) => s + (r.timeTaken || 0), 0) /
              results.results.length
          )
        : 0;

    const passed = results.passed;
    const handleContinueAfterPass = async () => {
      try {
        const codingRes = await api.get(`/coding/by-topic/${topicId}`);
        const problemId = codingRes?.data?.data?.problem?._id;
        if (problemId) {
          navigate(`/coding/${problemId}`);
          return;
        }
      } catch {
        // If no coding is available, unlock next progression step.
      }

      try {
        await api.post('/progress/unlock', { topicId });
        toast.success('No coding problem found. Moved to next topic/module.');
        navigate('/courses');
      } catch {
        navigate('/modules');
      }
    };

    return (
      <StudentLayout>
        <div className={styles.page}>
          <div style={{ marginBottom: '0.9rem' }}>
            {monitoringBadge}
          </div>
          {monitoringLiveAlert}
          {/* Score card with animation */}
          <div className={`${styles.resultCard} ${styles.fadeInUp}`}>
            <div className={`${styles.resultBadge} ${
              passed ? styles.passedBadge : styles.failedBadge
            } ${styles.badgePopIn}`}>
              {passed ? (
                <Trophy size={20} className={styles.iconShimmer} />
              ) : (
                <AlertTriangle size={20} />
              )}
              <span>{passed ? 'PASSED' : 'FAILED'}</span>
            </div>

            <div className={styles.scoreCircle}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle
                  cx="70" cy="70" r="60"
                  fill="none" stroke="#1e1e35" strokeWidth="10"
                />
                <circle
                  cx="70" cy="70" r="60"
                  fill="none"
                  stroke={passed ? '#22c55e' : '#ef4444'}
                  strokeWidth="10"
                  strokeDasharray={377}
                  strokeDashoffset={377 - (377 * correct) / Math.max(resultQuestionCount, 1)}
                  strokeLinecap="round"
                  className={styles.scoreCircleProgress}
                />
              </svg>
              <div className={styles.scoreInner}>
                <span className={styles.scoreNumber}>{correct}</span>
                <span className={styles.scoreTotal}>/ {resultQuestionCount} Correct</span>
              </div>
            </div>

            <p className={styles.accuracyText}>{accuracy}% Accuracy</p>
            <p className={styles.avgTimeText}>
              Average: {avgTime} seconds per question
            </p>
            <p className={styles.avgTimeText}>
              Pass mark: {results.requiredCorrectAnswers || getRequiredCorrectAnswers(resolvedRound, resultQuestionCount)} / {resultQuestionCount}
            </p>
          </div>

          {/* Collapsible question review */}
          <div className={`${styles.reviewSection} ${styles.fadeInUp}`} style={{ animationDelay: '0.2s' }}>
            <h3 className={styles.reviewTitle}>Question Review</h3>
            {results.results &&
              results.results.map((r, i) => (
                <details 
                  key={i} 
                  className={styles.reviewItem}
                  style={{ animationDelay: `${0.3 + i * 0.1}s` }}
                >
                  <summary className={styles.reviewSummary}>
                    <span>
                      Q{i + 1}:{' '}
                      <span className={r.isCorrect ? styles.reviewCorrect : styles.reviewWrong}>
                        {r.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                      </span>
                    </span>
                    <ChevronRight size={14} className={styles.reviewChevron} />
                  </summary>
                  <div className={styles.reviewDetail}>
                    <p>Your answer: <span className={r.isCorrect ? styles.reviewCorrect : styles.reviewWrong}>Option {r.selectedAnswer !== undefined ? String.fromCharCode(65 + (r.selectedAnswer ?? 0)) : 'N/A'}</span></p>
                    <p>Correct answer: <span className={styles.reviewCorrect}>Option {String.fromCharCode(65 + (r.correctAnswer ?? 0))}</span></p>
                  </div>
                </details>
              ))}
          </div>

          {/* Next actions */}
          <div className={`${styles.nextActions} ${styles.fadeInUp}`} style={{ animationDelay: '0.4s' }}>
            {passed && (
              <div className={styles.allDone}>
                <Trophy size={32} color="#22c55e" className={styles.iconShimmer} />
                <p>MCQ round complete! 🎉</p>
                <button
                  className={styles.continueBtn}
                  onClick={handleContinueAfterPass}
                >
                  Continue →
                </button>
              </div>
            )}
            {!passed && attemptNumber < 3 && (
              <button
                className={styles.retryBtn}
                onClick={() => {
                  setAttemptNumber((prev) => prev + 1);
                  startRound();
                }}
              >
                <RotateCcw size={16} /> Try Again
              </button>
            )}
            {!passed && attemptNumber >= 3 && (
              <button
                className={styles.helpBtn}
                onClick={() => navigate('/modules')}
              >
                Get Targeted Help →
              </button>
            )}
          </div>

          {/* Malpractice warning */}
          {results.malpracticeFlag &&
            results.malpracticeFlag !== 'LOW' &&
            results.malpracticeFlag !== 'NONE' && (
              <div className={`${styles.malpracticeWarning} ${styles.fadeInUp}`} style={{ animationDelay: '0.5s' }}>
                <AlertTriangle size={16} />
                Unusual activity detected during this assessment.
              </div>
            )}
        </div>
        {monitoringUi}
        {monitoringModal}
      </StudentLayout>
    );
  }

  return null;
}
