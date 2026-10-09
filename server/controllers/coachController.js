const CoachSession = require('../models/CoachSession');
const { parseResume } = require('../utils/resumeParser');
const { getCoachPrompt } = require('../utils/coachPrompts');
const { chatWithGroq } = require('../utils/groqClient');

const HR_QUESTIONS = [
  'Tell me about yourself.',
  'What is your greatest weakness, and what are you doing to improve it?',
  'Where do you see yourself in five years?',
  'Why should we hire you?',
  'Describe a challenge you overcame.',
  'What are your greatest strengths?',
  'Why do you want this role?',
  'Tell me about a time you worked effectively in a team.',
  'How do you handle pressure?',
  'What motivates you?',
];

const COMMUNICATION_TOPICS = [
  'Explain recursion to a 10-year-old.',
  'Pitch a new app idea.',
  'Describe your hometown.',
  'Explain AI in simple terms.',
  'Tell me about a book or movie you liked.',
];

const GROUP_TOPICS = [
  'Is AI a threat to jobs?',
  'Should coding be taught in schools?',
  'Remote work versus office work.',
];

const DSA_QUESTIONS = {
  easy: [
    'Explain how two pointers can find a pair with a target sum in a sorted array.',
    'Describe how you would reverse a singly linked list.',
    'Explain how a stack can help check whether brackets are balanced.',
  ],
  medium: [
    'Explain how breadth-first search finds the shortest path in an unweighted graph.',
    'Describe an approach for level-order traversal of a binary tree.',
    'Explain how merge sort works and why its time complexity is O(n log n).',
    'Describe how dynamic programming can solve the climbing-stairs problem.',
  ],
  hard: [
    'Explain Dijkstra’s algorithm, when it applies, and its time complexity.',
    'Describe a dynamic-programming approach to the longest increasing subsequence problem.',
    'Explain how topological sorting detects whether a directed graph contains a cycle.',
  ],
};

const FILLER_PATTERN = /\b(?:um+|uh+|like|you know|basically|literally|right|so yeah|kind of|sort of|actually|honestly)\b/gi;
const SCORE_FIELDS = ['clarity', 'confidence', 'structure', 'relevance'];
const MAX_ANSWER_LENGTH = 10000;

class InvalidGroqJsonError extends Error {}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function parseJsonObject(content) {
  if (typeof content !== 'string') {
    throw new InvalidGroqJsonError('Groq did not return text');
  }

  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new InvalidGroqJsonError('Groq did not return a JSON object');
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new InvalidGroqJsonError('Groq response was not a JSON object');
    }
    return parsed;
  } catch (error) {
    if (error instanceof InvalidGroqJsonError) throw error;
    throw new InvalidGroqJsonError('Groq returned malformed JSON');
  }
}

async function chatForJson(messages, repairInstruction, options) {
  const firstResponse = await chatWithGroq(messages, options);
  try {
    return parseJsonObject(firstResponse);
  } catch (firstError) {
    if (!(firstError instanceof InvalidGroqJsonError)) throw firstError;
  }

  const repairedResponse = await chatWithGroq([
    ...messages,
    { role: 'assistant', content: firstResponse },
    {
      role: 'user',
      content: repairInstruction ||
        'Your previous response was not valid JSON. Return the requested JSON object only.',
    },
  ], options);
  return parseJsonObject(repairedResponse);
}

function normaliseScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

function detectFillerWords(answer) {
  const matches = [...answer.matchAll(new RegExp(FILLER_PATTERN.source, FILLER_PATTERN.flags))];
  return {
    count: matches.length,
    words: [...new Set(matches.map((match) => match[0].toLowerCase()))],
  };
}

function getFallbackEvaluation(answer, nextQuestion) {
  const fillerWords = detectFillerWords(answer);
  const firstFiller = answer.match(new RegExp(FILLER_PATTERN.source, 'i'));
  const annotations = firstFiller
    ? [{
        quote: firstFiller[0],
        type: 'warning',
        note: 'This filler word may distract from your point; try pausing instead.',
      }]
    : [];

  return {
    clarity: 50,
    confidence: 50,
    structure: 50,
    relevance: 50,
    fillerWords,
    annotations,
    overallScore: 50,
    technicalCorrect: false,
    coachFeedback: 'The coach could not reliably score this response, so this is a neutral fallback. Please use the feedback panel as a guide and continue with the next question.',
    nextQuestion,
  };
}

