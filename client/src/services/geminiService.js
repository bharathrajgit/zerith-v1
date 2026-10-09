const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

/**
 * Internal helper — sends a prompt to Gemini and returns the text response.
 * Returns null on any failure so callers can show a graceful fallback.
 */
const callGemini = async (prompt) => {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "your_gemini_key_here") {
    console.warn("Gemini API key not configured. Set VITE_GEMINI_API_KEY in .env");
    return null;
  }

  try {
    const response = await fetch(`${GEMINI_BASE_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
        },
      }),
    });

    if (!response.ok) {
      console.error("Gemini API error:", response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch (err) {
    console.error("Gemini fetch failed:", err);
    return null;
  }
};

/**
 * getHint — returns a concise hint (max 2 sentences) without revealing the answer.
 * @param {string} question     - The MCQ or coding question text
 * @param {string} topic        - DSA topic name (e.g. "Binary Trees")
 * @param {number} attemptNumber - Which attempt (1, 2, or 3)
 * @returns {Promise<string|null>}
 */
export const getHint = async (question, topic, attemptNumber) => {
  const prompt = `You are a Java DSA tutor.
Topic: ${topic}
Question: ${question}
Attempt: ${attemptNumber} of 3
Give a helpful hint WITHOUT revealing the answer.
Be concise. Max 2 sentences.
Response: plain text only`;

  return callGemini(prompt);
};

/**
 * explainAnswer — educational explanation of why the correct answer is right.
 * @param {string} question       - The original question
 * @param {string} correctAnswer  - The correct answer
 * @param {string} explanation    - Background explanation from the question data
 * @param {string} topic          - DSA topic name
 * @returns {Promise<string|null>}
 */
export const explainAnswer = async (question, correctAnswer, explanation, topic) => {
  const prompt = `Explain why "${correctAnswer}" is correct for this Java DSA question about ${topic}: ${question}
Background: ${explanation}
Make it educational. Max 3 sentences.
Response: plain text only`;

  return callGemini(prompt);
};

export default { getHint, explainAnswer };
