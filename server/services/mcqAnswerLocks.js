// Answers can only be checked for MCQs served to the student in an assessment.
// The first checked answer is locked, so the revealed correct answer can't be
// used to change the submission afterwards. In-memory, per server process.
const LOCK_TTL_MS = 3 * 60 * 60 * 1000;
const locks = new Map();
const served = new Map();

const keyFor = (userId, mcqId) => `${userId}:${mcqId}`;

const pruneExpired = (now) => {
  [locks, served].forEach((store) => {
    store.forEach((entry, key) => {
      if (entry.expiresAt <= now) store.delete(key);
    });
  });
};

const markServed = (userId, mcqIds = []) => {
  const now = Date.now();
  pruneExpired(now);
  mcqIds.forEach((mcqId) => served.set(keyFor(userId, mcqId), { expiresAt: now + LOCK_TTL_MS }));
};

const isServed = (userId, mcqId) => {
  const entry = served.get(keyFor(userId, mcqId));
  return Boolean(entry && entry.expiresAt > Date.now());
};

const lockAnswer = (userId, mcqId, selectedAnswer) => {
  const now = Date.now();
  const key = keyFor(userId, mcqId);
  const existing = locks.get(key);
  if (existing && existing.expiresAt > now) return existing.selectedAnswer;

  pruneExpired(now);
  locks.set(key, { selectedAnswer, expiresAt: now + LOCK_TTL_MS });
  return selectedAnswer;
};

const getLockedAnswer = (userId, mcqId) => {
  const lock = locks.get(keyFor(userId, mcqId));
  if (!lock || lock.expiresAt <= Date.now()) return undefined;
  return lock.selectedAnswer;
};

// Served marks are kept so a retry of the same questions can still be checked.
const clearLocks = (userId, mcqIds = []) => {
  mcqIds.forEach((mcqId) => locks.delete(keyFor(userId, mcqId)));
};

module.exports = { markServed, isServed, lockAnswer, getLockedAnswer, clearLocks };
