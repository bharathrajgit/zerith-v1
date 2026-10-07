// First answer a student checks for an MCQ is locked, so the revealed correct
// answer can't be used to change the submission afterwards. In-memory: locks
// last for LOCK_TTL_MS and are per server process.
const LOCK_TTL_MS = 3 * 60 * 60 * 1000;
const locks = new Map();

const keyFor = (userId, mcqId) => `${userId}:${mcqId}`;

const pruneExpired = (now) => {
  locks.forEach((lock, key) => {
    if (lock.expiresAt <= now) locks.delete(key);
  });
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

const clearLocks = (userId, mcqIds = []) => {
  mcqIds.forEach((mcqId) => locks.delete(keyFor(userId, mcqId)));
};

module.exports = { lockAnswer, getLockedAnswer, clearLocks };
