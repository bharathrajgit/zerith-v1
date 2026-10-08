const ChatMessage = require('../models/ChatMessage');
const CodingProblem = require('../models/CodingProblem');
const CodingSubmission = require('../models/CodingSubmission');
const { chatWithGroq } = require('../utils/groqClient');
const { buildSystemPrompt } = require('../utils/socraticPrompt');

const sanitizeMessage = (value) => String(value || '').trim();

const getUserIdFromRequest = (req) => req.user?._id || req.user?.id || req.body?.userId || req.query?.userId;

const getProblemTypeFromRequest = (req) => {
  const value = req.body?.problemType || req.query?.problemType || req.params?.problemType || 'practice';
  return ['practice', 'assignment', 'chunk'].includes(value) ? value : 'practice';
};

const normalizeProblem = (problem) => ({
  title: problem?.title || 'Coding problem',
  description: problem?.description || problem?.problemStatement || 'No description available.',
  constraints: problem?.constraints || '',
  examples: problem?.examples || problem?.testCases || [],
  hints: problem?.hints || [],
});

const getSubmissionSummary = async (studentId, problemId) => {
  const submissions = await CodingSubmission.find({
    userId: studentId,
    problemId,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return (submissions || []).map((submission) => ({
    score: submission.score ?? Math.max(
      0,
      submission.totalVisibleCount
        ? Math.round((submission.passedVisibleCount / submission.totalVisibleCount) * 100)
        : 0
    ),
    result: submission.verdict || 'Pending',
    code: submission.code || '',
  }));
};

const getChatHistory = async (req, res) => {
  try {
    const studentId = getUserIdFromRequest(req);
    const problemId = req.params?.problemId || req.query?.problemId || req.body?.problemId;

    if (!studentId || !problemId) {
      return res.status(400).json({
        success: false,
        message: 'Student and problem context are required',
      });
    }

    const chatDoc = await ChatMessage.findOne({
      studentId,
      problemId,
    }).lean();

    return res.json({
      success: true,
      data: {
        messages: chatDoc?.messages || [],
      },
      message: 'Chat history loaded',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Unable to load chat history',
    });
  }
};

const sendChatMessage = async (req, res) => {
  try {
    const studentId = getUserIdFromRequest(req);
    const problemId = req.body?.problemId || req.query?.problemId || req.params?.problemId;
    const problemType = getProblemTypeFromRequest(req);
    const incomingMessage = sanitizeMessage(req.body?.message);
    const currentCode = sanitizeMessage(req.body?.currentCode);

    if (!studentId || !problemId) {
      return res.status(400).json({
        success: false,
        message: 'Student and problem context are required',
      });
    }

    if (!incomingMessage && !currentCode) {
      return res.status(400).json({
        success: false,
        message: 'Type a message or write some code first',
      });
    }

    const problem = await CodingProblem.findById(problemId).lean();
    const chatDoc = await ChatMessage.findOne({ studentId, problemId }).lean();
    const existingMessages = chatDoc?.messages || [];
    const trimmedHistory = existingMessages.slice(-10);

    const userMessage = {
      role: 'user',
      content: incomingMessage || `Student code updated:\n${currentCode}`,
      timestamp: new Date(),
    };

    const submissionHistory = await getSubmissionSummary(studentId, problemId);
    const problemContext = normalizeProblem(problem);
    const systemPrompt = buildSystemPrompt(problemContext, submissionHistory);

    const conversationMessages = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: 'user', content: userMessage.content },
    ];

    let assistantReply = 'I’m thinking about the key issue in your approach — what happens when you test your current logic on the edge case you are skipping?';

    try {
      const groqReply = await chatWithGroq(conversationMessages);
      if (groqReply && sanitizeMessage(groqReply)) {
        assistantReply = groqReply.trim();
      }
    } catch (error) {
      const status = error.response?.status;
      const providerMessage = error.response?.data?.error?.message || error.message;
      console.error('[Chat] Groq request failed:', {
        status: status || null,
        message: providerMessage || 'Unknown Groq API error',
      });
      assistantReply = 'I’m having trouble connecting right now. What part of the problem feels ambiguous or tricky to you?';
    }

    const assistantMessage = {
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date(),
    };

    const updatedMessages = [...trimmedHistory, userMessage, assistantMessage];

    await ChatMessage.findOneAndUpdate(
      { studentId, problemId },
      {
        studentId,
        problemId,
        problemType,
        messages: updatedMessages,
        updatedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.json({
      success: true,
      data: {
        messages: updatedMessages,
        reply: assistantReply,
      },
      message: 'Chat reply sent',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Unable to generate a chat response',
    });
  }
};

module.exports = {
  getChatHistory,
  sendChatMessage,
};
