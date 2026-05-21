import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  Clock,
  Code2,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Terminal,
  Trophy,
  X,
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import usePracticeMonitoring from '../../hooks/usePracticeMonitoring';
import MalpracticeMonitor, { LockScreen } from '../../components/malpractice/MalpracticeMonitor';
import styles from './DiagnosticPage.module.css';

const playBeep = () => {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
    oscillator.stop(context.currentTime + 0.2);
  } catch {
    // Ignore audio issues quietly.
  }
};

const formatTopic = (topic = '') =>
  String(topic)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatPercentage = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const formatClock = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
};

const formatResultStatus = (status = '') =>
  String(status || 'not_attempted')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatCaseBlock = (value = '') =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/;/g, ';\n');

const formatJavaCode = (source = '') => {
  const lines = String(source || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');

  let indentLevel = 0;
  let previousBlank = false;
  const formatted = [];

  lines.forEach((line) => {
    const trimmed = line.replace(/\s+$/g, '').trim();

    if (!trimmed) {
      if (formatted.length && !previousBlank) {
        formatted.push('');
      }
      previousBlank = true;
      return;
    }

    previousBlank = false;
    const leadingClosers = trimmed.match(/^}+/)?.[0]?.length || 0;
    const effectiveIndent = Math.max(0, indentLevel - leadingClosers);

    formatted.push(`${'    '.repeat(effectiveIndent)}${trimmed}`);

    const openingBraces = (trimmed.match(/{/g) || []).length;
    const closingBraces = (trimmed.match(/}/g) || []).length;
    indentLevel = Math.max(0, indentLevel + openingBraces - closingBraces);
  });

  return formatted.join('\n').trimEnd();
};

const INDENT_UNIT = '    ';

const getLineBounds = (value, position) => {
  const safePosition = Math.max(0, Math.min(position, value.length));
  const lineStart = value.lastIndexOf('\n', Math.max(0, safePosition - 1)) + 1;
  let lineEnd = value.indexOf('\n', safePosition);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  return {
    lineStart,
    lineEnd,
    line: value.slice(lineStart, lineEnd),
  };
};

const getLeadingWhitespace = (line = '') => line.match(/^\s*/)?.[0] || '';

const indentSelectedLines = (value, start, end) => {
  const { lineStart } = getLineBounds(value, start);
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  const lines = value.slice(lineStart, lineEnd).split('\n');
  const nextBlock = lines.map((line) => `${INDENT_UNIT}${line}`).join('\n');

  return {
    nextValue: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
    nextSelectionStart: start + INDENT_UNIT.length,
    nextSelectionEnd: end + (INDENT_UNIT.length * lines.length),
  };
};

const outdentLine = (line = '') => {
  if (line.startsWith(INDENT_UNIT)) {
    return { nextLine: line.slice(INDENT_UNIT.length), removed: INDENT_UNIT.length };
  }

  if (line.startsWith('\t')) {
    return { nextLine: line.slice(1), removed: 1 };
  }

  const leadingSpaces = line.match(/^ +/)?.[0]?.length || 0;
  const removed = Math.min(INDENT_UNIT.length, leadingSpaces);
  return {
    nextLine: removed > 0 ? line.slice(removed) : line,
    removed,
  };
};

const outdentSelectedLines = (value, start, end) => {
  const { lineStart } = getLineBounds(value, start);
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  const sourceLines = value.slice(lineStart, lineEnd).split('\n');
  const removedByLine = [];
  const nextLines = sourceLines.map((line) => {
    const { nextLine, removed } = outdentLine(line);
    removedByLine.push(removed);
    return nextLine;
  });

  return {
    nextValue: `${value.slice(0, lineStart)}${nextLines.join('\n')}${value.slice(lineEnd)}`,
    nextSelectionStart: Math.max(lineStart, start - (removedByLine[0] || 0)),
    nextSelectionEnd: Math.max(
      lineStart,
      end - removedByLine.reduce((sum, removed) => sum + removed, 0)
    ),
  };
};

const difficultyClassMap = {
  Basic: styles.basicPill,
  Medium: styles.mediumPill,
  Hard: styles.hardPill,
};

const getAchievementBadge = (level) => {
  if (level === 'Placement-Ready') {
    return {
      title: 'Placement Ready',
      subtitle: 'You are performing strongly across MCQ and coding rounds.',
    };
  }

  if (level === 'Intermediate') {
    return {
      title: 'Strong Momentum',
      subtitle: 'Your foundations are solid and your coding signals are improving.',
    };
  }

  return {
    title: 'Foundation Builder',
    subtitle: 'You now have a clear baseline and a roadmap to build on.',
  };
};

const planByLevel = {
  Beginner: '90-day',
  Intermediate: '60-day',
  'Placement-Ready': '30-day',
};

const createGeneratingState = (title, text) => ({ title, text });

const buildCodingState = (problem) => ({
  ...problem,
  draftCode: formatJavaCode(problem.javaStarterCode),
  startedAt: problem.startedAt || null,
  expiresAt: problem.startedAt ? new Date(problem.startedAt).getTime() + (problem.timeLimit * 1000) : null,
  locked: false,
  opening: false,
  submitting: false,
  lastResult: null,
  attemptsLeft: Math.max(0, 3 - Number(problem.attemptCount || 0)),
  bestScore: Number(problem.bestScore || 0),
  attemptCount: Number(problem.attemptCount || 0),
  timeSpent: Number(problem.timeSpent || 0),
});

