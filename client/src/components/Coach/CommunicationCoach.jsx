import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Code2,
  FileText,
  History,
  Keyboard,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
  X,
  Users,
} from 'lucide-react';
import styles from './Coach.module.css';
import AnnotatedAnswer from './AnnotatedAnswer';
import ScoreCard from './ScoreCard';
import SessionReport from './SessionReport';
import useSpeech from '../../hooks/useSpeech';
import {
  completeSession,
  getSession,
  getSessions,
  groupTurn,
  startSession,
  submitAnswer,
  uploadResume,
} from '../../services/coachService';

const MODES = [
  {
    id: 'resume',
    name: 'Resume-Based Interview',
    description: 'Practise personalised questions based on your experience and projects.',
    cardColor: 'violet',
    icon: FileText,
  },
  {
    id: 'hr',
    name: 'Frequently Asked HR',
    description: 'Build confident, structured answers to classic HR questions.',
    cardColor: 'blue',
    icon: MessageCircle,
  },
  {
    id: 'dsa',
    name: 'DSA Technical Interview',
    description: 'Explain algorithmic approaches clearly, from easy to hard.',
    cardColor: 'amber',
    icon: Code2,
  },
  {
    id: 'communication',
    name: 'Communication Skills',
    description: 'Practise speaking clearly about an unexpected topic.',
    cardColor: 'teal',
    icon: Mic,
  },
  {
    id: 'group',
    name: 'Group Discussion',
    description: 'Share and defend your view alongside two AI participants.',
    cardColor: 'indigo',
    icon: Users,
  },
];

const CARD_STYLES = {
  violet: {
    icon: 'bg-violet-500/15 text-violet-400',
    hover: 'hover:border-violet-500 hover:shadow-[0_0_0_1px_rgba(124,58,237,0.5),0_0_24px_rgba(124,58,237,0.16)]',
    button: 'bg-[#7C3AED] hover:bg-violet-700',
  },
  blue: {
    icon: 'bg-blue-500/15 text-blue-400',
    hover: 'hover:border-blue-500 hover:shadow-[0_0_0_1px_rgba(37,99,235,0.5),0_0_24px_rgba(37,99,235,0.16)]',
    button: 'bg-[#2563EB] hover:bg-blue-700',
  },
  amber: {
    icon: 'bg-amber-500/15 text-amber-400',
    hover: 'hover:border-amber-500 hover:shadow-[0_0_0_1px_rgba(217,119,6,0.5),0_0_24px_rgba(217,119,6,0.16)]',
    button: 'bg-[#D97706] hover:bg-amber-700',
  },
  teal: {
    icon: 'bg-teal-500/15 text-teal-400',
    hover: 'hover:border-teal-500 hover:shadow-[0_0_0_1px_rgba(13,148,136,0.5),0_0_24px_rgba(13,148,136,0.16)]',
    button: 'bg-[#0D9488] hover:bg-teal-700',
  },
  indigo: {
    icon: 'bg-indigo-500/15 text-indigo-400',
    hover: 'hover:border-indigo-500 hover:shadow-[0_0_0_1px_rgba(79,70,229,0.5),0_0_24px_rgba(79,70,229,0.16)]',
    button: 'bg-[#4F46E5] hover:bg-indigo-700',
  },
};

const GROUP_TURNS = ['opening', 'respond-a', 'respond-b', 'closing'];
const TURN_LABELS = {
  opening: 'Opening statement',
  'respond-a': 'Respond to Participant A',
  'respond-b': 'Respond to Participant B',
  closing: 'Closing summary',
};
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const getDisplayName = (studentName) =>
  typeof studentName === 'string' && studentName.trim()
    ? studentName.trim().split(/\s+/)[0]
    : 'there';

const scoreToNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
};