function normaliseEvaluation(evaluation, answer, nextQuestion) {
  const scores = Object.fromEntries(
    SCORE_FIELDS.map((field) => [field, normaliseScore(evaluation[field])])
  );
  if (SCORE_FIELDS.some((field) => scores[field] === null)) {
    throw new InvalidGroqJsonError('Groq response is missing a valid score');
  }

  const filler = evaluation.fillerWords && typeof evaluation.fillerWords === 'object'
    ? evaluation.fillerWords
    : {};
  const annotations = Array.isArray(evaluation.annotations)
    ? evaluation.annotations
      .filter((annotation) =>
        annotation &&
        typeof annotation.quote === 'string' &&
        annotation.quote.length > 0 &&
        answer.includes(annotation.quote) &&
        ['warning', 'success'].includes(annotation.type) &&
        typeof annotation.note === 'string'
      )
      .slice(0, 3)
      .map(({ quote, type, note }) => ({ quote, type, note }))
    : [];
  const fillerWords = detectFillerWords(answer);
  const overallScore = normaliseScore(evaluation.overallScore);

  return {
    ...scores,
    fillerWords,
    annotations,
    overallScore: overallScore === null
      ? Math.round(SCORE_FIELDS.reduce((sum, field) => sum + scores[field], 0) / SCORE_FIELDS.length)
      : overallScore,
    coachFeedback: typeof evaluation.coachFeedback === 'string' && evaluation.coachFeedback.trim()
      ? evaluation.coachFeedback.trim()
      : 'Keep practising clear, structured answers and review the scores above.',
    nextQuestion: typeof nextQuestion === 'string' ? nextQuestion : '',
    technicalCorrect: typeof evaluation.technicalCorrect === 'boolean'
      ? evaluation.technicalCorrect
      : false,
  };
}

function sessionSummary(session) {
  const answered = session.questions.filter((question) => question.studentAnswer);
  const scored = answered.filter((question) => question.scores);
  if (scored.length === 0) {
    return {
      avgClarity: 0,
      avgConfidence: 0,
      avgStructure: 0,
      avgRelevance: 0,
      avgOverall: 0,
      totalFillerWords: answered.reduce(
        (total, question) => total + (question.fillerWords?.count || 0),
        0
      ),
      weakestArea: 'clarity',
      improvementTip: 'Practise giving a complete answer with a clear opening, supporting details, and a concise close.',
    };
  }

  const averages = Object.fromEntries(
    [...SCORE_FIELDS, 'overall'].map((field) => [
      `avg${field[0].toUpperCase()}${field.slice(1)}`,
      Math.round(scored.reduce((sum, question) => sum + (question.scores[field] || 0), 0) / scored.length),
    ])
  );
  const weakestArea = SCORE_FIELDS.reduce((weakest, field) =>
    averages[`avg${field[0].toUpperCase()}${field.slice(1)}`] <
      averages[`avg${weakest[0].toUpperCase()}${weakest.slice(1)}`]
      ? field
      : weakest
  , SCORE_FIELDS[0]);
  const weakestTips = {
    clarity: 'Use shorter sentences and explain one idea at a time.',
    confidence: 'Replace hesitant phrases with direct language and support your claims with an example.',
    structure: 'Organise each answer into an opening, two or three supporting points, and a short conclusion.',
    relevance: 'Address the question directly before adding background or extra detail.',
  };

  return {
    ...averages,
    totalFillerWords: answered.reduce(
      (total, question) => total + (question.fillerWords?.count || 0),
      0
    ),
    weakestArea,
    improvementTip: weakestTips[weakestArea],
  };
}

