const DIMENSIONS = [
  { key: 'clarity', label: 'Clarity' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'structure', label: 'Structure' },
  { key: 'relevance', label: 'Relevance' },
];

const getScoreColor = (score) => {
  if (score < 50) return '#EF4444';
  if (score < 75) return '#F59E0B';
  return '#10B981';
};

const toScore = (value) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
};

function ScoreRing({ label, score }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = getScoreColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        className="h-20 w-20 -rotate-90"
        viewBox="0 0 72 72"
        role="img"
        aria-label={`${label}: ${score} out of 100`}
      >
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-white/10"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
        <text
          x="36"
          y="36"
          dominantBaseline="central"
          textAnchor="middle"
          transform="rotate(90 36 36)"
          fill={color}
          className="text-sm font-bold"
        >
          {score}
        </text>
      </svg>
      <span className="text-xs font-medium text-slate-300">{label}</span>
    </div>
  );
}

export default function ScoreCard({
  scores = {},
  fillerWords = { count: 0, words: [] },
  coachFeedback = '',
}) {
  const dimensionScores = Object.fromEntries(
    DIMENSIONS.map(({ key }) => [key, toScore(scores[key])])
  );
  const overallScore = toScore(scores.overall ?? scores.overallScore);
  const overallColor = getScoreColor(overallScore);
  const fillerCount = Number.isFinite(Number(fillerWords?.count))
    ? Math.max(0, Math.round(Number(fillerWords.count)))
    : 0;
  const fillerList = Array.isArray(fillerWords?.words)
    ? [...new Set(fillerWords.words.filter((word) => typeof word === 'string' && word.trim()))]
    : [];

  return (
    <section
      aria-label="Communication score"
      className="animate-[fade-in_300ms_ease-out] rounded-xl border border-violet-500/30 bg-[#1A1A2E] p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Communication score</h2>
          <p className="mt-1 text-sm text-slate-400">A breakdown of your latest answer</p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 text-4xl font-bold"
            style={{ borderColor: overallColor, color: overallColor }}
            role="img"
            aria-label={`Overall score: ${overallScore} out of 100`}
          >
            {overallScore}
          </div>
          <span className="text-sm font-medium text-slate-300">Overall</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {DIMENSIONS.map(({ key, label }) => (
          <ScoreRing key={key} label={label} score={dimensionScores[key]} />
        ))}
      </div>

      <div className="mt-5 border-t border-white/5 pt-5">
        {fillerCount === 0 ? (
          <p className="text-sm font-medium text-emerald-300">
            ✓ No filler words detected
          </p>
        ) : (
          <div>
            <p className="text-sm font-semibold text-amber-300">
              {fillerCount} filler {fillerCount === 1 ? 'word' : 'words'} detected
            </p>
            {fillerList.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Detected filler words">
                {fillerList.map((word) => (
                  <li
                    key={word}
                    className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200"
                  >
                    {word}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {coachFeedback && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <h3 className="text-sm font-semibold text-violet-300">Coach feedback</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm italic leading-relaxed text-slate-300">
            {coachFeedback}
          </p>
        </div>
      )}
    </section>
  );
}
