const SCORE_DIMENSIONS = [
  { key: 'clarity', summaryKey: 'avgClarity', label: 'Clarity' },
  { key: 'confidence', summaryKey: 'avgConfidence', label: 'Confidence' },
  { key: 'structure', summaryKey: 'avgStructure', label: 'Structure' },
  { key: 'relevance', summaryKey: 'avgRelevance', label: 'Relevance' },
];

const MODE_LABELS = {
  resume: 'Resume-Based Mock Interview',
  hr: 'Frequently Asked HR Questions',
  dsa: 'DSA Technical Interview',
  communication: 'Communication Skills',
  group: 'Group Discussion',
};

const toScore = (value) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
};

const getScoreColor = (score) => {
  if (score < 50) return '#EF4444';
  if (score < 75) return '#F59E0B';
  return '#10B981';
};

function buildSummary(session) {
  const stored = session?.sessionSummary || {};
  const answered = Array.isArray(session?.questions)
    ? session.questions.filter((question) => question?.studentAnswer && question?.scores)
    : [];

  const averageFor = (key, summaryKey) => {
    if (Number.isFinite(Number(stored[summaryKey]))) return toScore(stored[summaryKey]);
    if (answered.length === 0) return 0;
    return toScore(
      answered.reduce((total, question) => total + (Number(question.scores[key]) || 0), 0) /
        answered.length
    );
  };

  const scores = Object.fromEntries(
    SCORE_DIMENSIONS.map(({ key, summaryKey }) => [key, averageFor(key, summaryKey)])
  );
  const weakestArea = typeof stored.weakestArea === 'string' && stored.weakestArea
    ? stored.weakestArea.toLowerCase()
    : SCORE_DIMENSIONS.reduce((weakest, dimension) =>
        scores[dimension.key] < scores[weakest.key] ? dimension : weakest,
      SCORE_DIMENSIONS[0]
      ).key;
  const fillerTotal = answered.reduce(
    (total, question) => total + (Number(question.fillerWords?.count) || 0),
    0
  );
  const totalFillerWords = Number.isFinite(Number(stored.totalFillerWords))
    ? Math.max(0, Math.round(Number(stored.totalFillerWords)))
    : fillerTotal;

  return {
    scores,
    weakestArea,
    totalFillerWords,
    improvementTip: typeof stored.improvementTip === 'string' ? stored.improvementTip : '',
  };
}

function getDurationLabel(session) {
  const start = session?.createdAt ? new Date(session.createdAt).getTime() : NaN;
  const end = session?.completedAt ? new Date(session.completedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const totalMinutes = Math.round((end - start) / 60000);
  if (totalMinutes < 1) return 'Less than a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export default function SessionReport({
  session,
  message = '',
  onStartNewSession,
  onViewHistory,
}) {
  const summary = buildSummary(session);
  const mode = MODE_LABELS[session?.mode] || 'Coaching Session';
  const createdAt = session?.createdAt ? new Date(session.createdAt) : null;
  const dateLabel = createdAt && !Number.isNaN(createdAt.getTime())
    ? createdAt.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Date unavailable';
  const duration = getDurationLabel(session);
  const weakestDimension = SCORE_DIMENSIONS.find(
    (dimension) => dimension.key === summary.weakestArea
  );
  const weakestLabel = weakestDimension?.label || summary.weakestArea;

  return (
    <section
      aria-label="Session report"
      className="mx-auto w-full max-w-3xl animate-[fade-in_300ms_ease-out] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
            {mode}
          </span>
          <h2 className="mt-4 text-2xl font-bold text-slate-950">Session Complete</h2>
          <p className="mt-1 text-sm text-slate-500">
            {dateLabel}{duration ? ` · ${duration}` : ''}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-center">
          <p className="text-2xl font-bold text-slate-900">
            {Array.isArray(session?.questions)
              ? session.questions.filter((question) => question?.studentAnswer).length
              : 0}
          </p>
          <p className="text-xs font-medium text-slate-500">answers reviewed</p>
        </div>
      </div>

      {message && (
        <p role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="mt-8 space-y-5">
        {SCORE_DIMENSIONS.map(({ key, label }) => {
          const score = summary.scores[key];
          const color = getScoreColor(score);
          return (
            <div key={key}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{label}</span>
                <span className="font-semibold tabular-nums" style={{ color }}>
                  {score}/100
                </span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`Average ${label}`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={score}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${score}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Focus area
          </p>
          <p className="mt-1 text-lg font-semibold text-amber-950">{weakestLabel}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Filler words
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {summary.totalFillerWords}
          </p>
        </div>
      </div>

      {summary.improvementTip && (
        <blockquote className="mt-6 rounded-xl border-l-4 border-violet-500 bg-violet-50 p-4 text-sm leading-relaxed text-violet-950">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
            Your next improvement
          </p>
          <p className="mt-2">{summary.improvementTip}</p>
        </blockquote>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onStartNewSession}
          disabled={!onStartNewSession}
          className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start New Session
        </button>
        <button
          type="button"
          onClick={onViewHistory}
          disabled={!onViewHistory}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          View History
        </button>
      </div>
    </section>
  );
}