async function generateSessionSummary(session) {
  const summary = sessionSummary(session);
  const answered = session.questions
    .filter((question) => question.studentAnswer)
    .map((question) => ({
      question: question.question,
      answer: question.studentAnswer,
      scores: question.scores,
      fillerWords: question.fillerWords,
    }));
  if (answered.length === 0) return summary;

  try {
    const result = await chatForJson([
      {
        role: 'system',
        content: 'You are ZAI Coach. Based on the completed practice session, return only JSON with one field: {"improvementTip":"..."}. Give one concise, specific, constructive tip grounded in the session scores and answers.',
      },
      {
        role: 'user',
        content: JSON.stringify({ mode: session.mode, session: answered, scoreSummary: summary }),
      },
    ], 'Return valid JSON with a non-empty improvementTip string only.');
    if (typeof result.improvementTip === 'string' && result.improvementTip.trim()) {
      summary.improvementTip = result.improvementTip.trim();
    } else {
      console.warn('Groq session summary response omitted improvementTip; using the local summary tip.');
    }
  } catch (error) {
    console.error('Unable to generate AI session improvement tip; using the local summary tip:', error);
  }
  return summary;
}

function getNextDsaQuestion(session) {
  const correctCount = session.questions.filter(
    (question) => question.scores?.technicalCorrect === true
  ).length;
  const difficulty = correctCount >= 4
    ? 'hard'
    : correctCount >= 2
      ? 'medium'
      : 'easy';
  const askedAtDifficulty = session.questions.filter(
    (question) => question.difficulty === difficulty && question.studentAnswer
  ).length;
  const questions = DSA_QUESTIONS[difficulty];
  return {
    difficulty,
    question: `${difficulty[0].toUpperCase()}${difficulty.slice(1)}: ${questions[askedAtDifficulty % questions.length]}`,
  };
}

function isOwnedBy(session, userId) {
  return session && String(session.studentId) === String(userId);
}

function groupMetadata(question) {
  if (!question?.coachFeedback) return null;
  try {
    const parsed = JSON.parse(question.coachFeedback);
    return parsed && parsed.groupDiscussion === true ? parsed : null;
  } catch (_error) {
    return null;
  }
}

const startSession = async (req, res) => {
  try {
    const { mode } = req.body || {};
    if (!['resume', 'hr', 'dsa', 'communication', 'group'].includes(mode)) {
      return sendError(res, 400, 'Choose a valid coaching mode.');
    }

    let firstQuestion = '';
    if (mode === 'hr') firstQuestion = HR_QUESTIONS[0];
    if (mode === 'dsa') firstQuestion = 'Explain how binary search works and when you would use it.';
    if (mode === 'communication') {
      firstQuestion = COMMUNICATION_TOPICS[Math.floor(Math.random() * COMMUNICATION_TOPICS.length)];
    }
    if (mode === 'group') {
      firstQuestion = GROUP_TOPICS[Math.floor(Math.random() * GROUP_TOPICS.length)];
    }

    const questions = mode === 'hr'
      ? HR_QUESTIONS.map((question) => ({ question }))
      : mode === 'resume'
        ? []
        : [{
            question: mode === 'dsa' ? `Easy: ${firstQuestion}` : firstQuestion,
            ...(mode === 'dsa' ? { difficulty: 'easy' } : {}),
          }];
    const session = await CoachSession.create({
      studentId: req.user._id,
      mode,
      questions,
    });

    return res.status(201).json({
      success: true,
      data: mode === 'resume'
        ? { sessionId: session.id, mode, needsResume: true }
        : { sessionId: session.id, firstQuestion, mode },
    });
  } catch (error) {
    console.error('Unable to start coach session:', error);
    return sendError(res, 500, 'Unable to start a coaching session right now.');
  }
};