export default function DiagnosticPage() {
  const navigate = useNavigate();
  const { refreshUser, updateUser, user } = useAuth();

  const [screen, setScreen] = useState('welcome');
  const [generatingState, setGeneratingState] = useState(
    createGeneratingState('Preparing your question', 'Loading the next step of your diagnostic.')
  );
  const [sessionToken, setSessionToken] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(30);
  const [minQuestions, setMinQuestions] = useState(30);
  const [maxQuestions, setMaxQuestions] = useState(50);
  const [timePerQuestion, setTimePerQuestion] = useState(45);
  const [timeLeft, setTimeLeft] = useState(45);
  const [selectedOption, setSelectedOption] = useState(null);
  const [questionResult, setQuestionResult] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const [mcqSummary, setMcqSummary] = useState(null);
  const [codingProblems, setCodingProblems] = useState([]);
  const [selectedProblemId, setSelectedProblemId] = useState('');
  const [isCompletingCoding, setIsCompletingCoding] = useState(false);
  const [results, setResults] = useState(null);
  const [codingClock, setCodingClock] = useState(Date.now());
  const [lockCheckLoading, setLockCheckLoading] = useState(true);
  const [isLockedByMalpractice, setIsLockedByMalpractice] = useState(false);
  const [lockInfo, setLockInfo] = useState(null);

  const timerRef = useRef(null);
  const beepPlayed = useRef(false);
  const analyzingInterval = useRef(null);
  const sessionDataRef = useRef({ changedAnswers: 0 });
  const codingExpiryRef = useRef({});
  const codeEditorRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const completedSummaryLoadedRef = useRef(false);

  const handleMonitoringStatusChange = useMemo(
    () => (nextState) => {
      if (nextState.finalFlagged) {
        toast.error(
          `Monitoring flag raised for this diagnostic. Warning ${nextState.warningCount}/${nextState.warningLimit}.`
        );
        return;
      }

      if ((nextState.warningCount || 0) > 0) {
        toast(`Warning ${nextState.warningCount}/${nextState.warningLimit}: do not switch tabs during the diagnostic.`, {
          icon: '!',
        });
      }
    },
    []
  );

  const {
    browserMetrics,
    captureVideoRef,
    consentModal,
    finishMonitoring,
    isMobile,
    sessionId,
    sessionState,
    startMonitoring,
    stream,
    trackBrowserEvent,
  } = usePracticeMonitoring({
    sessionType: 'diagnostic',
    institutionLinked: !!user?.institutionId,
    sessionLabel: 'diagnostic test session',
    onStatusChange: handleMonitoringStatusChange,
  });

  useEffect(() => {
    let isMounted = true;

    const checkLock = async () => {
      try {
        const response = await api.get('/malpractice/check-lock?sessionType=diagnostic');
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

  const analyzingMessages = [
    'Analyzing your combined MCQ and coding performance',
    'Estimating your placement readiness',
    'Finding strong areas and weak patterns',
    'Preparing your roadmap',
  ];

  const questionRangeLabel = useMemo(
    () => `${minQuestions}-${maxQuestions}`,
    [minQuestions, maxQuestions]
  );

  const selectedProblem = useMemo(
    () => codingProblems.find((problem) => problem.problemId === selectedProblemId) || null,
    [codingProblems, selectedProblemId]
  );

  const attemptedCodingProblems = useMemo(
    () => codingProblems.filter((problem) => Number(problem.attemptCount || 0) > 0).length,
    [codingProblems]
  );

  const codingTopicScores = useMemo(
    () => results?.codingTopicScores || {},
    [results]
  );

  const focusAreas = useMemo(() => {
    if (results?.weakAreas?.length) return results.weakAreas;
    return Object.entries(codingTopicScores)
      .sort((left, right) => left[1] - right[1])
      .slice(0, 3)
      .map(([topic]) => topic);
  }, [codingTopicScores, results]);

  const strengths = useMemo(() => {
    if (results?.strongAreas?.length) return results.strongAreas;
    return Object.entries(codingTopicScores)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([topic]) => topic);
  }, [codingTopicScores, results]);

  const currentRemainingSeconds = useMemo(() => {
    if (!selectedProblem) return 0;
    if (!selectedProblem.startedAt || !selectedProblem.expiresAt) return selectedProblem.timeLimit;
    return Math.max(0, Math.ceil((selectedProblem.expiresAt - codingClock) / 1000));
  }, [codingClock, selectedProblem]);

  const selectedProblemError = useMemo(() => {
    const visibleResults = selectedProblem?.lastResult?.visibleResults || [];
    return visibleResults.find((result) => result?.stderr)?.stderr || '';
  }, [selectedProblem]);

  const selectedProblemStatus = useMemo(
    () => formatResultStatus(selectedProblem?.lastResult?.status || 'not_attempted'),
    [selectedProblem]
  );

  const updateCodingProblem = (problemId, updater) => {
    setCodingProblems((previous) =>
      previous.map((problem) => (
        problem.problemId === problemId
          ? { ...problem, ...(typeof updater === 'function' ? updater(problem) : updater) }
          : problem
      ))
    );
  };

  const applyEditorEdit = (nextValue, nextSelectionStart, nextSelectionEnd = nextSelectionStart) => {
    if (!selectedProblem) return;

    updateCodingProblem(selectedProblem.problemId, {
      draftCode: nextValue,
    });

    window.requestAnimationFrame(() => {
      if (!codeEditorRef.current) return;
      codeEditorRef.current.focus();
      codeEditorRef.current.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  };

  const syncCodeEditorScroll = (event) => {
    if (!lineNumbersRef.current) return;
    lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const handleCodeEditorKeyDown = (event) => {
    if (!selectedProblem) return;

    const textarea = event.currentTarget;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const hasSelection = selectionStart !== selectionEnd;

    if (event.key === 'Tab') {
      event.preventDefault();

      if (event.shiftKey) {
        if (hasSelection && value.slice(selectionStart, selectionEnd).includes('\n')) {
          const result = outdentSelectedLines(value, selectionStart, selectionEnd);
          applyEditorEdit(result.nextValue, result.nextSelectionStart, result.nextSelectionEnd);
          return;
        }

        const { lineStart, lineEnd, line } = getLineBounds(value, selectionStart);
        const { nextLine, removed } = outdentLine(line);
        if (!removed) return;

        const nextValue = `${value.slice(0, lineStart)}${nextLine}${value.slice(lineEnd)}`;
        const nextCursor = Math.max(lineStart, selectionStart - removed);
        applyEditorEdit(nextValue, nextCursor);
        return;
      }

      if (hasSelection && value.slice(selectionStart, selectionEnd).includes('\n')) {
        const result = indentSelectedLines(value, selectionStart, selectionEnd);
        applyEditorEdit(result.nextValue, result.nextSelectionStart, result.nextSelectionEnd);
        return;
      }

      const nextValue = `${value.slice(0, selectionStart)}${INDENT_UNIT}${value.slice(selectionEnd)}`;
      const nextCursor = selectionStart + INDENT_UNIT.length;
      applyEditorEdit(nextValue, nextCursor);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      const { lineStart, line } = getLineBounds(value, selectionStart);
      const currentIndent = getLeadingWhitespace(line);
      const beforeCursor = value.slice(lineStart, selectionStart);
      const increaseIndent = beforeCursor.trimEnd().endsWith('{');
      const nextIndent = `${currentIndent}${increaseIndent ? INDENT_UNIT : ''}`;
      const afterSelection = value.slice(selectionEnd);
      const closesBlockNext = afterSelection.startsWith('}');
      const insertion = closesBlockNext
        ? `\n${nextIndent}\n${currentIndent}`
        : `\n${nextIndent}`;
      const nextValue = `${value.slice(0, selectionStart)}${insertion}${afterSelection}`;
      const nextCursor = selectionStart + 1 + nextIndent.length;
      applyEditorEdit(nextValue, nextCursor);
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === '{') {
      event.preventDefault();

      if (hasSelection) {
        const selectedText = value.slice(selectionStart, selectionEnd);
        const nextValue = `${value.slice(0, selectionStart)}{${selectedText}}${value.slice(selectionEnd)}`;
        applyEditorEdit(nextValue, selectionStart + 1, selectionEnd + 1);
        return;
      }

      const nextChar = value[selectionEnd] || '';
      const shouldPair = !nextChar || /\s|[)\]}]/.test(nextChar);
      const nextValue = shouldPair
        ? `${value.slice(0, selectionStart)}{}${value.slice(selectionEnd)}`
        : `${value.slice(0, selectionStart)}{${value.slice(selectionEnd)}`;
      const nextCursor = selectionStart + 1;
      applyEditorEdit(nextValue, nextCursor);
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === '}' && !hasSelection) {
      const { lineStart } = getLineBounds(value, selectionStart);
      const beforeCursor = value.slice(lineStart, selectionStart);

      if (/^\s*$/.test(beforeCursor) && beforeCursor.endsWith(INDENT_UNIT)) {
        event.preventDefault();

        const dedented = beforeCursor.slice(0, -INDENT_UNIT.length);
        if (value[selectionStart] === '}') {
          const nextValue = `${value.slice(0, lineStart)}${dedented}${value.slice(selectionStart)}`;
          const nextCursor = lineStart + dedented.length + 1;
          applyEditorEdit(nextValue, nextCursor);
          return;
        }

        const nextValue = `${value.slice(0, lineStart)}${dedented}}${value.slice(selectionEnd)}`;
        const nextCursor = lineStart + dedented.length + 1;
        applyEditorEdit(nextValue, nextCursor);
        return;
      }

      if (value[selectionStart] === '}') {
        event.preventDefault();
        const nextCursor = selectionStart + 1;
        window.requestAnimationFrame(() => {
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      }
    }
  };

  const formatSelectedProblemCode = () => {
    if (!selectedProblem) return;

    updateCodingProblem(selectedProblem.problemId, (current) => ({
      draftCode: formatJavaCode(current.draftCode),
    }));

    toast.success(`Formatted ${selectedProblem.title}`);
  };

  const loadNextQuestion = async (token, fallbackTarget = totalQuestions, fallbackTime = timePerQuestion) => {
    try {
      setGeneratingState(
        createGeneratingState(
          'Preparing your question',
          `Loading question ${questionNumber || 1} of ${questionRangeLabel}.`
        )
      );
      setScreen('generating');

      const { data } = await api.post('/diagnostic/question', { token });
      if (!data.success || !data.data) {
        throw new Error(data.message || 'Failed to load question');
      }

      setCurrentQuestion(data.data);
      setQuestionNumber(data.data.questionNumber || 1);
      setTotalQuestions(data.data.currentTarget || fallbackTarget || 30);
      setTimeLeft(data.data.timeLimit || fallbackTime || 45);
      setSelectedOption(null);
      setQuestionResult(null);
      beepPlayed.current = false;
      setScreen('question');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Could not load question.';
      setSessionError(message);
      setScreen('error');
      toast.error(message);
    }
  };

  const ensureCodingProblemStarted = async (problemId) => {
    const problem = codingProblems.find((entry) => entry.problemId === problemId);
    if (!problem || problem.opening || !sessionToken) return;

    updateCodingProblem(problemId, { opening: true });

    try {
      const { data } = await api.post('/diagnostic/coding/open', {
        sessionToken,
        problemId,
      });

      if (!data.success || !data.data) {
        throw new Error(data.message || 'Could not open coding problem');
      }

      const startedAt = data.data.startedAt ? new Date(data.data.startedAt).getTime() : Date.now();

      updateCodingProblem(problemId, {
        opening: false,
        startedAt: data.data.startedAt,
        expiresAt: startedAt + (problem.timeLimit * 1000),
        locked: !!data.data.locked,
      });
    } catch (error) {
      updateCodingProblem(problemId, { opening: false });
      toast.error(error.response?.data?.message || error.message || 'Could not open coding problem.');
    }
  };

  const prepareCodingPhase = async (token) => {
    try {
      setGeneratingState(
        createGeneratingState(
          'Preparing your coding round',
          'Selecting 10 Java problems and securing hidden test cases on the server.'
        )
      );
      setScreen('generating');

      const { data } = await api.post('/diagnostic/complete', { token });
      if (!data.success || !data.data?.codingProblems) {
        throw new Error(data.message || 'Could not prepare coding phase');
      }

      const problems = data.data.codingProblems.map(buildCodingState);
      setMcqSummary({
        mcqScore: Number(data.data.mcqScore || 0),
        totalProblems: Number(data.data.totalProblems || problems.length),
      });
      setCodingProblems(problems);
      setSelectedProblemId(problems[0]?.problemId || '');
      setScreen('coding');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Could not prepare coding phase.';
      setSessionError(message);
      setScreen('error');
      toast.error(message);
    }
  };

  const startDiagnostic = async () => {
    setIsSubmitting(true);
    setSessionError('');

    try {
      const { data } = await api.post('/diagnostic/start');
      if (!data.success || !data.data?.token) {
        throw new Error(data.message || 'Could not start diagnostic');
      }

      const nextMinQuestions = data.data.minQuestions || 30;
      const nextMaxQuestions = data.data.maxQuestions || 50;
      const nextTotalQuestions = data.data.totalQuestions || nextMinQuestions;
      const nextTimePerQuestion = data.data.timePerQuestion || 45;

      setSessionToken(data.data.token);
      setMinQuestions(nextMinQuestions);
      setMaxQuestions(nextMaxQuestions);
      setTotalQuestions(nextTotalQuestions);
      setTimePerQuestion(nextTimePerQuestion);

      await loadNextQuestion(data.data.token, nextTotalQuestions, nextTimePerQuestion);
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Could not start diagnostic.';
      setSessionError(message);
      setScreen('welcome');
      toast.error(message);

      if (error.response?.status === 400 && message.toLowerCase().includes('already completed')) {
        navigate('/dashboard', { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitAnswer = async (optionIndex) => {
    if (isSubmitting || selectedOption !== null || !sessionToken) return;

    setSelectedOption(optionIndex);
    setIsSubmitting(true);

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    const questionLimit = currentQuestion?.timeLimit || timePerQuestion;
    const timeTaken = questionLimit - timeLeft;

    try {
      const { data } = await api.post('/diagnostic/answer', {
        token: sessionToken,
        selectedOption: optionIndex,
        timeTaken,
      });

      if (!data.success || !data.data) {
        throw new Error(data.message || 'Failed to submit answer');
      }

      setQuestionResult(data.data);
      setTotalQuestions(data.data.currentTarget || totalQuestions);

      window.setTimeout(() => {
        if (data.data.isComplete) {
          prepareCodingPhase(sessionToken);
        } else {
          loadNextQuestion(sessionToken, data.data.currentTarget || totalQuestions, timePerQuestion);
        }
      }, 1100);
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Failed to submit answer.';
      setSessionError(message);
      setScreen('error');
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCodingProblem = async (problemId, options = {}) => {
    const problem = codingProblems.find((entry) => entry.problemId === problemId);
    if (!problem || problem.submitting || problem.locked || !sessionToken) return;

    updateCodingProblem(problemId, { submitting: true });

    try {
      const { data } = await api.post('/diagnostic/coding/submit', {
        sessionToken,
        problemId,
        code: problem.draftCode,
        language: 'java',
      });

      if (!data.success || !data.data) {
        throw new Error(data.message || 'Could not run coding tests');
      }

      updateCodingProblem(problemId, (current) => ({
        submitting: false,
        attemptCount: 3 - Number(data.data.attemptsLeft || 0),
        attemptsLeft: Number(data.data.attemptsLeft || 0),
        bestScore: Number(data.data.bestScore || current.bestScore || 0),
        lastResult: data.data,
        locked: options.forceLock ? true : current.locked || Number(data.data.attemptsLeft || 0) <= 0,
      }));

      toast.success(
        options.auto ? `Auto-submitted ${problem.title}` : `Tests completed for ${problem.title}`
      );
    } catch (error) {
      updateCodingProblem(problemId, (current) => ({
        submitting: false,
        locked: options.forceLock ? true : current.locked,
      }));
      toast.error(error.response?.data?.message || error.message || 'Coding submission failed.');
    }
  };

  const completeCodingPhase = async () => {
    if (!sessionToken || isCompletingCoding) return;

    setIsCompletingCoding(true);
    setScreen('analyzing');

    try {
      const { data } = await api.post('/diagnostic/coding/complete', {
        sessionToken,
      });

      if (!data.success || !data.data) {
        throw new Error(data.message || 'Could not complete diagnostic');
      }

      updateUser({
        diagnosticCompleted: true,
        currentLevel: data.data.level,
        diagnosticScore: data.data.combinedScore,
        placementReadiness: data.data.placementReadiness,
      });

      try {
        await refreshUser();
      } catch {
        // The optimistic auth update is already in place.
      }

      localStorage.setItem('dsa_diag_completed', 'true');
      setResults(data.data);
      setScreen('results');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Could not complete diagnostic.';
      setSessionError(message);
      setScreen('error');
      toast.error(message);
    } finally {
      setIsCompletingCoding(false);
    }
  };

  const restartLanding = () => {
    setScreen('welcome');
    setSessionError('');
    setSelectedOption(null);
    setQuestionResult(null);
    setCurrentQuestion(null);
    setCodingProblems([]);
    setSelectedProblemId('');
    setResults(null);
  };

  const handleViewRoadmap = async () => {
    try {
      await refreshUser();
    } catch {
      // Navigation can continue with the existing client state.
    }

    navigate('/roadmap');
  };

  useEffect(() => {
    const loadCompletedSummary = async () => {
      completedSummaryLoadedRef.current = true;
      setGeneratingState(
        createGeneratingState(
          'Loading your diagnostic result',
          'Preparing your latest level, coding breakdown, and roadmap handoff.'
        )
      );
      setScreen('generating');

      try {
        const { data } = await api.get('/diagnostic/summary');
        if (!data.success || !data.data) {
          throw new Error(data.message || 'Could not load your diagnostic summary');
        }

        setResults({
          ...data.data,
          breakdown: Array.isArray(data.data.breakdown) ? data.data.breakdown : [],
          weakAreas: Array.isArray(data.data.weakAreas) ? data.data.weakAreas : [],
          strongAreas: Array.isArray(data.data.strongAreas) ? data.data.strongAreas : [],
          confidenceExplanation: data.data.confidenceExplanation || '',
          codingTopicScores: data.data.codingTopicScores || {},
        });
        setScreen('results');
      } catch (error) {
        completedSummaryLoadedRef.current = false;
        const restoredLevel = user?.currentLevel || 'Beginner';
        setResults({
          level: restoredLevel,
          mcqScore: 0,
          codingScore: 0,
          confidence: 0,
          placementReadiness: Number(user?.placementReadiness || user?.diagnosticScore || 0),
          breakdown: [],
          weakAreas: [],
          strongAreas: [],
          confidenceExplanation: '',
          codingTopicScores: {},
          recommendedPlan: planByLevel[restoredLevel] || '90-day',
        });
        setScreen('results');
      }
    };

    if (
      screen === 'welcome' &&
      user?.diagnosticCompleted &&
      !sessionToken &&
      !results &&
      !completedSummaryLoadedRef.current
    ) {
      loadCompletedSummary();
    }
  }, [results, screen, sessionToken, user?.currentLevel, user?.diagnosticCompleted, user?.diagnosticScore, user?.placementReadiness]);

  useEffect(() => {
    if (screen !== 'question' || selectedOption !== null || isSubmitting) {
      return undefined;
    }

    timerRef.current = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timerRef.current);
          if (selectedOption === null) {
            submitAnswer(-1);
          }
          return 0;
        }

        if (previous === 6 && !beepPlayed.current) {
          playBeep();
          beepPlayed.current = true;
        }

        return previous - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [screen, selectedOption, isSubmitting, sessionToken, currentQuestion, timePerQuestion]);

  useEffect(() => {
    if (screen !== 'coding' || !selectedProblemId) return;
    ensureCodingProblemStarted(selectedProblemId);
  }, [screen, selectedProblemId]);

  useEffect(() => {
    if (screen !== 'coding' || !selectedProblem) return undefined;

    const interval = window.setInterval(() => {
      setCodingClock(Date.now());

      const current = codingProblems.find((problem) => problem.problemId === selectedProblem.problemId);
      if (!current || !current.startedAt || current.locked || !current.expiresAt) return;

      const remaining = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000));
      if (remaining <= 0 && !codingExpiryRef.current[current.problemId]) {
        codingExpiryRef.current[current.problemId] = true;
        const shouldAutoSubmit = Boolean(current.draftCode?.trim()) && Number(current.attemptsLeft || 0) > 0;

        if (shouldAutoSubmit) {
          submitCodingProblem(current.problemId, { auto: true, forceLock: true });
        } else {
          updateCodingProblem(current.problemId, { locked: true });
        }
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [screen, selectedProblem, codingProblems]);

  useEffect(() => {
    return undefined;

    let copyThrottleTimer;

    const shouldMonitor = () => screen === 'question' || screen === 'coding';

    const handleVisibility = () => {
      if (document.hidden && shouldMonitor()) {
        trackBrowserEvent('tabSwitches');
        toast('Do not switch tabs during the test. This session is monitored.', { icon: '!' });
      }
    };

    const handleCopy = () => {
      if (shouldMonitor() && !copyThrottleTimer) {
        trackBrowserEvent('copyAttempts');
        copyThrottleTimer = window.setTimeout(() => {
          copyThrottleTimer = null;
        }, 1000);
      }
    };

    const handleBlur = () => {
      if (shouldMonitor()) {
        trackBrowserEvent('windowBlurCount');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('copy', handleCopy);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('copy', handleCopy);
      window.removeEventListener('blur', handleBlur);

      if (copyThrottleTimer) {
        window.clearTimeout(copyThrottleTimer);
      }
    };
  }, [screen, trackBrowserEvent]);

  useEffect(() => () => {
    finishMonitoring({}, { keepalive: true });
  }, [finishMonitoring]);

  useEffect(() => {
    if (screen !== 'analyzing') return undefined;

    analyzingInterval.current = window.setInterval(() => {
      setAnalyzingStep((previous) => (previous + 1) % analyzingMessages.length);
    }, 1000);

    return () => {
      if (analyzingInterval.current) {
        window.clearInterval(analyzingInterval.current);
      }
    };
  }, [screen]);

  const codeLineNumbers = selectedProblem
    ? Array.from({ length: (selectedProblem.draftCode || '').split('\n').length }, (_, index) => index + 1).join('\n')
    : '';

  const resultBadge = results ? getAchievementBadge(results.level) : null;
  const breakdownRows = Array.isArray(results?.breakdown) ? results.breakdown : [];

  if (lockCheckLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <section className={styles.centerCard}>
            <RefreshCw size={28} className={`${styles.loaderIcon} ${styles.spin}`} />
            <h2 className={styles.centerTitle}>Checking diagnostic access</h2>
            <p className={styles.centerText}>Please wait while your malpractice lock status is verified.</p>
          </section>
        </div>
      </div>
    );
  }

  if (isLockedByMalpractice && lockInfo) {
    return (
      <LockScreen
        lockInfo={lockInfo}
        onUnlock={() => {
          // Lock expired: clear the locked state and send student back to the
          // diagnostic start page (previous progress is NOT restored).
          setIsLockedByMalpractice(false);
          setLockInfo(null);
          setScreen('welcome');
          setSessionToken('');
          setCurrentQuestion(null);
          setSelectedOption(null);
          setQuestionResult(null);
          setCodingProblems([]);
          setResults(null);
        }}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {screen === 'welcome' && (
          <section className={styles.card}>
            <div className={styles.hero}>
              <div className={styles.heroIcon}>
                <Brain size={30} />
              </div>
              <div>
                <p className={styles.eyebrow}>Diagnostic Assessment</p>
                <h1 className={styles.title}>Start your DSA level test</h1>
                <p className={styles.subtitle}>
                  You will first complete the adaptive MCQ round, then solve 10 Java coding problems.
                  Your final level and roadmap are generated from both phases together.
                </p>
              </div>
            </div>

            <div className={styles.detailsGrid}>
              <div className={styles.detailBox}>
                <span className={styles.detailLabel}>MCQ questions</span>
                <strong className={styles.detailValue}>{minQuestions} to {maxQuestions}</strong>
              </div>
              <div className={styles.detailBox}>
                <span className={styles.detailLabel}>Coding round</span>
                <strong className={styles.detailValue}>10 Java problems</strong>
              </div>
              <div className={styles.detailBox}>
                <span className={styles.detailLabel}>Difficulty mix</span>
                <strong className={styles.detailValue}>2 Basic, 3 Medium, 5 Hard</strong>
              </div>
              <div className={styles.detailBox}>
                <span className={styles.detailLabel}>Result</span>
                <strong className={styles.detailValue}>Level and roadmap</strong>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <Sparkles size={18} />
                <span>Before you start</span>
              </div>
              <div className={styles.ruleList}>
                <div className={styles.ruleItem}>You cannot go back to previous MCQ questions.</div>
                <div className={styles.ruleItem}>Every coding problem allows up to 3 submissions, and the best score counts.</div>
                <div className={styles.ruleItem}>Coding timers are server-authoritative. The screen timer is only a guide.</div>
                <div className={styles.ruleItem}>You can finish the diagnostic at any time during the coding phase.</div>
                <div className={styles.ruleItem}>Do not switch tabs or leave the test window. Warnings are recorded.</div>
              </div>
            </div>

            {sessionError ? (
              <div className={styles.errorBanner}>
                <AlertCircle size={18} />
                <span>{sessionError}</span>
              </div>
            ) : null}

            <div className={styles.actionRow}>
              <button className={styles.primaryButton} onClick={startDiagnostic} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <RefreshCw size={18} className={styles.spin} />
                    <span>Starting diagnostic...</span>
                  </>
                ) : (
                  <>
                    <span>Start Test</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {screen === 'generating' && (
          <section className={styles.centerCard}>
            <RefreshCw size={28} className={`${styles.loaderIcon} ${styles.spin}`} />
            <h2 className={styles.centerTitle}>{generatingState.title}</h2>
            <p className={styles.centerText}>{generatingState.text}</p>
          </section>
        )}

        {screen === 'question' && currentQuestion && (
          <section className={styles.card}>
            <div className={styles.questionHeader}>
              <div className={styles.questionMeta}>
                <span className={styles.badge}>Question {questionNumber} / {questionRangeLabel}</span>
                <span className={styles.topicBadge}>
                  <BookOpen size={14} />
                  <span>{formatTopic(currentQuestion.topic)}</span>
                </span>
              </div>
              <div className={styles.timerBadge}>
                <Clock size={16} />
                <span>{timeLeft}s</span>
              </div>
            </div>

            <div className={styles.feedback}>
              <AlertCircle size={16} />
              <span>Live malpractice monitoring is active for this diagnostic.</span>
            </div>

            <div className={styles.questionBlock}>
              <h2 className={styles.questionText}>{currentQuestion.question}</h2>
            </div>

            <div className={styles.options}>
              {currentQuestion.options.map((option, index) => {
                let stateClass = '';

                if (selectedOption === index && !questionResult) {
                  stateClass = styles.optionSelected;
                } else if (questionResult) {
                  if (questionResult.isCorrect && index === selectedOption) {
                    stateClass = styles.optionCorrect;
                  } else if (!questionResult.isCorrect && index === selectedOption) {
                    stateClass = styles.optionWrong;
                  } else if (index === questionResult.correctOption) {
                    stateClass = styles.optionReveal;
                  }
                }

                const optionLabel = ['A', 'B', 'C', 'D'][index] || String(index + 1);

                return (
                  <button
                    key={index}
                    type="button"
                    className={`${styles.optionButton} ${stateClass}`}
                    disabled={selectedOption !== null}
                    onClick={() => submitAnswer(index)}
                  >
                    <span className={styles.optionIndex}>{optionLabel}</span>
                    <span className={styles.optionText}>{option}</span>
                  </button>
                );
              })}
            </div>

            {questionResult ? (
              <div className={`${styles.feedback} ${questionResult.isCorrect ? styles.feedbackGood : styles.feedbackBad}`}>
                {questionResult.isCorrect ? <Check size={18} /> : <X size={18} />}
                <span>
                  {questionResult.isCorrect ? 'Correct answer. Preparing the next step.' : 'Answer recorded. Preparing the next step.'}
                </span>
              </div>
            ) : null}
          </section>
        )}

        {screen === 'coding' && selectedProblem && (
          <section className={`${styles.card} ${styles.codingCard}`}>
            <div className={styles.codingHeader}>
              <div>
                <p className={styles.eyebrow}>Coding Phase</p>
                <h2 className={styles.codingTitle}>Java diagnostic problems</h2>
                <p className={styles.subtitle}>
                  Complete the diagnostic whenever you are ready. Hidden tests stay on the server.
                </p>
              </div>
              <div className={styles.codingSummary}>
                <div className={styles.summaryBox}>
                  <span className={styles.detailLabel}>MCQ score</span>
                  <strong className={styles.detailValue}>{mcqSummary?.mcqScore ?? 0} / 50</strong>
                </div>
                <div className={styles.summaryBox}>
                  <span className={styles.detailLabel}>Attempted</span>
                  <strong className={styles.detailValue}>{attemptedCodingProblems} / 10</strong>
                </div>
              </div>
            </div>

            <div className={styles.feedback}>
              <AlertCircle size={16} />
              <span>Live malpractice monitoring is active for this diagnostic.</span>
            </div>

            <div className={styles.problemTabs}>
              {codingProblems.map((problem, index) => {
                const isActive = problem.problemId === selectedProblemId;
                const remaining = problem.expiresAt
                  ? Math.max(0, Math.ceil((problem.expiresAt - codingClock) / 1000))
                  : problem.timeLimit;

                return (
                  <button
                    key={problem.problemId}
                    type="button"
                    className={`${styles.problemTab} ${isActive ? styles.problemTabActive : ''}`}
                    onClick={() => setSelectedProblemId(problem.problemId)}
                  >
                    <span>Problem {index + 1}</span>
                    <strong>{problem.title}</strong>
                    <span className={`${styles.difficultyPill} ${difficultyClassMap[problem.difficulty] || ''}`}>
                      {problem.difficulty}
                    </span>
                    <span className={styles.tabMeta}>{problem.attemptCount}/3 attempts</span>
                    <span className={styles.tabMeta}>
                      {problem.startedAt ? formatClock(remaining) : formatClock(problem.timeLimit)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.problemLayout}>
              <div className={styles.problemPanel}>
                <div className={styles.problemHeader}>
                  <div>
                    <div className={styles.problemTitleRow}>
                      <h3 className={styles.problemTitle}>{selectedProblem.title}</h3>
                      <span className={`${styles.difficultyPill} ${difficultyClassMap[selectedProblem.difficulty] || ''}`}>
                        {selectedProblem.difficulty}
                      </span>
                    </div>
                    <p className={styles.problemTopic}>Topic: {selectedProblem.topic}</p>
                  </div>

                  <div className={styles.problemHeaderMeta}>
                    <div className={`${styles.timerDisplay} ${currentRemainingSeconds < 120 ? styles.timerDanger : ''}`}>
                      <Clock size={16} />
                      <span>{formatClock(currentRemainingSeconds)}</span>
                    </div>
                    <div className={styles.scoreBox}>
                      <span>Best score</span>
                      <strong>{formatPercentage(selectedProblem.bestScore)}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.problemDescription}>
                  <div className={styles.sectionTitle}>
                    <BookOpen size={18} />
                    <span>Problem Brief</span>
                  </div>
                  <p>{selectedProblem.description}</p>
                </div>

                <div className={styles.problemMetaGrid}>
                  <div className={styles.metaCard}>
                    <span className={styles.detailLabel}>Attempts remaining</span>
                    <div className={styles.dotsRow}>
                      {Array.from({ length: 3 }, (_, index) => {
                        const filled = index < Number(selectedProblem.attemptsLeft || 0);
                        return (
                          <span
                            key={index}
                            className={`${styles.attemptDot} ${filled ? styles.attemptDotFilled : styles.attemptDotUsed}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className={styles.metaCard}>
                    <span className={styles.detailLabel}>Visible tests</span>
                    <strong className={styles.detailValue}>{selectedProblem.visibleTestCases.length}</strong>
                  </div>
                  <div className={styles.metaCard}>
                    <span className={styles.detailLabel}>Hidden tests</span>
                    <strong className={styles.detailValue}>{selectedProblem.hiddenTestCount}</strong>
                  </div>
                  <div className={styles.metaCard}>
                    <span className={styles.detailLabel}>Time limit</span>
                    <strong className={styles.detailValue}>{Math.round(selectedProblem.timeLimit / 60)} min</strong>
                  </div>
                </div>

                <div className={styles.editorCard}>
                  <div className={styles.editorHeader}>
                    <div className={styles.editorTitle}>
                      <Terminal size={16} />
                      <span>Java Editor</span>
                    </div>
                    <div className={styles.editorActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={selectedProblem.submitting || selectedProblem.locked}
                        onClick={formatSelectedProblemCode}
                      >
                        <Sparkles size={16} />
                        <span>Format Code</span>
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={selectedProblem.submitting || selectedProblem.locked}
                        onClick={() => submitCodingProblem(selectedProblem.problemId)}
                      >
                        {selectedProblem.submitting ? (
                          <>
                            <RefreshCw size={16} className={styles.spin} />
                            <span>Running Tests</span>
                          </>
                        ) : (
                          <>
                            <Play size={16} />
                            <span>Run Tests</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className={styles.editorShell}>
                    <pre ref={lineNumbersRef} className={styles.lineNumbers} aria-hidden="true">{codeLineNumbers}</pre>
                    <textarea
                      ref={codeEditorRef}
                      className={styles.codeEditor}
                      spellCheck={false}
                      value={selectedProblem.draftCode}
                      disabled={selectedProblem.locked}
                      onKeyDown={handleCodeEditorKeyDown}
                      onScroll={syncCodeEditorScroll}
                      onChange={(event) =>
                        updateCodingProblem(selectedProblem.problemId, {
                          draftCode: event.target.value,
                        })
                      }
                    />
                  </div>

                  {selectedProblem.locked ? (
                    <div className={`${styles.feedback} ${styles.feedbackBad}`}>
                      <AlertCircle size={16} />
                      <span>This problem is locked because the timer ended or all attempts were used.</span>
                    </div>
                  ) : null}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <Code2 size={18} />
                    <span>Hints</span>
                  </div>
                  <div className={styles.hintList}>
                    {selectedProblem.hints.map((hint) => (
                      <div key={hint} className={styles.hintCard}>{hint}</div>
                    ))}
                  </div>
                </div>
              </div>

              <aside className={styles.resultsPanel}>
                <div className={styles.resultsPanelHero}>
                  <div className={styles.sectionTitle}>
                    <Check size={18} />
                    <span>Visible Test Cases</span>
                  </div>
                  <div className={styles.statusCard}>
                    <span className={styles.detailLabel}>Submission status</span>
                    <strong className={styles.detailValue}>{selectedProblemStatus}</strong>
                  </div>
                </div>

                <div className={styles.testList}>
                  {selectedProblem.visibleTestCases.map((testCase, index) => {
                    const testResult = selectedProblem.lastResult?.visibleResults?.[index];
                    return (
                      <div key={`${selectedProblem.problemId}-${index}`} className={styles.testCard}>
                        <div className={styles.testHeader}>
                          <strong>Test {index + 1}</strong>
                          {testResult ? (
                            <span className={testResult.passed ? styles.passBadge : styles.failBadge}>
                              {testResult.passed ? 'Passed' : 'Failed'}
                            </span>
                          ) : (
                            <span className={styles.pendingBadge}>Pending</span>
                          )}
                        </div>
                        <div className={styles.testBlock}>
                          <span className={styles.testLabel}>Input</span>
                          <pre className={styles.testCodeBlock}>{formatCaseBlock(testCase.input)}</pre>
                        </div>
                        <div className={styles.testBlock}>
                          <span className={styles.testLabel}>Expected</span>
                          <pre className={styles.testCodeBlock}>{formatCaseBlock(testCase.expectedOutput)}</pre>
                        </div>
                        {testResult ? (
                          <>
                            <div className={styles.testBlock}>
                              <span className={styles.testLabel}>Actual</span>
                              <pre className={styles.testCodeBlock}>{formatCaseBlock(testResult.actualOutput || '<empty>')}</pre>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {selectedProblemError ? (
                  <div className={styles.compilerCard}>
                    <div className={styles.sectionTitle}>
                      <AlertCircle size={16} />
                      <span>Compiler / Runtime Output</span>
                    </div>
                    <pre className={styles.errorCodeBlock}>{selectedProblemError}</pre>
                  </div>
                ) : null}

                {selectedProblem.lastResult ? (
                  <div className={styles.submissionSummary}>
                    <div className={styles.summaryRow}>
                      <span>Visible tests</span>
                      <strong>{selectedProblem.lastResult.passedVisible}/{selectedProblem.lastResult.totalVisible}</strong>
                    </div>
                    <div className={styles.summaryRow}>
                      <span>Hidden tests</span>
                      <strong>{selectedProblem.lastResult.passedHidden}/{selectedProblem.lastResult.totalHidden}</strong>
                    </div>
                    <div className={styles.summaryRow}>
                      <span>Status</span>
                      <strong>{selectedProblemStatus}</strong>
                    </div>
                  </div>
                ) : (
                  <p className={styles.emptyText}>Run tests to view visible-case feedback.</p>
                )}
              </aside>
            </div>

            <div className={styles.footerActions}>
              <p className={styles.footerNote}>
                Coding problems are used to merge MCQ and coding into your final level.
              </p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => navigate('/dashboard')}
              >
                Exit to Dashboard
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isCompletingCoding}
                onClick={completeCodingPhase}
              >
                {isCompletingCoding ? (
                  <>
                    <RefreshCw size={16} className={styles.spin} />
                    <span>Finalizing</span>
                  </>
                ) : (
                  <>
                    <span>Complete Diagnostic</span>
                    <ChevronRight size={16} />
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {screen === 'analyzing' && (
          <section className={styles.centerCard}>
            <Brain size={28} className={styles.loaderIcon} />
            <h2 className={styles.centerTitle}>{analyzingMessages[analyzingStep]}</h2>
            <p className={styles.centerText}>Please wait while your final diagnostic result is generated.</p>
          </section>
        )}

        {screen === 'results' && results && (
          <section className={styles.card}>
            <div className={styles.resultsHeader}>
              <div className={styles.achievementBlock}>
                <div>
                  <p className={styles.eyebrow}>Diagnostic Complete</p>
                  <h2 className={styles.resultsTitle}>{resultBadge?.title}</h2>
                  <p className={styles.subtitle}>{resultBadge?.subtitle}</p>
                </div>
                <span className={styles.levelPill}>
                  <Award size={16} />
                  <span>{results.level}</span>
                </span>
              </div>
            </div>

            <div className={styles.resultsGrid}>
              <div className={styles.resultCard}>
                <Target size={18} />
                <span>MCQ Score</span>
                <strong>{results.mcqScore} / 50</strong>
              </div>
              <div className={styles.resultCard}>
                <Code2 size={18} />
                <span>Coding Score</span>
                <strong>{results.codingScore} / 10</strong>
              </div>
              <div className={styles.resultCard}>
                <Brain size={18} />
                <span>Confidence</span>
                <strong>{Math.round(Number(results.confidence || 0) * 100)}%</strong>
              </div>
              <div className={styles.resultCard}>
                <Trophy size={18} />
                <span>Placement Readiness</span>
                <strong>{results.placementReadiness}%</strong>
              </div>
            </div>

            {results.confidenceExplanation ? (
              <div className={styles.feedback}>
                <Brain size={16} />
                <span>{results.confidenceExplanation}</span>
              </div>
            ) : null}

            <div className={styles.resultsColumns}>
              <div className={styles.resultPanel}>
                <div className={styles.sectionTitle}>
                  <Trophy size={18} />
                  <span>Strong Areas</span>
                </div>
                <div className={styles.pillList}>
                  {strengths.length ? strengths.map((item) => (
                    <span key={item} className={styles.strongPill}>{item}</span>
                  )) : <p className={styles.emptyText}>No standout strengths yet.</p>}
                </div>
              </div>

              <div className={styles.resultPanel}>
                <div className={styles.sectionTitle}>
                  <Target size={18} />
                  <span>Focus Areas</span>
                </div>
                <div className={styles.pillList}>
                  {focusAreas.length ? focusAreas.map((item) => (
                    <span key={item} className={styles.focusPill}>{item}</span>
                  )) : <p className={styles.emptyText}>No weak areas reported.</p>}
                </div>
              </div>
            </div>

            <div className={styles.breakdownCard}>
              <div className={styles.sectionTitle}>
                <BookOpen size={18} />
                <span>Coding Breakdown</span>
              </div>
              {breakdownRows.length ? (
                <div className={styles.breakdownTable}>
                  <div className={styles.breakdownHead}>Problem</div>
                  <div className={styles.breakdownHead}>Difficulty</div>
                  <div className={styles.breakdownHead}>Tests</div>
                  <div className={styles.breakdownHead}>Score</div>

                  {breakdownRows.map((item) => (
                    <div key={item.problemId} className={styles.breakdownRow}>
                      <div>{item.title}</div>
                      <div>
                        <span className={`${styles.difficultyPill} ${difficultyClassMap[item.difficulty] || ''}`}>
                          {item.difficulty}
                        </span>
                      </div>
                      <div>{item.passedTotal}/{item.totalTests}</div>
                      <div>{formatPercentage(item.score)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyText}>
                  Your latest level is restored. Detailed coding breakdown is only available when a completed diagnostic session is stored.
                </p>
              )}
            </div>

            <div className={styles.actionRow}>
              <button className={styles.primaryButton} onClick={handleViewRoadmap}>
                <span>View Roadmap</span>
                <ChevronRight size={18} />
              </button>
              <button className={styles.secondaryButton} onClick={() => navigate('/dashboard')}>
                Go to Dashboard
              </button>
            </div>
          </section>
        )}

        {screen === 'error' && (
          <section className={styles.centerCard}>
            <AlertCircle size={28} className={styles.errorIcon} />
            <h2 className={styles.centerTitle}>Diagnostic page could not continue</h2>
            <p className={styles.centerText}>{sessionError || 'Something went wrong.'}</p>
            <div className={styles.actionRow}>
              <button className={styles.primaryButton} onClick={restartLanding}>
                Back to Start Page
              </button>
            </div>
          </section>
        )}
      </div>

      {/*
        MalpracticeMonitor must stay mounted from the moment the test starts
        to the moment it ends. We NEVER unmount it between questions.
        - paused=true during 'generating' and 'analyzing' halts detection
          intervals but keeps the camera stream alive.
        - sessionType='diagnostic' ensures only the diagnosticLock field is
          used on the backend.
      */}
      {(screen !== 'welcome' && screen !== 'results' && !lockCheckLoading) ? (
        <MalpracticeMonitor
          sessionType="diagnostic"
          assessmentId={sessionToken}
          paused={screen === 'generating' || screen === 'analyzing'}
          onLocked={(data) => {
            setIsLockedByMalpractice(true);
            setLockInfo(data);
          }}
          onUnlock={() => {
            setIsLockedByMalpractice(false);
            setLockInfo(null);
            setScreen('welcome');
            setSessionToken('');
            setCurrentQuestion(null);
            setSelectedOption(null);
            setQuestionResult(null);
            setCodingProblems([]);
            setResults(null);
          }}
          onWarning={() => {}}
        />
      ) : null}
    </div>
  );
}