const makeLocalSummary = (session) => {
  const answered = (session?.questions || []).filter(
    (question) => question?.studentAnswer && question?.scores
  );
  if (!answered.length) return null;

  const average = (key) => Math.round(
    answered.reduce((sum, question) => sum + scoreToNumber(question.scores[key]), 0) /
      answered.length
  );
  const dimensionScores = {
    clarity: average('clarity'),
    confidence: average('confidence'),
    structure: average('structure'),
    relevance: average('relevance'),
    overall: average('overall'),
  };
  const weakestArea = ['clarity', 'confidence', 'structure', 'relevance']
    .reduce((weakest, key) =>
      dimensionScores[key] < dimensionScores[weakest] ? key : weakest,
    'clarity');
  const tips = {
    clarity: 'Use shorter sentences and explain one idea at a time.',
    confidence: 'Replace hesitant phrases with direct language and support your claims with an example.',
    structure: 'Organise each answer into an opening, supporting points, and a short conclusion.',
    relevance: 'Address the question directly before adding background or extra detail.',
  };
  return {
    avgClarity: dimensionScores.clarity,
    avgConfidence: dimensionScores.confidence,
    avgStructure: dimensionScores.structure,
    avgRelevance: dimensionScores.relevance,
    avgOverall: dimensionScores.overall,
    totalFillerWords: answered.reduce(
      (total, question) => total + (Number(question.fillerWords?.count) || 0),
      0
    ),
    weakestArea,
    improvementTip: tips[weakestArea],
  };
};

function ParticipantPanel({ label, color, messages, emptyMessage }) {
  const styles = color === 'rose'
    ? 'border-rose-500/20 bg-[#1A1A2E] text-slate-100'
    : 'border-blue-500/20 bg-[#1A1A2E] text-slate-100';
  return (
    <section className={`rounded-2xl border p-4 ${styles}`}>
      <h3 className="text-sm font-bold">{label}</h3>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">{emptyMessage}</p>
        ) : messages.map((message, index) => (
          <p
            key={`${label}-${index}`}
            className="rounded-xl bg-slate-800/80 p-3 text-sm leading-relaxed text-slate-200"
          >
            {message}
          </p>
        ))}
      </div>
    </section>
  );
}