const uploadResume = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId || !req.file || !Buffer.isBuffer(req.file.buffer)) {
      return sendError(res, 400, 'Choose a PDF resume to upload.');
    }
    const isPdf = req.file.mimetype === 'application/pdf' ||
      /\.pdf$/i.test(req.file.originalname || '');
    if (!isPdf) return sendError(res, 400, 'Resume upload only accepts PDF files.');

    const session = await CoachSession.findById(sessionId);
    if (!isOwnedBy(session, req.user._id)) {
      return sendError(res, 404, 'Coaching session not found.');
    }
    if (session.mode !== 'resume' || session.status !== 'active') {
      return sendError(res, 409, 'This session is not waiting for a resume.');
    }

    const resumeText = await parseResume(req.file.buffer);
    if (!resumeText || !resumeText.trim()) {
      return sendError(res, 422, 'No readable text was found in that PDF. Try a text-based PDF resume.');
    }
    const extractionMessages = [
      {
        role: 'system',
        content: 'Extract the candidate information from the supplied resume. Return valid JSON only with this shape: {"extractedInfo":{"name":"","skills":[],"projects":[],"experience":[],"education":[]},"questions":["..."]}. Generate exactly 10 concise personalised interview questions mixing behavioural and technical questions supported by the resume. Do not invent candidate facts.',
      },
      {
        role: 'user',
        content: `Resume text:\n${resumeText.slice(0, 20000)}`,
      },
    ];
    let extracted;
    try {
      extracted = await chatForJson(
        extractionMessages,
        'Return valid JSON with extractedInfo and exactly 10 questions, as requested.',
        { maxTokens: 2048 }
      );
    } catch (error) {
      if (error instanceof InvalidGroqJsonError) {
        return sendError(res, 502, 'The coach could not read a valid question set from the resume. Please try again.');
      }
      throw error;
    }

    const info = extracted.extractedInfo && typeof extracted.extractedInfo === 'object'
      ? extracted.extractedInfo
      : {};
    const questions = Array.isArray(extracted.questions)
      ? extracted.questions.filter((question) => typeof question === 'string' && question.trim()).slice(0, 10)
      : [];
    if (questions.length !== 10) {
      return sendError(res, 502, 'The coach could not generate 10 resume-based questions. Please try again.');
    }

    session.resumeText = resumeText;
    session.questions = questions.map((question) => ({ question: question.trim() }));
    await session.save();

    return res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        firstQuestion: session.questions[0].question,
        questions: session.questions.map((question) => question.question),
        extractedInfo: {
          name: typeof info.name === 'string' ? info.name : '',
          skills: Array.isArray(info.skills) ? info.skills.filter((item) => typeof item === 'string') : [],
          projects: Array.isArray(info.projects) ? info.projects.filter((item) => typeof item === 'string') : [],
          experience: Array.isArray(info.experience) ? info.experience.filter((item) => typeof item === 'string') : [],
          education: Array.isArray(info.education) ? info.education.filter((item) => typeof item === 'string') : [],
        },
      },
    });
  } catch (error) {
    console.error('Unable to analyse resume:', error);
    return sendError(res, 502, 'Unable to analyse this resume right now. Please try again.');
  }
};

const submitAnswer = async (req, res) => {
  try {
    const { answer, questionIndex } = req.body || {};
    if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_ANSWER_LENGTH) {
      return sendError(res, 400, 'Enter an answer of 1 to 10,000 characters.');
    }
    if (!Number.isInteger(questionIndex) || questionIndex < 0) {
      return sendError(res, 400, 'Provide a valid question index.');
    }

    const session = await CoachSession.findById(req.params.sessionId);
    if (!isOwnedBy(session, req.user._id)) {
      return sendError(res, 404, 'Coaching session not found.');
    }
    if (session.status !== 'active') return sendError(res, 409, 'This coaching session is already complete.');
    if (session.mode === 'group') return sendError(res, 400, 'Use the group-discussion endpoint for this mode.');

    const question = session.questions[questionIndex];
    if (!question) return sendError(res, 400, 'That question is not part of this session.');
    const nextQuestionIndex = session.questions.findIndex((entry) => !entry.studentAnswer);
    if (questionIndex !== nextQuestionIndex) {
      return sendError(res, 409, 'Answer the questions in order, starting with the next unanswered question.');
    }
    if (question.studentAnswer) return sendError(res, 409, 'This question has already been answered.');

    const isFixedLength = session.mode === 'hr' || session.mode === 'resume' || session.mode === 'communication';
    const isLastQuestion = isFixedLength && questionIndex === session.questions.length - 1;
    const history = session.questions
      .slice(0, questionIndex)
      .filter((entry) => entry.studentAnswer)
      .map((entry) => ({
        question: entry.question,
        answer: entry.studentAnswer,
        scores: entry.scores,
      }));
    const prompt = getCoachPrompt(session.mode);
    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          `Question asked: ${question.question}`,
          `Student's answer: ${answer.trim()}`,
          `Completed session history: ${JSON.stringify(history)}`,
          `This is the final question: ${isLastQuestion ? 'yes' : 'no'}.`,
          session.mode === 'dsa'
            ? 'Evaluate technical correctness independently of communication quality. Include "technicalCorrect": true or false. Also give one brief follow-up question in nextQuestion if useful; the platform selects the next main problem based on correct-answer count.'
            : 'Return an empty nextQuestion; the next question is managed by the session.',
          'Evaluate the answer and return only the required JSON object.',
        ].join('\n\n'),
      },
    ];

    let evaluation;
    try {
      const rawEvaluation = await chatForJson(messages, 'Return only a valid JSON object matching the required evaluation shape.');
      const managedNextQuestion = session.mode === 'dsa'
        ? (typeof rawEvaluation.nextQuestion === 'string' ? rawEvaluation.nextQuestion.trim() : '')
        : '';
      evaluation = normaliseEvaluation(rawEvaluation, answer.trim(), managedNextQuestion);
    } catch (error) {
      if (!(error instanceof InvalidGroqJsonError)) throw error;
      evaluation = getFallbackEvaluation(answer.trim(), '');
    }

    question.studentAnswer = answer.trim();
    question.scores = {
      clarity: evaluation.clarity,
      confidence: evaluation.confidence,
      structure: evaluation.structure,
      relevance: evaluation.relevance,
      overall: evaluation.overallScore,
      ...(session.mode === 'dsa' ? { technicalCorrect: evaluation.technicalCorrect } : {}),
    };
    question.fillerWords = evaluation.fillerWords;
    question.annotations = evaluation.annotations;
    question.coachFeedback = evaluation.coachFeedback;

    let nextQuestion = '';
    let completed = isLastQuestion;
    if (session.mode === 'dsa') {
      const nextDsaQuestion = getNextDsaQuestion(session);
      nextQuestion = nextDsaQuestion.question;
      session.questions.push({
        question: nextQuestion,
        difficulty: nextDsaQuestion.difficulty,
      });
      completed = false;
    } else if (!isLastQuestion) {
      nextQuestion = session.questions[questionIndex + 1].question;
    }

    let summary;
    if (completed) {
      session.status = 'completed';
      session.completedAt = new Date();
      summary = await generateSessionSummary(session);
      session.sessionSummary = summary;
    }
    await session.save();

    return res.status(200).json({
      success: true,
      data: {
        scores: {
          clarity: evaluation.clarity,
          confidence: evaluation.confidence,
          structure: evaluation.structure,
          relevance: evaluation.relevance,
          overall: evaluation.overallScore,
          ...(session.mode === 'dsa' ? { technicalCorrect: evaluation.technicalCorrect } : {}),
        },
        fillerWords: evaluation.fillerWords,
        annotations: evaluation.annotations,
        coachFeedback: evaluation.coachFeedback,
        nextQuestion,
        isLastQuestion: completed,
        ...(summary ? { sessionSummary: summary } : {}),
      },
    });
  } catch (error) {
    console.error('Unable to evaluate coach answer:', error);
    return sendError(res, 502, 'The coach could not evaluate your answer right now. Please try again.');
  }
};