function ResumeUpload({ file, onFileChange, onAnalyse, loading, extractedInfo }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const selectFile = (selectedFile) => {
    if (selectedFile) onFileChange(selectedFile);
  };

  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-white/10 bg-[#1A1A2E] p-6 sm:p-8">
      <span className="inline-flex rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-300">
        Personalised practice
      </span>
      <h2 className="mt-4 text-xl font-bold text-slate-100">Upload your resume</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        Upload a PDF to generate interview questions based on your skills and projects.
        Your file is processed in memory and is not saved to disk.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          selectFile(event.dataTransfer.files?.[0]);
        }}
        className={`mt-6 flex min-h-40 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-6 text-center transition ${
          isDragging
            ? 'border-violet-500 bg-violet-500/10'
            : 'border-white/15 bg-slate-900/50 hover:border-violet-400'
        }`}
      >
        <FileText className="h-8 w-8 text-violet-400" aria-hidden="true" />
        <span className="mt-3 text-sm font-semibold text-slate-100">
          {file ? file.name : 'Drop your PDF resume here or click to browse'}
        </span>
        <span className="mt-1 text-xs text-slate-400">PDF only · Up to 5 MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => {
          selectFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {file && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-900/70 px-4 py-3">
          <span className="truncate text-sm text-slate-200">{file.name}</span>
          <button
            type="button"
            onClick={() => onFileChange(null)}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Remove selected resume"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onAnalyse}
        disabled={!file || loading}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
        {loading ? 'Analysing resume…' : 'Analyse Resume'}
      </button>

      {extractedInfo && (
        <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Resume analysed
          </div>
          {extractedInfo.name && (
            <p className="mt-2 text-sm text-emerald-200">{extractedInfo.name}</p>
          )}
          {extractedInfo.skills?.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed text-emerald-200">
              <strong>Skills:</strong> {extractedInfo.skills.join(', ')}
            </p>
          )}
          {extractedInfo.projects?.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed text-emerald-200">
              <strong>Projects:</strong> {extractedInfo.projects.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function CommunicationCoach({ studentName = '' }) {
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isSpeaking,
    isSupported: isSpeechRecognitionSupported,
    error: speechError,
  } = useSpeech();

  const [activeMode, setActiveMode] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [studentAnswer, setStudentAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const [groupDiscussionState, setGroupDiscussionState] = useState({
    turn: 'opening',
    participantAMsg: '',
    participantBMsg: '',
    participantAMessages: [],
    participantBMessages: [],
    coachObservation: '',
    transcript: [],
  });
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [extractedInfo, setExtractedInfo] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('modes');
  const [history, setHistory] = useState([]);
  const [selectedHistorySession, setSelectedHistorySession] = useState(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isDraggingAnswer, setIsDraggingAnswer] = useState(false);
  const [voiceTranscriptStart, setVoiceTranscriptStart] = useState('');
  const answerRef = useRef(null);
  const questionSpokenRef = useRef('');

  const currentMode = MODES.find((mode) => mode.id === activeMode);
  const currentTurn = groupDiscussionState.turn;
  const speechAnswer = !voiceTranscriptStart
    ? transcript.trim()
    : transcript.startsWith(voiceTranscriptStart)
      ? transcript.slice(voiceTranscriptStart.length).trim()
      : transcript.trim();
  const answerToSubmit = isVoiceMode ? speechAnswer : studentAnswer.trim();
  const isResumeWaiting = activeMode === 'resume' && !currentQuestion && !sessionComplete;
  const visibleQuestionCount = totalQuestions || sessionData?.questions?.length || 0;
  const questionCounter = activeMode === 'dsa'
    ? `Question ${questionIndex + 1}`
    : `Question ${Math.min(questionIndex + 1, visibleQuestionCount || 1)} of ${visibleQuestionCount || 1}`;
  const groupTurnNumber = GROUP_TURNS.indexOf(currentTurn) + 1;

  useEffect(() => {
    if (!isVoiceMode || !currentQuestion || questionSpokenRef.current === currentQuestion) return;
    questionSpokenRef.current = currentQuestion;
    speak(currentQuestion);
  }, [currentQuestion, isVoiceMode, speak]);

  const resetSession = () => {
    stopListening();
    stopSpeaking();
    setActiveMode(null);
    setSessionId(null);
    setCurrentQuestion('');
    setQuestionIndex(0);
    setTotalQuestions(0);
    setStudentAnswer('');
    setLastResult(null);
    setSessionComplete(false);
    setSessionData(null);
    setResumeFile(null);
    setResumeUploading(false);
    setExtractedInfo(null);
    setErrorMessage('');
    setNotice('');
    setGroupDiscussionState({
      turn: 'opening',
      participantAMsg: '',
      participantBMsg: '',
      participantAMessages: [],
      participantBMessages: [],
      coachObservation: '',
      transcript: [],
    });
    setVoiceTranscriptStart(transcript);
    questionSpokenRef.current = '';
  };

  const beginSession = async (mode) => {
    setIsLoading(true);
    setErrorMessage('');
    setNotice('');
    setView('session');
    resetSession();
    try {
      const data = await startSession(mode);
      setActiveMode(mode);
      setSessionId(data.sessionId);
      setCurrentQuestion(data.firstQuestion || '');
      setTotalQuestions(mode === 'hr' || mode === 'resume' ? (mode === 'hr' ? 10 : 0) : 1);
      setSessionData({
        _id: data.sessionId,
        mode,
        status: 'active',
        createdAt: new Date().toISOString(),
        questions: data.firstQuestion ? [{ question: data.firstQuestion }] : [],
      });
      setQuestionIndex(0);
      setLastResult(null);
      setSessionComplete(false);
      setGroupDiscussionState({
        turn: 'opening',
        participantAMsg: '',
        participantBMsg: '',
        participantAMessages: [],
        participantBMessages: [],
        coachObservation: '',
        transcript: [],
      });
    } catch (error) {
      setView('modes');
      setErrorMessage(getErrorMessage(error, 'Unable to start a coaching session right now.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelection = (file) => {
    setErrorMessage('');
    if (!file) {
      setResumeFile(null);
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setResumeFile(null);
      setErrorMessage('Choose a PDF resume to continue.');
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setResumeFile(null);
      setErrorMessage('Resume files must be 5 MB or smaller.');
      return;
    }
    setResumeFile(file);
  };

  const analyseResume = async () => {
    if (!resumeFile || !sessionId) return;
    setResumeUploading(true);
    setErrorMessage('');
    try {
      const data = await uploadResume(sessionId, resumeFile);
      const questions = Array.isArray(data.questions)
        ? data.questions.map((question) => ({ question }))
        : [];
      if (questions.length !== 10 || !questions[0]?.question) {
        throw new Error('The coach did not return all 10 resume questions. Please try analysing the resume again.');
      }
      setExtractedInfo(data.extractedInfo || null);
      setCurrentQuestion(questions[0].question);
      setQuestionIndex(0);
      setTotalQuestions(10);
      setSessionData((previous) => ({
        ...previous,
        questions,
        extractedInfo: data.extractedInfo || null,
      }));
      setNotice('');
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to analyse this resume. Please try another PDF.'));
    } finally {
      setResumeUploading(false);
    }
  };

  const submitTextAnswer = async (event) => {
    event?.preventDefault();
    if (!answerToSubmit || isLoading || !sessionId || !currentQuestion) return;

    setIsLoading(true);
    setErrorMessage('');
    setNotice('');
    stopListening();
    try {
      const result = await submitAnswer(sessionId, answerToSubmit, questionIndex);
      const resultEntry = {
        question: currentQuestion,
        studentAnswer: answerToSubmit,
        scores: {
          ...result.scores,
          overall: result.scores?.overall ?? result.scores?.overallScore,
        },
        fillerWords: result.fillerWords || { count: 0, words: [] },
        annotations: result.annotations || [],
        coachFeedback: result.coachFeedback || '',
      };
      setLastResult({
        ...result,
        scores: resultEntry.scores,
        answer: answerToSubmit,
      });
      setSessionData((previous) => {
        const questions = [...(previous?.questions || [])];
        questions[questionIndex] = {
          ...questions[questionIndex],
          ...resultEntry,
          question: currentQuestion,
        };
        if (activeMode === 'dsa' && result.nextQuestion) {
          questions.push({ question: result.nextQuestion });
        }
        return {
          ...previous,
          questions,
          status: result.isLastQuestion ? 'completed' : previous?.status || 'active',
          completedAt: result.isLastQuestion ? new Date().toISOString() : previous?.completedAt,
          sessionSummary: result.sessionSummary || previous?.sessionSummary,
        };
      });

      if (result.isLastQuestion) {
        setSessionComplete(true);
      } else if (activeMode === 'dsa' && result.nextQuestion) {
        setCurrentQuestion(result.nextQuestion);
        setQuestionIndex((index) => index + 1);
        setStudentAnswer('');
        setVoiceTranscriptStart(transcript);
      } else if (activeMode === 'communication' && result.nextQuestion) {
        setCurrentQuestion(result.nextQuestion);
        setQuestionIndex((index) => index + 1);
        setStudentAnswer('');
        setVoiceTranscriptStart(transcript);
      } else {
        setNotice('Your answer is scored. Review the feedback, then continue when you are ready.');
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'The coach could not evaluate your answer. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const continueToNextQuestion = () => {
    const nextIndex = questionIndex + 1;
    const nextQuestion = sessionData?.questions?.[nextIndex]?.question;
    if (!nextQuestion) {
      setErrorMessage('The next question is not available. Please try starting a new session.');
      return;
    }
    setQuestionIndex(nextIndex);
    setCurrentQuestion(nextQuestion);
    setStudentAnswer('');
    setLastResult(null);
    setNotice('');
    setVoiceTranscriptStart(transcript);
  };

  const submitGroupAnswer = async (event) => {
    event?.preventDefault();
    if (!answerToSubmit || isLoading || !sessionId) return;

    setIsLoading(true);
    setErrorMessage('');
    setNotice('');
    stopListening();
    try {
      const result = await groupTurn(sessionId, currentTurn, answerToSubmit);
      const nextTurn = result.nextTurn;
      const newParticipantAMessages = result.participantAResponse
        ? [...groupDiscussionState.participantAMessages, result.participantAResponse]
        : groupDiscussionState.participantAMessages;
      const newParticipantBMessages = result.participantBResponse
        ? [...groupDiscussionState.participantBMessages, result.participantBResponse]
        : groupDiscussionState.participantBMessages;
      const newTranscript = [
        ...groupDiscussionState.transcript,
        { speaker: 'You', text: answerToSubmit, type: 'student' },
        ...(result.participantAResponse
          ? [{ speaker: 'Participant A', text: result.participantAResponse, type: 'participant-a' }]
          : []),
        ...(result.participantBResponse
          ? [{ speaker: 'Participant B', text: result.participantBResponse, type: 'participant-b' }]
          : []),
        ...(result.coachObservation
          ? [{ speaker: 'Coach', text: result.coachObservation, type: 'coach' }]
          : []),
      ];
      setGroupDiscussionState({
        turn: nextTurn || 'closing',
        participantAMsg: newParticipantAMessages.at(-1) || '',
        participantBMsg: newParticipantBMessages.at(-1) || '',
        participantAMessages: newParticipantAMessages,
        participantBMessages: newParticipantBMessages,
        coachObservation: result.coachObservation || '',
        transcript: newTranscript,
      });

      if (result.finalScore) {
        const finalResult = {
          ...result.finalScore,
          scores: {
            clarity: result.finalScore.clarity,
            confidence: result.finalScore.confidence,
            structure: result.finalScore.structure,
            relevance: result.finalScore.relevance,
            overall: result.finalScore.overall ?? result.finalScore.overallScore,
          },
          answer: [
            ...groupDiscussionState.transcript
              .filter((entry) => entry.type === 'student')
              .map((entry) => entry.text),
            answerToSubmit,
          ].join('\n\n'),
        };
        setLastResult(finalResult);
        setSessionData((previous) => {
          const questions = [...(previous?.questions || [])];
          questions.push({
            question: `${currentQuestion} — ${TURN_LABELS[currentTurn]}`,
            studentAnswer: answerToSubmit,
            scores: finalResult.scores,
            fillerWords: result.finalScore.fillerWords || { count: 0, words: [] },
            annotations: result.finalScore.annotations || [],
            coachFeedback: result.coachObservation || result.finalScore.coachFeedback || '',
          });
          return {
            ...previous,
            questions,
            status: 'completed',
            completedAt: new Date().toISOString(),
            sessionSummary: result.sessionSummary || null,
          };
        });
      } else {
        setSessionData((previous) => ({
          ...previous,
          questions: [
            ...(previous?.questions || []),
            {
              question: `${currentQuestion} — ${TURN_LABELS[currentTurn]}`,
              studentAnswer: answerToSubmit,
            },
          ],
        }));
        setLastResult(null);
      }
      setQuestionIndex((index) => index + 1);
      setStudentAnswer('');
      setVoiceTranscriptStart(transcript);
      if (result.isComplete) setSessionComplete(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'The coach could not process this discussion turn. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const openHistory = async () => {
    setView('history');
    setSessionComplete(false);
    setSelectedHistorySession(null);
    setIsHistoryLoading(true);
    setErrorMessage('');
    try {
      const sessions = await getSessions();
      setHistory(Array.isArray(sessions) ? sessions : []);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to load coaching history right now.'));
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openHistorySession = async (id) => {
    setIsHistoryLoading(true);
    setErrorMessage('');
    try {
      const session = await getSession(id);
      setSelectedHistorySession(session);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to load this session right now.'));
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const endSession = async () => {
    stopListening();
    stopSpeaking();
    if (!sessionData) {
      resetSession();
      setView('modes');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await completeSession(sessionId);
      setSessionData((previous) => ({
        ...previous,
        status: result.status || 'completed',
        completedAt: result.completedAt || new Date().toISOString(),
        sessionSummary: result.sessionSummary || makeLocalSummary(previous),
      }));
      setNotice(makeLocalSummary(sessionData)
        ? 'This report is based on your saved answers so far. The session ended before all questions were completed.'
        : 'The session was saved without any reviewed answers.');
      setSessionComplete(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to save the completed session. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoiceMode = () => {
    if (isListening) stopListening();
    if (!isSpeechRecognitionSupported) {
      setIsVoiceMode(false);
      setNotice('Voice input is not supported in this browser. Please use Chrome or Edge.');
      return;
    }
    setNotice('');
    setIsVoiceMode((current) => !current);
    if (isSpeaking) stopSpeaking();
  };

  const startVoiceAnswer = () => {
    setVoiceTranscriptStart(transcript);
    startListening();
  };

  const resetForNewSession = () => {
    resetSession();
    setView('modes');
  };

  const renderHistoryView = () => (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-violet-700">Communication Coach</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">Session history</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setView('modes');
            setErrorMessage('');
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {isHistoryLoading && (
        <div className="flex justify-center py-12">
          <LoaderCircle className="h-7 w-7 animate-spin text-violet-700" />
        </div>
      )}
      {!isHistoryLoading && selectedHistorySession && (
        <div className="mt-6">
          <SessionReport
            session={selectedHistorySession}
            onStartNewSession={() => {
              setSelectedHistorySession(null);
              setView('modes');
            }}
            onViewHistory={() => setSelectedHistorySession(null)}
          />
        </div>
      )}
      {!isHistoryLoading && !selectedHistorySession && history.length === 0 && (
        <div className="mt-8 rounded-xl bg-slate-50 p-8 text-center">
          <History className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-3 font-medium text-slate-800">No completed sessions yet</p>
          <p className="mt-1 text-sm text-slate-500">Your finished practice sessions will appear here.</p>
        </div>
      )}
      {!isHistoryLoading && !selectedHistorySession && history.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-100">
          {history.map((session) => {
            const mode = MODES.find((item) => item.id === session.mode);
            return (
              <li key={session._id}>
                <button
                  type="button"
                  onClick={() => openHistorySession(session._id)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left hover:bg-slate-50"
                >
                  <span>
                    <span className="block font-semibold text-slate-900">{mode?.name || 'Coaching Session'}</span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'Date unavailable'}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-violet-700">View report →</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  if (view === 'history') {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </div>
        )}
        {renderHistoryView()}
      </div>
    );
  }

  if (view === 'session' && sessionComplete && sessionData) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
        <SessionReport
          session={sessionData}
          message={notice}
          onStartNewSession={resetForNewSession}
          onViewHistory={openHistory}
        />
      </div>
    );
  }

  if (view === 'modes' || !activeMode) {
    return (
      <div className={styles.page}>
        <header className={styles.modeHeader}>
          <div className={styles.headingGroup}>
            <h1 className={styles.pageTitle}>
              Communication Coach
            </h1>
            <p className={styles.pageSubtitle}>
              Welcome, {getDisplayName(studentName)}. Choose your training mode and practise with ZAI Coach.
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.datePill}>
              <Calendar size={14} />
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <button
              type="button"
              onClick={openHistory}
              className={styles.historyButton}
            >
              <Clock className="h-3.5 w-3.5" />
              Session History
            </button>
          </div>
        </header>

        {errorMessage && (
          <div role="alert" className={styles.errorBanner}>
            {errorMessage}
          </div>
        )}

        <div className={styles.sectionLabel}>
          <span className={styles.sectionLabelText}>Training Modes</span>
        </div>

        <div className={styles.grid}>
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <article
                key={mode.id}
                className={`${styles.modeCard} ${mode.id === 'group' ? styles.gridFull : ''}`}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardIcon}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className={styles.badge}>
                    {mode.id === 'resume' ? 'Personalised'
                      : mode.id === 'hr' ? 'HR Round'
                        : mode.id === 'dsa' ? 'Technical'
                          : mode.id === 'communication' ? 'Speaking'
                            : 'Group'}
                  </span>
                </div>
                <h2 className={styles.cardTitle}>{mode.name}</h2>
                <p className={styles.cardDesc}>{mode.description}</p>
                <div className={styles.cardMeta}>
                  <span>{mode.id === 'group' ? '4 discussion turns' : '10 questions'}</span>
                  <span>~20 min</span>
                </div>
                <button
                  type="button"
                  onClick={() => beginSession(mode.id)}
                  disabled={isLoading}
                  className={styles.primaryButton}
                >
                  {isLoading && !activeMode
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <Mic className="h-4 w-4" />}
                  Start Session →
                </button>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  const submitHandler = activeMode === 'group' ? submitGroupAnswer : submitTextAnswer;
  const canSubmit = Boolean(answerToSubmit) && !isLoading && !isResumeWaiting;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 bg-[#080C14] p-4 text-slate-100 sm:p-6">
      {errorMessage && (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage('')} aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          {notice}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-[#111827] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setNotice('Session remains available in this view until you end it.');
            }}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
            aria-label="Stay in session"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CARD_STYLES[currentMode?.cardColor || 'violet'].icon}`}>
            {currentMode?.name || 'Coaching Session'}
          </span>
          <span className="text-sm font-medium text-slate-400">{questionCounter}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleVoiceMode}
            aria-pressed={isVoiceMode}
            className={`${styles.modeToggle} ${isVoiceMode ? styles.modeToggleActive : ''}`}
          >
            {isVoiceMode ? <Mic className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
            {isVoiceMode ? 'Voice mode' : 'Text mode'}
          </button>
          {isSpeaking ? (
            <button
              type="button"
              onClick={stopSpeaking}
              className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/5"
              aria-label="Mute coach voice"
              title="Mute coach voice"
            >
              <VolumeX className="h-4 w-4" />
            </button>
          ) : (
            <span className="sr-only"><Volume2 /></span>
          )}
          <button
            type="button"
            onClick={endSession}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500 px-3 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            End Session
          </button>
        </div>
      </header>

      {activeMode === 'resume' && isResumeWaiting ? (
        <ResumeUpload
          file={resumeFile}
          onFileChange={handleFileSelection}
          onAnalyse={analyseResume}
          loading={resumeUploading}
          extractedInfo={extractedInfo}
        />
      ) : activeMode === 'group' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr_1fr]">
          <ParticipantPanel
            label="Participant A"
            color="rose"
            messages={groupDiscussionState.participantAMessages}
            emptyMessage="Their opening viewpoint will appear here."
          />

          <main className="space-y-4">
            <section className="relative overflow-hidden rounded-xl border border-white/5 bg-[#0F172A] p-5 pl-6">
              <span className="absolute inset-y-0 left-0 w-[3px] bg-violet-500" aria-hidden="true" />
              <span className="inline-flex rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-300">
                Discussion topic
              </span>
              <h1 className="mt-3 text-lg font-medium leading-relaxed text-slate-100">{currentQuestion}</h1>
              <p className="mt-2 text-sm font-medium text-slate-400">
                Turn {groupTurnNumber} of {GROUP_TURNS.length} · {TURN_LABELS[currentTurn] || 'Discussion response'}
              </p>
            </section>

            <section
              aria-label="Discussion conversation"
              className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-900/70 p-4"
            >
              {groupDiscussionState.transcript.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Give your opening statement to begin the discussion.
                </p>
              ) : groupDiscussionState.transcript.map((entry, index) => {
                const entryStyle = entry.type === 'student'
                  ? 'ml-auto bg-violet-700 text-white'
                  : entry.type === 'participant-a'
                    ? 'mr-auto border border-rose-500/20 bg-rose-500/10 text-rose-100'
                    : entry.type === 'participant-b'
                      ? 'mr-auto border border-blue-500/20 bg-blue-500/10 text-blue-100'
                      : 'mx-auto border border-emerald-500/20 bg-emerald-500/10 text-emerald-100';
                return (
                  <article key={`discussion-${index}`} className={`max-w-[90%] rounded-xl p-3 text-sm ${entryStyle}`}>
                    <p className="mb-1 text-xs font-bold opacity-75">{entry.speaker}</p>
                    <p className="leading-relaxed">{entry.text}</p>
                  </article>
                );
              })}
            </section>

            <form onSubmit={submitHandler} className="rounded-xl border border-white/10 bg-[#1A1A2E] p-4">
              {isVoiceMode ? (
                <div className="flex flex-col items-center gap-4 py-2">
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startVoiceAnswer}
                    disabled={!isSpeechRecognitionSupported || isLoading}
                    className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isListening
                        ? 'animate-pulse bg-rose-600 shadow-rose-950'
                        : 'bg-gradient-to-br from-violet-600 to-indigo-700 shadow-violet-950 hover:scale-105'
                    }`}
                    aria-label={isListening ? 'Stop recording' : 'Start recording'}
                  >
                    {isListening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                  </button>
                  <p className="text-center text-xs text-slate-500">
                    {isListening ? 'Listening… pause for three seconds or stop recording.' : 'Tap the microphone to record your response.'}
                  </p>
                  <div className={`min-h-20 w-full rounded-lg border p-3 text-sm text-slate-100 ${isDraggingAnswer ? 'border-violet-500 bg-violet-500/10' : 'border-white/10 bg-slate-800'}`}>
                    {speechAnswer || <span className="text-slate-500">Your live transcript will appear here.</span>}
                  </div>
                </div>
              ) : (
                <textarea
                  ref={answerRef}
                  value={studentAnswer}
                  onChange={(event) => setStudentAnswer(event.target.value)}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDraggingAnswer(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDraggingAnswer(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingAnswer(false);
                    setStudentAnswer((previous) =>
                      `${previous}${previous ? ' ' : ''}${event.dataTransfer.getData('text')}`
                    );
                  }}
                  maxLength={10000}
                  rows={5}
                  placeholder="Share your view and respond thoughtfully to the group…"
                  className="min-h-[120px] w-full resize-y rounded-lg border border-white/10 bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                />
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                {isLoading ? 'ZAI Coach is reviewing…' : 'Submit response'}
              </button>
            </form>
            {lastResult && (
              <ScoreCard
                scores={lastResult.scores}
                fillerWords={lastResult.fillerWords}
                coachFeedback={lastResult.coachFeedback}
              />
            )}
            {lastResult && (
              <AnnotatedAnswer answer={lastResult.answer} annotations={lastResult.annotations} />
            )}
          </main>

          <ParticipantPanel
            label="Participant B"
            color="blue"
            messages={groupDiscussionState.participantBMessages}
            emptyMessage="Their opening viewpoint will appear here."
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
          <main className="space-y-4">
            {extractedInfo && activeMode === 'resume' && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                <strong>Questions personalised for {extractedInfo.name || 'your resume'}.</strong>
                {extractedInfo.skills?.length > 0 && (
                  <p className="mt-1 text-emerald-200">Skills: {extractedInfo.skills.join(', ')}</p>
                )}
              </div>
            )}
            <section className="relative overflow-hidden rounded-xl border border-white/5 bg-[#0F172A] p-5 pl-6 sm:p-6 sm:pl-7">
              <span className="absolute inset-y-0 left-0 w-[3px] bg-violet-500" aria-hidden="true" />
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${CARD_STYLES[currentMode?.cardColor || 'violet'].icon}`}>
                {currentMode?.name}
              </span>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {activeMode === 'dsa' ? 'Explain your approach in words' : 'Your question'}
              </p>
              <h1 className="mt-2 text-lg font-medium leading-relaxed text-slate-100 sm:text-xl">
                {currentQuestion || 'Preparing your question…'}
              </h1>
            </section>

            <form onSubmit={submitHandler} className="rounded-xl border border-white/10 bg-[#1A1A2E] p-5 sm:p-6">
              {isVoiceMode ? (
                <div className="flex flex-col items-center gap-4 py-3">
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startVoiceAnswer}
                    disabled={!isSpeechRecognitionSupported || isLoading}
                    className={`flex h-24 w-24 items-center justify-center rounded-full text-white shadow-xl transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isListening
                        ? 'animate-pulse bg-rose-600 shadow-rose-950'
                        : 'bg-gradient-to-br from-violet-600 to-indigo-700 shadow-violet-950 hover:scale-105'
                    }`}
                    aria-label={isListening ? 'Stop recording' : 'Start recording'}
                  >
                    {isListening ? <MicOff className="h-9 w-9" /> : <Mic className="h-9 w-9" />}
                  </button>
                  <p className="text-sm font-medium text-slate-300">
                    {isListening ? 'Listening… pause for three seconds or stop recording.' : 'Tap to speak your answer.'}
                  </p>
                  <div className="min-h-24 w-full rounded-lg border border-white/10 bg-slate-800 p-4 text-sm leading-relaxed text-slate-100">
                    {speechAnswer || <span className="text-slate-500">Your live transcript will appear here.</span>}
                  </div>
                  {!isSpeechRecognitionSupported && (
                    <p role="status" className="w-full rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Voice input is not supported in this browser. Please use Chrome or Edge.
                    </p>
                  )}
                  {speechError && (
                    <p role="status" className="w-full rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      {speechError}
                    </p>
                  )}
                </div>
              ) : (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-200">Your answer</span>
                  <textarea
                    ref={answerRef}
                    value={studentAnswer}
                    onChange={(event) => setStudentAnswer(event.target.value)}
                    maxLength={10000}
                    rows={7}
                    placeholder={activeMode === 'dsa'
                      ? 'Explain the steps of your approach, why it works, and any edge cases…'
                      : 'Take a moment to organise your thoughts, then write your answer…'}
                    className="min-h-[120px] w-full resize-y rounded-lg border border-white/10 bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  />
                  <span className="mt-1 block text-right text-xs text-slate-500">
                    {studentAnswer.length}/10,000
                  </span>
                </label>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                {isLoading ? 'ZAI Coach is reviewing…' : 'Submit Answer'}
              </button>
              {isVoiceMode && speechError && isSpeechRecognitionSupported && (
                <p role="status" className="mt-3 text-sm text-amber-300">{speechError}</p>
              )}
            </form>

            {lastResult &&
              !sessionComplete &&
              activeMode !== 'dsa' &&
              activeMode !== 'communication' && (
              <button
                type="button"
                onClick={continueToNextQuestion}
                disabled={isLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-5 py-3 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Next Question
              </button>
            )}
          </main>

          <aside className="space-y-4">
            {lastResult ? (
              <>
                <ScoreCard
                  scores={lastResult.scores}
                  fillerWords={lastResult.fillerWords}
                  coachFeedback={lastResult.coachFeedback}
                />
                <AnnotatedAnswer answer={lastResult.answer} annotations={lastResult.annotations} />
              </>
            ) : (
              <section className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#1A1A2E] p-6 text-center">
                <Brain className="h-8 w-8 text-violet-400" />
                <h2 className="mt-3 font-semibold text-slate-100">Your feedback appears here</h2>
                <p className="mt-1 max-w-xs text-sm text-slate-400">
                  Submit an answer to see your communication score and coach annotations.
                </p>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