async function generateGroupTurn(session, turn, studentMessage, previousState) {
  const system = `${getCoachPrompt('group')}\n\nFor this group-discussion turn, return only JSON with shape {"participantAResponse":string,"participantBResponse":string,"coachObservation":string,"finalScore":object|null}. Keep each participant response concise and their viewpoints distinct and opposing. On opening, provide initial statements from both participants. On respond-a, Participant A replies directly to the student's response while Participant B's response is an empty string. On respond-b, Participant B replies directly to the student's response while Participant A's response is an empty string. On closing, both participant responses are empty strings and finalScore evaluates the complete discussion. finalScore, when present, must contain clarity, confidence, structure, relevance, overallScore (0-100), fillerWords {count, words}, annotations, and coachFeedback.`;
  const response = await chatForJson([
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        topic: session.questions[0]?.question || '',
        turn,
        studentMessage,
        previousState,
        instruction: turn === 'opening'
          ? 'Respond as Participant A and Participant B with opposing viewpoints. Provide a brief coach observation.'
          : turn === 'respond-a'
            ? 'Have Participant A respond to the student’s latest point. Leave participantBResponse empty.'
            : turn === 'respond-b'
              ? 'Have Participant B respond to the student’s latest point. Leave participantAResponse empty.'
          : turn === 'closing'
              ? 'Evaluate the complete discussion and provide finalScore. Leave both participant response fields empty.'
              : 'Give a brief coach observation about the response.',
      }),
    },
  ], 'Return only valid JSON with participantAResponse, participantBResponse, coachObservation, and finalScore fields.');

  const participantAResponse = ['opening', 'respond-a'].includes(turn) &&
    typeof response.participantAResponse === 'string'
    ? response.participantAResponse.trim()
    : '';
  const participantBResponse = ['opening', 'respond-b'].includes(turn) &&
    typeof response.participantBResponse === 'string'
    ? response.participantBResponse.trim()
    : '';
  if (
    (['opening', 'respond-a'].includes(turn) && !participantAResponse) ||
    (['opening', 'respond-b'].includes(turn) && !participantBResponse)
  ) {
    throw new InvalidGroqJsonError(`Groq omitted a required participant response for the ${turn} turn`);
  }

  return {
    participantAResponse,
    participantBResponse,
    coachObservation: typeof response.coachObservation === 'string' && response.coachObservation.trim()
      ? response.coachObservation.trim()
      : 'Keep your points relevant and make space for other viewpoints.',
    finalScore: turn === 'closing' && response.finalScore && typeof response.finalScore === 'object'
      ? response.finalScore
      : null,
  };
}

const groupDiscussion = async (req, res) => {
  try {
    const { turn, studentMessage } = req.body || {};
    const turns = ['opening', 'respond-a', 'respond-b', 'closing'];
    if (!turns.includes(turn)) return sendError(res, 400, 'Provide a valid group-discussion turn.');
    if (typeof studentMessage !== 'string' || !studentMessage.trim() || studentMessage.length > MAX_ANSWER_LENGTH) {
      return sendError(res, 400, 'Enter a response of 1 to 10,000 characters.');
    }

    const session = await CoachSession.findById(req.params.sessionId);
    if (!isOwnedBy(session, req.user._id)) {
      return sendError(res, 404, 'Coaching session not found.');
    }
    if (session.mode !== 'group' || session.status !== 'active') {
      return sendError(res, 409, 'This session is not an active group discussion.');
    }

    const previousTurns = session.questions.slice(1);
    const expectedTurn = turns[previousTurns.length] || null;
    if (turn !== expectedTurn) {
      return sendError(res, 409, expectedTurn
        ? `The next group-discussion turn is "${expectedTurn}".`
        : 'The group discussion is already complete.');
    }

    const previousState = previousTurns.map((entry) => ({
      studentMessage: entry.studentAnswer,
      ...groupMetadata(entry),
    }));
    const generated = await generateGroupTurn(session, turn, studentMessage.trim(), previousState);
    const lastGroupState = previousState[previousState.length - 1] || {};
    const storedParticipantAResponse = generated.participantAResponse ||
      lastGroupState.participantAResponse || '';
    const storedParticipantBResponse = generated.participantBResponse ||
      lastGroupState.participantBResponse || '';
    const isComplete = turn === 'closing';
    let finalScore = null;

    if (isComplete) {
      const discussionTranscript = [
        ...previousTurns.map((entry) => entry.studentAnswer).filter(Boolean),
        studentMessage.trim(),
      ].join('\n');
      try {
        finalScore = normaliseEvaluation(
          generated.finalScore || {},
          discussionTranscript,
          ''
        );
      } catch (error) {
        if (!(error instanceof InvalidGroqJsonError)) throw error;
        finalScore = getFallbackEvaluation(studentMessage.trim(), '');
      }
      session.questions.push({
        question: `${session.questions[0].question} — closing`,
        studentAnswer: studentMessage.trim(),
        scores: {
          clarity: finalScore.clarity,
          confidence: finalScore.confidence,
          structure: finalScore.structure,
          relevance: finalScore.relevance,
          overall: finalScore.overallScore,
        },
        fillerWords: finalScore.fillerWords,
        annotations: finalScore.annotations,
        coachFeedback: generated.coachObservation || finalScore.coachFeedback,
      });
      session.status = 'completed';
      session.completedAt = new Date();
      session.sessionSummary = await generateSessionSummary(session);
    } else {
      const nextTurn = turns[turns.indexOf(turn) + 1];
      session.questions.push({
        question: `${session.questions[0].question} — ${nextTurn}`,
        studentAnswer: studentMessage.trim(),
        fillerWords: detectFillerWords(studentMessage.trim()),
        coachFeedback: JSON.stringify({
          groupDiscussion: true,
          participantAResponse: storedParticipantAResponse,
          participantBResponse: storedParticipantBResponse,
          coachObservation: generated.coachObservation,
          nextTurn,
        }),
      });
    }

    await session.save();
    return res.status(200).json({
      success: true,
      data: {
        participantAResponse: generated.participantAResponse || undefined,
        participantBResponse: generated.participantBResponse || undefined,
        coachObservation: generated.coachObservation,
        nextTurn: isComplete ? null : turns[turns.indexOf(turn) + 1],
        isComplete,
        ...(isComplete ? { finalScore, sessionSummary: session.sessionSummary } : {}),
      },
    });
  } catch (error) {
    console.error('Unable to process group discussion turn:', error);
    return sendError(res, 502, 'The coach could not process this group-discussion turn right now. Please try again.');
  }
};

const getSessionHistory = async (req, res) => {
  try {
    const sessions = await CoachSession.find({
      studentId: req.user._id,
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('-resumeText')
      .lean();
    return res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    console.error('Unable to load coach session history:', error);
    return sendError(res, 500, 'Unable to load coaching history right now.');
  }
};

const completeSession = async (req, res) => {
  try {
    const session = await CoachSession.findById(req.params.sessionId);
    if (!isOwnedBy(session, req.user._id)) {
      return sendError(res, 404, 'Coaching session not found.');
    }

    if (session.status !== 'completed') {
      session.status = 'completed';
      session.completedAt = new Date();
      session.sessionSummary = await generateSessionSummary(session);
      await session.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        completedAt: session.completedAt,
        sessionSummary: session.sessionSummary,
      },
    });
  } catch (error) {
    console.error('Unable to complete coach session:', error);
    return sendError(res, 500, 'Unable to complete this coaching session right now.');
  }
};

const getSession = async (req, res) => {
  try {
    const session = await CoachSession.findById(req.params.sessionId).select('-resumeText').lean();
    if (!isOwnedBy(session, req.user._id)) {
      return sendError(res, 404, 'Coaching session not found.');
    }
    return res.status(200).json({ success: true, data: session });
  } catch (error) {
    console.error('Unable to load coach session:', error);
    return sendError(res, 500, 'Unable to load this coaching session right now.');
  }
};

module.exports = {
  startSession,
  uploadResume,
  submitAnswer,
  groupDiscussion,
  completeSession,
  getSessionHistory,
  getSession,
  _internals: {
    getFallbackEvaluation,
    normaliseEvaluation,
    parseJsonObject,
    sessionSummary,
    detectFillerWords,
    getNextDsaQuestion,
  },
};
